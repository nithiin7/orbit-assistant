"""Restoring a backup, or importing an export, into a workspace.

Two modes share one pipeline:

- **Restore** (`new_workspace`, `into_empty`, `replace`) is strict: every record must go in, or
  nothing does. IDs are kept when none of them exists anywhere in the database (a fresh
  installation, a deleted workspace, or the workspace being replaced). If any does (restoring a
  copy beside the original), **every** ID in the backup gets a new one, consistently, so the
  copy and the original never share a record.
- **Import** (`merge`, for JSON exports) adds to the workspace. A record whose ID is already in
  this workspace is a **duplicate** and is left alone, so importing the same file twice adds
  nothing the second time. A record whose ID exists in another workspace gets a new ID. A
  category, tag, built-in exercise, or default shopping list with the same natural key as an
  existing one is **matched** to it (`catalog.MATCH_KEYS`). Records that would break a rule
  (such as a second journal entry for a day) or refer to records in neither the file nor the
  workspace are **skipped** and counted, never forced in.

When IDs change, every reference changes with them: ID columns, and IDs inside text and JSON
(see `rows.remap_row`).

The database work happens in one transaction. Files are written into the attachment store just
before it commits and deleted again if anything fails, so a failed restore leaves neither
records nor files behind. If the process dies mid-restore, the transaction never commits and the
worker's sweep removes the unreferenced files. A dry run does everything except write files, in
a transaction that's rolled back.
"""

import uuid
from dataclasses import dataclass, field
from itertools import islice
from typing import Any, Literal

import anyio.to_thread

from orbit_api.services.backup.catalog import FILE_COLUMNS, MATCH_KEYS, TableSpec
from orbit_api.services.backup.models import (
    IncompatibleArchiveError,
    InvalidArchiveError,
    RestoreFailedError,
    RestoreRejectedError,
    RestoreReport,
    RestoreStrategy,
    TableResult,
)
from orbit_api.services.backup.ports import AttachmentFiles, BackupData
from orbit_api.services.backup.rows import Row, decode_row, parents_first, remap_row
from orbit_api.services.backup.sources import RowSource
from orbit_api.services.transactions import Transaction
from orbit_api.services.workspaces.models import Workspace

BATCH = 500
Mode = RestoreStrategy | Literal["merge"]
Skip = Literal["duplicate", "matched"]


@dataclass(slots=True)
class _Scan:
    """What the first pass learns about a table."""

    ids: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    blobs: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    rows_by_id: dict[uuid.UUID, Row] = field(default_factory=dict[uuid.UUID, Row])


