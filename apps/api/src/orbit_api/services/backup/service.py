"""Backups, restores, imports, and exports for one workspace.

Routes and the worker call this service; it decides what happens and in what order, and leaves
SQL to `BackupData`/`BackupRecords` and files to `ArchiveStore`/`AttachmentFiles`.

- **Backups** are recorded before they start (a partial unique index allows one running backup
  per workspace), built in a temporary file, encrypted if asked, checksummed, and moved into the
  backup store. A failure is recorded on the backup with a safe message.
- **Uploads** are staged in the backup store and inspected (structure, checksums, compatibility,
  and a dry run) before anything is restored. Restoring needs the password again (it's never
  stored), an explicit strategy, and, to replace a workspace, its name typed as confirmation;
  replacing first takes a pre-restore backup.
- **Automatic backups** are run by the existing worker from stored schedules.
"""

import json
import logging
import uuid
import zipfile
from collections.abc import AsyncGenerator, Callable, Collection
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Final

import anyio.to_thread

from orbit_api.services.backup import encryption
from orbit_api.services.backup.archive import (
    FORMAT_VERSION,
    ArchiveLimits,
    ArchiveWriter,
    manifest_document,
)
from orbit_api.services.backup.catalog import MODULES, Module
from orbit_api.services.backup.encryption import BackupKey
from orbit_api.services.backup.formats import (
    EXPORT_FORMATS,
    ExportOutput,
    calendar_file,
    module_csv,
    notes_markdown,
)
from orbit_api.services.backup.models import (
    ArchiveSummary,
    Backup,
    BackupError,
    BackupFailedError,
    BackupFileMissingError,
    BackupKeyMissingError,
    BackupKind,
    BackupNotFoundError,
    BackupRunningError,
    BackupSettings,
    BackupUpload,
    Encryption,
    ExportFormat,
    Frequency,
    IncompatibleArchiveError,
    Inspection,
    InvalidArchiveError,
    KeyMaterial,
    PasswordRequiredError,
    RestoreRejectedError,
    RestoreReport,
    RestoreStrategy,
    TargetState,
    UploadKind,
    UploadNotFoundError,
)
from orbit_api.services.backup.ports import ArchiveStore, AttachmentFiles, BackupData, BackupRecords
from orbit_api.services.backup.restore import Mode, Restorer
from orbit_api.services.backup.schedule import STALE_AFTER, first_run, next_run, retry_at
from orbit_api.services.backup.sources import (
    ArchiveSource,
    ExportSource,
    RowSource,
    export_document,
)
from orbit_api.services.backup.writer import collect_tables, file_digest, write_archive
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.services.workspaces.models import Workspace
from orbit_api.services.workspaces.service import new_workspace

logger = logging.getLogger(__name__)

UPLOAD_TTL: Final = timedelta(hours=24)
HISTORY_LIMIT: Final = 100
UPLOAD_LIMIT: Final = 20
_RESTORABLE: Final = ("uploaded", "failed")


@dataclass(frozen=True, slots=True)
class BackupEnvironment:
    """Facts about this installation that go into every manifest."""

    app_version: str
    schema_revision: str
    # Every migration revision this version knows, oldest first.
    known_revisions: tuple[str, ...]
    storage_mode: str
    limits: ArchiveLimits


@dataclass(frozen=True, slots=True)
class Overview:
    settings: BackupSettings
    backups: list[Backup]
    uploads: list[BackupUpload]

    @property
    def total_bytes(self) -> int:
        return sum(backup.size_bytes or 0 for backup in self.backups)

    @property
    def last_success(self) -> Backup | None:
        return next((b for b in self.backups if b.status == "succeeded"), None)

    @property
    def running(self) -> Backup | None:
        return next((b for b in self.backups if b.status == "running"), None)


@dataclass(frozen=True, slots=True)
class SettingsChanges:
    frequency: Frequency
    retention_count: int
    include_files: bool
    encrypt: bool
    # A new backup password: creates a new backup key. Earlier backups keep the password they
    # were made with.
    password: str | None = None


