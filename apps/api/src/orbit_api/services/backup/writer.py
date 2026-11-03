"""Writing a workspace's records (and files) out: backup archives and JSON exports.

Records are read inside one snapshot (`BackupData.begin_snapshot`), so every table reflects the
same moment even while people keep working: on SQLite a single read transaction (in WAL mode a
reader sees one state and doesn't block writers), on PostgreSQL a `REPEATABLE READ READ ONLY`
transaction. The snapshot ends before files are copied; stored files never change once written
(a new version is a new file), so the files a snapshot names are the ones it meant. A file that
was deleted in between is listed as missing in the manifest rather than failing the backup.
"""

import hashlib
import uuid
from collections.abc import Collection
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio.to_thread

from orbit_api.services.backup.archive import ArchiveWriter
from orbit_api.services.backup.catalog import FILE_COLUMNS, Module, TableSpec
from orbit_api.services.backup.models import FileEntry, TableEntry
from orbit_api.services.backup.ports import AttachmentFiles, BackupData
from orbit_api.services.backup.rows import encode_row


@dataclass(slots=True)
class Written:
    tables: dict[str, TableEntry] = field(default_factory=dict[str, TableEntry])
    files: list[FileEntry] = field(default_factory=list[FileEntry])
    missing_files: list[uuid.UUID] = field(default_factory=list[uuid.UUID])

    @property
    def modules(self) -> list[str]:
        return list(dict.fromkeys(entry.module for entry in self.tables.values()))

    def record_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for entry in self.tables.values():
            counts[entry.module] = counts.get(entry.module, 0) + entry.rows
        return counts


def _selected(specs: Collection[TableSpec], modules: Collection[Module] | None) -> list[TableSpec]:
    return [spec for spec in specs if modules is None or spec.module in modules]


async def write_archive(
    data: BackupData,
    files: AttachmentFiles,
    writer: ArchiveWriter,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    include_files: bool,
) -> Written:
    """Every backed-up table and (optionally) file of the workspace into `writer`."""
    written = Written()
    blobs: list[uuid.UUID] = []
    await data.begin_snapshot()
    try:
        for spec in data.specs():
            column = FILE_COLUMNS.get(spec.name)
            await anyio.to_thread.run_sync(writer.begin_table, spec.name)
            count = 0
            async for batch in data.stream_rows(spec, workspace_id, user_id):
                encoded = [encode_row(spec, row) for row in batch]
                if column is not None:
                    blobs.extend(row[column] for row in batch if row.get(column) is not None)
                await anyio.to_thread.run_sync(writer.write_rows, encoded)
                count += len(batch)
            await anyio.to_thread.run_sync(writer.end_table, spec.module, count)
    finally:
        await data.end_snapshot()
    written.tables = dict(writer.tables)
    if include_files:
        for blob in dict.fromkeys(blobs):
            path = await files.locate(workspace_id, blob)
            if path is None:
                written.missing_files.append(blob)
                continue
            try:
                await anyio.to_thread.run_sync(writer.add_file, blob, path)
            except FileNotFoundError:
                # Deleted between the lookup and the copy (a version removed meanwhile).
                written.missing_files.append(blob)
        written.files = list(writer.files)
    return written


async def collect_tables(
    data: BackupData,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    modules: Collection[Module] | None,
) -> dict[str, list[dict[str, Any]]]:
    """The selected modules' records as JSON-ready rows, from one snapshot."""
    tables: dict[str, list[dict[str, Any]]] = {}
    await data.begin_snapshot()
    try:
        for spec in _selected(data.specs(), modules):
            rows: list[dict[str, Any]] = []
            async for batch in data.stream_rows(spec, workspace_id, user_id):
                rows.extend(encode_row(spec, row) for row in batch)
            tables[spec.name] = rows
    finally:
        await data.end_snapshot()
    return tables


async def file_digest(path: Path) -> tuple[int, str]:
    """Size and SHA-256 of a file, read in a worker thread."""

    def digest() -> tuple[int, str]:
        sha = hashlib.sha256()
        size = 0
        with path.open("rb") as file:
            while chunk := file.read(1024 * 1024):
                sha.update(chunk)
                size += len(chunk)
        return size, sha.hexdigest()

    return await anyio.to_thread.run_sync(digest)