class Restorer:
    def __init__(self, data: BackupData, files: AttachmentFiles, transaction: Transaction) -> None:
        self._data = data
        self._files = files
        self._transaction = transaction

    def _specs(self, source: RowSource) -> list[TableSpec]:
        known = {spec.name: spec for spec in self._data.specs()}
        unknown = sorted(set(source.manifest.tables) - set(known))
        if unknown:
            raise IncompatibleArchiveError(
                "This file contains data this version of Orbit doesn't know "
                f"({', '.join(unknown[:3])}). Update Orbit to restore it."
            )
        return [spec for name, spec in known.items() if name in source.manifest.tables]

    async def _scan(self, source: RowSource, spec: TableSpec) -> _Scan:
        """Decode every record once (validating it) and note its ID and file."""
        scan = _Scan()
        blob_column = FILE_COLUMNS.get(spec.name)
        keep_rows = spec.name in MATCH_KEYS
        rows = source.iter_rows(spec.name)
        while batch := await anyio.to_thread.run_sync(lambda: list(islice(rows, BATCH))):
            for raw in batch:
                row = decode_row(spec, raw)
                identity = row.get(spec.identity) if spec.identity else None
                if identity is not None:
                    scan.ids.append(identity)
                    if keep_rows:
                        scan.rows_by_id[identity] = row
                if blob_column is not None and row.get(blob_column) is not None:
                    scan.blobs.append(row[blob_column])
        return scan

    async def run(
        self,
        source: RowSource,
        workspace: Workspace,
        user_id: uuid.UUID,
        mode: Mode,
        *,
        dry_run: bool,
    ) -> RestoreReport:
        manifest = source.manifest
        merge = mode == "merge"
        specs = self._specs(source)
        report = RestoreReport(
            dry_run=dry_run, strategy=mode, workspace_id=workspace.id, workspace_name=workspace.name
        )
        scans = {spec.name: await self._scan(source, spec) for spec in specs}

        mapping: dict[uuid.UUID, uuid.UUID] = {}
        if manifest.workspace_id != workspace.id:
            mapping[manifest.workspace_id] = workspace.id
        if manifest.owner_id != user_id:
            mapping[manifest.owner_id] = user_id
        skip: dict[str, dict[uuid.UUID, Skip]] = {spec.name: {} for spec in specs}

        if merge:
            await self._plan_merge(specs, scans, workspace, mapping, skip)
        else:
            await self._plan_restore(specs, scans, workspace, mode, mapping)
        report.remapped = sum(
            1 for old in mapping if old not in (manifest.workspace_id, manifest.owner_id)
        ) - sum(1 for table in skip.values() for kind in table.values() if kind == "matched")

        # Files the restored records need, and where each goes.
        wanted: list[uuid.UUID] = []
        for spec in specs:
            skipped = skip[spec.name]
            column = FILE_COLUMNS.get(spec.name)
            if column is None:
                continue
            for blob in scans[spec.name].blobs:
                if column == spec.identity and blob in skipped:
                    continue
                wanted.append(blob)
        expected = {entry.id: entry.sha256 for entry in manifest.files}
        plan: list[tuple[uuid.UUID, uuid.UUID]] = []
        for blob in dict.fromkeys(wanted):
            if blob not in expected or not source.has_file(blob):
                report.files_missing += 1
                continue
            target = mapping.get(blob, blob)
            existing = await self._files.checksum(workspace.id, target)
            if existing == expected[blob]:
                report.files_reused += 1
                continue
            if existing is not None:
                # A different file already has this name (practically impossible with random
                # IDs): give the restored one a new name rather than overwrite it.
                target = uuid.uuid4()
                mapping[blob] = target
            plan.append((blob, target))
        if report.files_missing:
            report.warnings.append(
                f"{report.files_missing} file(s) aren't in this "
                f"{'backup' if manifest.kind != 'export' else 'export'}; their records are "
                "restored and show the file as missing."
            )

        written: list[uuid.UUID] = []
        try:
            await self._data.begin_write()
            if mode == "replace":
                await self._data.clear_workspace(workspace.id)
            elif mode == "new_workspace":
                await self._data.create_workspace(workspace)
            elif mode == "into_empty" and sum((await self._data.counts(workspace.id)).values()):
                raise RestoreRejectedError(
                    "This workspace isn't empty. Restore into a new workspace or replace this one."
                )
            for spec in specs:
                report.tables.append(
                    await self._write_table(source, spec, workspace, user_id, mapping, skip, merge)
                )
            if not dry_run:
                for blob, target in plan:
                    written.append(target)
                    digest = await self._files.write_stream(
                        workspace.id,
                        target,
                        lambda sink, blob=blob: source.copy_file(blob, sink),
                    )
                    if digest != expected[blob]:
                        raise InvalidArchiveError(
                            "The backup is damaged: a file's checksum doesn't match."
                        )
                report.files_restored = len(plan)
            if not merge:
                await self._verify(specs, source, workspace)
            if dry_run:
                await self._transaction.rollback()
            else:
                await self._transaction.commit()
        except BaseException:
            await self._transaction.rollback()
            if written:
                await self._files.delete(workspace.id, written)
            raise
        return report

    async def _plan_restore(
        self,
        specs: list[TableSpec],
        scans: dict[str, _Scan],
        workspace: Workspace,
        mode: Mode,
        mapping: dict[uuid.UUID, uuid.UUID],
    ) -> None:
        """Keep every ID unless any already exists outside the workspace being replaced."""
        clash = False
        for spec in specs:
            scan = scans[spec.name]
            checks: list[tuple[str, list[uuid.UUID]]] = []
            if spec.identity and scan.ids:
                checks.append((spec.identity, scan.ids))
            column = FILE_COLUMNS.get(spec.name)
            if column and column != spec.identity and scan.blobs:
                checks.append((column, scan.blobs))
            for name, values in checks:
                existing = await self._data.existing_values(spec.name, name, values)
                if any(
                    not (mode == "replace" and owner == workspace.id) for owner in existing.values()
                ):
                    clash = True
                    break
            if clash:
                break
        if not clash:
            return
        for spec in specs:
            scan = scans[spec.name]
            for value in (*scan.ids, *scan.blobs):
                mapping.setdefault(value, uuid.uuid4())

    async def _plan_merge(
        self,
        specs: list[TableSpec],
        scans: dict[str, _Scan],
        workspace: Workspace,
        mapping: dict[uuid.UUID, uuid.UUID],
        skip: dict[str, dict[uuid.UUID, Skip]],
    ) -> None:
        for spec in specs:
            scan = scans[spec.name]
            if not spec.identity or not scan.ids:
                continue
            existing = await self._data.existing_values(spec.name, spec.identity, scan.ids)
            for value, owner in existing.items():
                if owner == workspace.id:
                    skip[spec.name][value] = "duplicate"
                else:
                    mapping[value] = uuid.uuid4()
            # Blob IDs that must be unique across workspaces (progress photos) move with them.
            column = FILE_COLUMNS.get(spec.name)
            if column and column != spec.identity and scan.blobs:
                for value in await self._data.existing_values(spec.name, column, scan.blobs):
                    mapping.setdefault(value, uuid.uuid4())
            for keys in MATCH_KEYS.get(spec.name, ()):
                found = await self._data.natural_keys(spec, workspace.id, keys)
                for value, row in scan.rows_by_id.items():
                    if value in skip[spec.name]:
                        continue
                    key = tuple(row.get(name) for name in keys)
                    if any(part is None or part is False for part in key) or key not in found:
                        continue
                    mapping[value] = found[key]
                    skip[spec.name][value] = "matched"

    async def _write_table(
        self,
        source: RowSource,
        spec: TableSpec,
        workspace: Workspace,
        user_id: uuid.UUID,
        mapping: dict[uuid.UUID, uuid.UUID],
        skip: dict[str, dict[uuid.UUID, Skip]],
        merge: bool,
    ) -> TableResult:
        result = TableResult(table=spec.name, module=spec.module)
        skipped = skip[spec.name]
        existing_keys = (
            await self._data.existing_keys(spec, workspace.id)
            if merge and spec.identity is None
            else set[tuple[Any, ...]]()
        )
        pending: list[Row] = []
        rows = source.iter_rows(spec.name)

        async def flush() -> None:
            if not pending:
                return
            ordered = parents_first(spec, pending)
            added = await self._data.insert(spec, ordered, lenient=merge)
            result.added += added
            result.skipped += len(ordered) - added
            pending.clear()

        while batch := await anyio.to_thread.run_sync(lambda: list(islice(rows, BATCH))):
            for raw in batch:
                row = decode_row(spec, raw)
                identity = row.get(spec.identity) if spec.identity else None
                if identity is not None and identity in skipped:
                    if skipped[identity] == "duplicate":
                        result.duplicates += 1
                    else:
                        result.matched += 1
                    continue
                row = remap_row(spec, row, mapping)
                if spec.scoped:
                    row["workspace_id"] = workspace.id
                for column in spec.user_columns:
                    if row.get(column) is not None:
                        row[column] = user_id
                if existing_keys:
                    key = tuple(row.get(column) for column in spec.primary_key)
                    if key in existing_keys:
                        result.duplicates += 1
                        continue
                pending.append(row)
            # Self-referencing tables are inserted whole, parents first.
            if spec.parent_column is None and len(pending) >= BATCH:
                await flush()
        await flush()
        return result

    async def _verify(
        self, specs: list[TableSpec], source: RowSource, workspace: Workspace
    ) -> None:
        """Every record the backup lists is now in the workspace, and nothing else is."""
        counts = await self._data.counts(workspace.id)
        for spec in specs:
            if counts.get(spec.name, 0) != source.manifest.tables[spec.name].rows:
                raise RestoreFailedError(
                    f"The restored records don't match the backup ({spec.name}). "
                    "Nothing was changed."
                )