@dataclass(frozen=True, slots=True)
class ApplyRequest:
    strategy: RestoreStrategy | None
    password: str | None = None
    workspace_name: str | None = None
    confirm_name: str | None = None
    allow_repeat: bool = False
    dry_run: bool = False


@dataclass(frozen=True, slots=True)
class Verification:
    ok: bool
    # `checksum`: the archive is byte-for-byte what was stored; `full`: every part was also
    # opened and checked against the manifest.
    level: str
    message: str


@dataclass(frozen=True, slots=True)
class ExportFile:
    path: Path
    filename: str
    media_type: str


def _safe_message(exc: BaseException, fallback: str) -> str:
    return exc.message if isinstance(exc, BackupError) else fallback


def report_dict(report: RestoreReport) -> dict[str, Any]:
    data = asdict(report)
    data["workspace_id"] = str(report.workspace_id)
    data["pre_restore_backup_id"] = (
        str(report.pre_restore_backup_id) if report.pre_restore_backup_id else None
    )
    return data


def _detect(path: Path) -> tuple[UploadKind, bool]:
    with path.open("rb") as file:
        head = file.read(16)
    if head.startswith(encryption.MAGIC):
        return "backup", True
    if head.startswith(b"PK\x03\x04"):
        return "backup", False
    if head.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"{"):
        return "export", False
    raise InvalidArchiveError(
        "Choose an Orbit backup (.zip or .orbit-backup) or an Orbit JSON export."
    )


def _clean_filename(value: str) -> str:
    name = value.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(char for char in name if char >= " " and char != "\x7f").strip().lstrip(".")
    return name[:255] or "upload"


class BackupService:
    def __init__(
        self,
        data: BackupData,
        records: BackupRecords,
        archives: ArchiveStore,
        files: AttachmentFiles,
        transaction: Transaction,
        environment: BackupEnvironment,
        clock: Callable[[], datetime],
    ) -> None:
        self._data = data
        self._records = records
        self._archives = archives
        self._files = files
        self._transaction = transaction
        self._env = environment
        self._clock = clock
        self._restorer = Restorer(data, files, transaction)

    # Overview and settings

    async def settings(self, workspace_id: uuid.UUID) -> BackupSettings:
        return await self._records.get_settings(workspace_id) or BackupSettings(workspace_id)

    async def overview(self, workspace_id: uuid.UUID) -> Overview:
        return Overview(
            settings=await self.settings(workspace_id),
            backups=await self._records.list_backups(workspace_id, HISTORY_LIMIT),
            uploads=await self._records.list_uploads(workspace_id, UPLOAD_LIMIT),
        )

    async def update_settings(
        self, workspace_id: uuid.UUID, changes: SettingsChanges
    ) -> BackupSettings:
        current = await self.settings(workspace_id)
        now = self._clock()
        key = current.key
        if changes.password is not None:
            created = await anyio.to_thread.run_sync(encryption.create_key, changes.password)
            key = KeyMaterial(created.public_key, created.sealed_private_key, now)
        if changes.encrypt and key is None:
            raise BackupKeyMissingError
        if changes.frequency == "manual":
            next_at = None
        elif changes.frequency == current.frequency and current.next_run_at is not None:
            next_at = current.next_run_at
        else:
            next_at = first_run(changes.frequency, now)
        updated = replace(
            current,
            frequency=changes.frequency,
            retention_count=changes.retention_count,
            include_files=changes.include_files,
            encrypt=changes.encrypt,
            key=key,
            next_run_at=next_at,
            updated_at=now,
        )
        await self._records.save_settings(updated)
        await self._transaction.commit()
        return updated

    # Creating backups

    async def create_backup(
        self,
        workspace: Workspace,
        user_id: uuid.UUID,
        *,
        kind: BackupKind,
        include_files: bool,
        encryption_mode: Encryption,
        password: str | None = None,
    ) -> Backup:
        now = self._clock()
        await self._records.fail_stale_backups(now - STALE_AFTER, now)
        backup = Backup(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            user_id=user_id,
            kind=kind,
            status="running",
            include_files=include_files,
            encrypted=encryption_mode != "none",
            size_bytes=None,
            sha256=None,
            record_count=0,
            file_count=0,
            modules=(),
            record_counts={},
            warnings=(),
            error=None,
            format_version=FORMAT_VERSION,
            schema_revision=self._env.schema_revision,
            app_version=self._env.app_version,
            started_at=now,
            finished_at=None,
            created_at=now,
        )
        try:
            await self._records.add_backup(backup)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise BackupRunningError from None

        try:
            key = await self._key_for(workspace.id, encryption_mode, password)
            path, written = await self._build(workspace, user_id, kind, include_files, key)
            try:
                size, sha = await file_digest(path)
                await self._archives.keep_backup(workspace.id, backup.id, path)
            except BaseException:
                await self._archives.remove(path)
                raise
        except Exception as exc:
            # Deliberate boundary: any failure is recorded on the backup before it's reported,
            # so the history shows what happened. The type only: messages could hold data.
            await self._transaction.rollback()
            message = _safe_message(exc, "The backup couldn't be completed.")
            logger.warning("Backup %s failed: %s", backup.id, type(exc).__name__, exc_info=exc)
            await self._records.finish_backup(
                backup.id, status="failed", finished_at=self._clock(), fields={"error": message}
            )
            await self._transaction.commit()
            raise BackupFailedError(message) from exc

        warnings: list[str] = []
        if written.missing_files:
            warnings.append(
                f"{len(written.missing_files)} file(s) were missing from storage and aren't "
                "in this backup."
            )
        counts = written.record_counts()
        await self._records.finish_backup(
            backup.id,
            status="succeeded",
            finished_at=self._clock(),
            fields={
                "size_bytes": size,
                "sha256": sha,
                "record_count": sum(counts.values()),
                "file_count": len(written.files),
                "modules": written.modules,
                "record_counts": counts,
                "warnings": warnings,
            },
        )
        await self._transaction.commit()
        stored = await self._records.get_backup(workspace.id, backup.id)
        assert stored is not None
        return stored

    async def _key_for(
        self, workspace_id: uuid.UUID, mode: Encryption, password: str | None
    ) -> BackupKey | None:
        if mode == "none":
            return None
        if mode == "password":
            if not password:
                raise BackupError("Enter a password to encrypt this backup.")
            return await anyio.to_thread.run_sync(encryption.create_key, password)
        settings = await self._records.get_settings(workspace_id)
        if settings is None or settings.key is None:
            raise BackupKeyMissingError
        return BackupKey(settings.key.public_key, settings.key.sealed_private_key)

    async def _build(
        self,
        workspace: Workspace,
        user_id: uuid.UUID,
        kind: str,
        include_files: bool,
        key: BackupKey | None,
    ) -> tuple[Path, Any]:
        """The archive in a temporary file (encrypted if `key`), and what went into it."""
        plain = await self._archives.temporary(".zip")
        try:
            writer = await anyio.to_thread.run_sync(ArchiveWriter, plain)
            try:
                written = await write_archive(
                    self._data,
                    self._files,
                    writer,
                    workspace_id=workspace.id,
                    user_id=user_id,
                    include_files=include_files,
                )
                manifest = manifest_document(
                    kind=kind,
                    app_version=self._env.app_version,
                    schema_revision=self._env.schema_revision,
                    created_at=self._clock(),
                    storage_mode=self._env.storage_mode,
                    workspace_id=workspace.id,
                    workspace_name=workspace.name,
                    owner_id=user_id,
                    include_files=include_files,
                    modules=written.modules,
                    tables=written.tables,
                    files=written.files,
                    missing_files=written.missing_files,
                )
                await anyio.to_thread.run_sync(writer.finish, manifest)
            except BaseException:
                await anyio.to_thread.run_sync(writer.close)
                raise
            if key is None:
                return plain, written
            sealed = await self._archives.temporary(".enc")
            try:
                await anyio.to_thread.run_sync(encryption.encrypt_file, plain, sealed, key)
            except BaseException:
                await self._archives.remove(sealed)
                raise
            await self._archives.remove(plain)
            return sealed, written
        except BaseException:
            await self._archives.remove(plain)
            raise

    # Stored backups

    async def get_backup(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> Backup:
        backup = await self._records.get_backup(workspace_id, backup_id)
        if backup is None:
            raise BackupNotFoundError
        return backup

    async def open_backup(
        self, workspace_id: uuid.UUID, backup_id: uuid.UUID
    ) -> tuple[Backup, Path]:
        backup = await self.get_backup(workspace_id, backup_id)
        if backup.status != "succeeded":
            raise BackupNotFoundError
        path = await self._archives.backup_path(workspace_id, backup_id)
        if path is None:
            raise BackupFileMissingError
        return backup, path

    async def delete_backup(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> None:
        backup = await self.get_backup(workspace_id, backup_id)
        if backup.status == "running":
            raise BackupRunningError
        await self._records.delete_backup(backup_id)
        await self._transaction.commit()
        await self._archives.delete_backup(workspace_id, backup_id)

    async def verify_backup(
        self, workspace_id: uuid.UUID, backup_id: uuid.UUID, password: str | None
    ) -> Verification:
        backup, path = await self.open_backup(workspace_id, backup_id)
        _, digest = await file_digest(path)
        if digest != backup.sha256:
            return Verification(
                ok=False, level="checksum", message="The archive changed after it was made."
            )
        if backup.encrypted and not password:
            return Verification(
                ok=True,
                level="checksum",
                message="The archive is unchanged. Enter its password to check its contents too.",
            )
        try:
            async with self._source(path, "backup", backup.encrypted, password) as source:
                await anyio.to_thread.run_sync(source.verify)
        except InvalidArchiveError as exc:
            return Verification(ok=False, level="full", message=exc.message)
        return Verification(
            ok=True, level="full", message="Every record and file matches its checksum."
        )

    # Exports

    async def export_archive(
        self, workspace: Workspace, user_id: uuid.UUID, *, include_files: bool, password: str | None
    ) -> ExportFile:
        """A backup archive to download, not kept on the server."""
        key = await self._key_for(workspace.id, "password" if password else "none", password)
        path, _ = await self._build(workspace, user_id, "export", include_files, key)
        stamp = self._clock().date().isoformat()
        if key is None:
            return ExportFile(path, f"orbit-backup-{stamp}.zip", "application/zip")
        return ExportFile(path, f"orbit-backup-{stamp}.orbit-backup", "application/octet-stream")

    async def export_module(
        self,
        workspace: Workspace,
        user_id: uuid.UUID,
        module: Module | None,
        format: ExportFormat,
    ) -> ExportFile:
        """One module (or, with `module=None`, every module) in a supported format."""
        if module is None and format != "json":
            raise BackupError("The whole workspace exports as JSON or as a backup archive.")
        if module is not None and format not in EXPORT_FORMATS[module]:
            raise BackupError("That format isn't available for this module.")
        modules: Collection[Module] | None = None if module is None else (module,)
        tables = await collect_tables(
            self._data, workspace_id=workspace.id, user_id=user_id, modules=modules
        )
        now = self._clock()
        stem = f"orbit-{module or 'workspace'}-{now.date().isoformat()}"
        if format == "json":
            document = export_document(
                app_version=self._env.app_version,
                schema_revision=self._env.schema_revision,
                created_at=now,
                workspace_id=workspace.id,
                workspace_name=workspace.name,
                owner_id=user_id,
                modules=list(MODULES if module is None else (module,)),
                tables=tables,
            )
            path = await self._archives.temporary(".json")
            await anyio.to_thread.run_sync(_write_json, path, document)
            return ExportFile(path, f"{stem}.json", "application/json")
        assert module is not None
        if format == "csv":
            output = module_csv(module, self._data.specs(), tables, stem)
        elif format == "markdown":
            output = notes_markdown(tables, stem)
        else:
            output = calendar_file(tables, stem, workspace.name, now)
        path = await self._archives.temporary(".out")
        await anyio.to_thread.run_sync(_write_output, path, output)
        return ExportFile(path, output.filename, output.media_type)

    async def discard_file(self, path: Path) -> None:
        await self._archives.remove(path)

    # Uploads, inspection, and restore

    async def receive_upload(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, path: Path, filename: str
    ) -> BackupUpload:
        """Stage an uploaded file (already written to `path`, a temporary file)."""
        try:
            kind, encrypted = await anyio.to_thread.run_sync(_detect, path)
            if not encrypted:
                # Check the structure now, so a wrong file is refused at once.
                source = await anyio.to_thread.run_sync(self._open_plain, path, kind)
                await anyio.to_thread.run_sync(source.close)
            size, sha = await file_digest(path)
            now = self._clock()
            upload = BackupUpload(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                user_id=user_id,
                kind=kind,
                encrypted=encrypted,
                filename=_clean_filename(filename),
                size_bytes=size,
                sha256=sha,
                status="uploaded",
                result=None,
                error=None,
                created_at=now,
                expires_at=now + UPLOAD_TTL,
                finished_at=None,
            )
            await self._archives.keep_upload(workspace_id, upload.id, path)
        except BaseException:
            await self._archives.remove(path)
            raise
        await self._records.add_upload(upload)
        await self._transaction.commit()
        return upload

    def _open_plain(self, path: Path, kind: UploadKind) -> RowSource:
        if kind == "export":
            return ExportSource(path)
        return ArchiveSource(path, self._env.limits)

    @asynccontextmanager
    async def _source(
        self, path: Path, kind: UploadKind, encrypted: bool, password: str | None
    ) -> AsyncGenerator[RowSource]:
        decrypted: Path | None = None
        try:
            if encrypted:
                if not password:
                    raise PasswordRequiredError
                decrypted = await self._archives.temporary(".zip")
                await anyio.to_thread.run_sync(
                    lambda: encryption.decrypt_file(
                        path, decrypted, password, max_bytes=self._env.limits.max_extracted_bytes
                    )
                )
                path = decrypted
            source = await anyio.to_thread.run_sync(self._open_plain, path, kind)
            try:
                yield source
            finally:
                await anyio.to_thread.run_sync(source.close)
        finally:
            if decrypted is not None:
                await self._archives.remove(decrypted)

    async def _upload(
        self, workspace_id: uuid.UUID, upload_id: uuid.UUID
    ) -> tuple[BackupUpload, Path]:
        upload = await self._records.get_upload(workspace_id, upload_id)
        if upload is None:
            raise UploadNotFoundError
        if upload.status not in _RESTORABLE:
            raise RestoreRejectedError(
                "This upload was already used or has expired. Upload the file again."
            )
        path = await self._archives.upload_path(workspace_id, upload_id)
        if path is None:
            raise RestoreRejectedError("This upload has expired. Upload the file again.")
        return upload, path

    def _check_revision(self, revision: str) -> str | None:
        """A warning for an older schema; raises for one this version doesn't know."""
        known = self._env.known_revisions
        if revision not in known:
            raise IncompatibleArchiveError(
                "This file was made by a newer version of Orbit. Update Orbit to restore it."
            )
        if revision != self._env.schema_revision:
            return (
                "This file was made by an earlier version of Orbit. Its records are checked "
                "against this version as they're restored."
            )
        return None

    async def list_uploads(self, workspace_id: uuid.UUID) -> list[BackupUpload]:
        return await self._records.list_uploads(workspace_id, UPLOAD_LIMIT)

    async def inspect(
        self, workspace: Workspace, user_id: uuid.UUID, upload_id: uuid.UUID, password: str | None
    ) -> Inspection:
        upload, path = await self._upload(workspace.id, upload_id)
        counts = await self._data.counts(workspace.id)
        target = TargetState(
            record_count=sum(counts.values()),
            has_integrations=await self._data.has_integrations(workspace.id),
        )
        async with self._source(path, upload.kind, upload.encrypted, password) as source:
            manifest = source.manifest
            summary = ArchiveSummary(
                kind=upload.kind,
                format_version=manifest.format_version,
                app_version=manifest.app_version,
                schema_revision=manifest.schema_revision,
                created_at=manifest.created_at,
                source_workspace_id=manifest.workspace_id,
                source_workspace_name=manifest.workspace_name,
                include_files=manifest.include_files,
                module_counts=manifest.module_counts(),
                file_count=len(manifest.files),
                file_bytes=sum(entry.size for entry in manifest.files),
                missing_files=len(manifest.missing_files),
            )
            warnings: list[str] = []
            issues: list[str] = []
            if manifest.missing_files:
                warnings.append(
                    f"{len(manifest.missing_files)} file(s) were already missing when this "
                    "backup was made."
                )
            if upload.kind == "backup" and not manifest.include_files:
                warnings.append(
                    "This backup doesn't include files. Documents, attachments, and photos "
                    "will show their files as missing."
                )
            repeat = await self._records.completed_upload_with(
                workspace.id, upload.sha256, upload.id
            )
            if repeat is not None:
                used = "imported" if upload.kind == "export" else "restored"
                warnings.append(
                    f"This file was already {used} here on {repeat.created_at.date().isoformat()}."
                )
            report: RestoreReport | None = None
            try:
                await anyio.to_thread.run_sync(source.verify)
                note = self._check_revision(manifest.schema_revision)
                if note:
                    warnings.append(note)
                preview_target = (
                    workspace
                    if upload.kind == "export"
                    else new_workspace(
                        user_id, _restored_name(manifest.workspace_name), is_personal=False
                    )
                )
                report = await self._restorer.run(
                    source,
                    preview_target,
                    user_id,
                    "merge" if upload.kind == "export" else "new_workspace",
                    dry_run=True,
                )
                warnings.extend(report.warnings)
            except (InvalidArchiveError, IncompatibleArchiveError, RestoreRejectedError) as exc:
                issues.append(exc.message)
            except BackupError as exc:
                issues.append(exc.message)
        return Inspection(
            summary=summary,
            compatible=not issues,
            issues=tuple(issues),
            warnings=tuple(dict.fromkeys(warnings)),
            target=target,
            dry_run=report,
        )

    async def apply(
        self,
        workspace: Workspace,
        user_id: uuid.UUID,
        upload_id: uuid.UUID,
        request: ApplyRequest,
    ) -> RestoreReport:
        upload, path = await self._upload(workspace.id, upload_id)
        mode = self._mode(upload.kind, request.strategy)
        if mode == "replace":
            if request.confirm_name != workspace.name:
                raise RestoreRejectedError(
                    "Type the workspace's name exactly to confirm replacing its data."
                )
            if await self._data.has_integrations(workspace.id):
                raise RestoreRejectedError(
                    "Disconnect this workspace's integrations before replacing its data, or "
                    "restore into a new workspace."
                )
        if not request.dry_run and not request.allow_repeat:
            repeat = await self._records.completed_upload_with(
                workspace.id, upload.sha256, upload.id
            )
            if repeat is not None:
                raise RestoreRejectedError(
                    "This file was already used here on "
                    f"{repeat.created_at.date().isoformat()}. Confirm to use it again."
                )
        if not request.dry_run:
            claimed = await self._records.update_upload(
                upload.id,
                status="restoring",
                expected=_RESTORABLE,
                expires_at=self._clock() + STALE_AFTER,
            )
            await self._transaction.commit()
            if not claimed:
                raise RestoreRejectedError("This upload is already being restored.")
        try:
            async with self._source(
                path, upload.kind, upload.encrypted, request.password
            ) as source:
                await anyio.to_thread.run_sync(source.verify)
                self._check_revision(source.manifest.schema_revision)
                pre_restore: uuid.UUID | None = None
                if mode == "replace" and not request.dry_run:
                    settings = await self.settings(workspace.id)
                    pre = await self.create_backup(
                        workspace,
                        user_id,
                        kind="pre_restore",
                        include_files=True,
                        encryption_mode="backup_key"
                        if settings.encrypt and settings.key
                        else "none",
                    )
                    pre_restore = pre.id
                target = workspace
                if mode == "new_workspace":
                    name = (request.workspace_name or "").strip() or _restored_name(
                        source.manifest.workspace_name
                    )
                    target = new_workspace(user_id, name[:100], is_personal=False)
                report = await self._restorer.run(
                    source, target, user_id, mode, dry_run=request.dry_run
                )
                report.pre_restore_backup_id = pre_restore
        except BaseException as exc:
            if not request.dry_run:
                await self._transaction.rollback()
                await self._records.update_upload(
                    upload.id,
                    status="failed",
                    error=_safe_message(exc, "The restore failed. Nothing was changed."),
                    finished_at=self._clock(),
                    expires_at=upload.expires_at,
                )
                await self._transaction.commit()
            raise
        if not request.dry_run:
            await self._records.update_upload(
                upload.id,
                status="completed",
                result=report_dict(report),
                finished_at=self._clock(),
            )
            await self._transaction.commit()
            await self._archives.delete_upload(workspace.id, upload.id)
        return report

    def _mode(self, kind: UploadKind, strategy: RestoreStrategy | None) -> Mode:
        if kind == "export":
            return "merge"
        if strategy is None:
            raise RestoreRejectedError("Choose how to restore this backup.")
        return strategy

    async def discard_upload(self, workspace_id: uuid.UUID, upload_id: uuid.UUID) -> None:
        upload = await self._records.get_upload(workspace_id, upload_id)
        if upload is None:
            raise UploadNotFoundError
        if upload.status in _RESTORABLE:
            await self._records.update_upload(upload.id, status="discarded", expected=_RESTORABLE)
            await self._transaction.commit()
        await self._archives.delete_upload(workspace_id, upload_id)

    # Automatic backups and housekeeping (run by the worker)

    async def run_scheduled(self, settings: BackupSettings, workspace: Workspace) -> Backup | None:
        """Run a due automatic backup, unless another worker already took it; then prune."""
        now = self._clock()
        following = next_run(settings.frequency, settings.next_run_at, now)
        claimed = await self._records.claim_run(workspace.id, settings.next_run_at, following, now)
        await self._transaction.commit()
        if not claimed:
            return None
        try:
            backup = await self.create_backup(
                workspace,
                workspace.owner_id,
                kind="scheduled",
                include_files=settings.include_files,
                encryption_mode="backup_key" if settings.encrypt else "none",
            )
        except BackupError:
            # Recorded on the backup (or another is running); try again in an hour.
            await self._records.set_next_run(workspace.id, retry_at(following, self._clock()))
            await self._transaction.commit()
            return None
        for old in await self._records.scheduled_beyond(workspace.id, settings.retention_count):
            await self._records.delete_backup(old.id)
            await self._transaction.commit()
            await self._archives.delete_backup(workspace.id, old.id)
        return backup

    async def housekeeping(self) -> None:
        """Fail backups and restores whose process died, and expire unused uploads."""
        now = self._clock()
        await self._records.fail_stale_backups(now - STALE_AFTER, now)
        for upload in await self._records.stale_restores(now):
            await self._records.update_upload(
                upload.id,
                status="failed",
                expected=("restoring",),
                error="The restore was interrupted. Nothing was changed.",
                finished_at=now,
                expires_at=now + UPLOAD_TTL,
            )
        await self._transaction.commit()
        for upload in await self._records.expired_uploads(now):
            await self._records.update_upload(upload.id, status="expired", expected=_RESTORABLE)
            await self._transaction.commit()
            await self._archives.delete_upload(upload.workspace_id, upload.id)


def _restored_name(name: str) -> str:
    suffix = " (restored)"
    return name[: 100 - len(suffix)] + suffix


def _write_json(path: Path, document: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(document, file, ensure_ascii=False, separators=(",", ":"))


def _write_output(path: Path, output: ExportOutput) -> None:
    if output.text is not None:
        path.write_text(output.text, encoding="utf-8", newline="")
        return
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, text in output.entries:
            archive.writestr(name, text)
