"""What the backup services need from storage, as protocols, so they stay free of SQLAlchemy
and of where files live."""

import uuid
from collections.abc import AsyncIterator, Callable, Collection, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import IO, Any, Protocol

from orbit_api.services.backup.catalog import TableSpec
from orbit_api.services.backup.models import (
    Backup,
    BackupSettings,
    BackupStatus,
    BackupUpload,
    UploadStatus,
)
from orbit_api.services.workspaces.models import Workspace


class BackupData(Protocol):
    """Generic access to every backed-up table, always within one workspace."""

    def specs(self) -> Sequence[TableSpec]:
        """Backed-up tables in an order that inserts parents before children."""
        ...

    async def begin_snapshot(self) -> None:
        """Start a read transaction that sees one consistent state of every table."""
        ...

    async def end_snapshot(self) -> None: ...

    def stream_rows(
        self, spec: TableSpec, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> AsyncIterator[list[Mapping[str, Any]]]:
        """The workspace's rows of `spec`, in batches. Tables with an owning user column give
        only `user_id`'s rows (health data is private to whoever recorded it)."""
        ...

    async def begin_write(self) -> None:
        """Start the write transaction a restore runs in (savepoints nest inside it)."""
        ...

    async def existing_values(
        self, table: str, column: str, values: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, uuid.UUID | None]:
        """Which of `values` already exist in `table.column`, in any workspace, and the
        workspace each belongs to (`None` for tables without one)."""
        ...

    async def existing_keys(self, spec: TableSpec, workspace_id: uuid.UUID) -> set[tuple[Any, ...]]:
        """The primary keys of `spec`'s rows in the workspace (for link tables)."""
        ...

    async def natural_keys(
        self, spec: TableSpec, workspace_id: uuid.UUID, columns: tuple[str, ...]
    ) -> dict[tuple[Any, ...], uuid.UUID]:
        """Existing rows' values of `columns`, mapped to their IDs."""
        ...

    async def insert(self, spec: TableSpec, rows: list[dict[str, Any]], *, lenient: bool) -> int:
        """Insert `rows`; return how many were inserted. Strict: any failure raises
        `RestoreFailedError`. Lenient: rows that violate a constraint are skipped."""
        ...

    async def counts(self, workspace_id: uuid.UUID) -> dict[str, int]:
        """Rows per backed-up table in the workspace."""
        ...

    async def has_integrations(self, workspace_id: uuid.UUID) -> bool: ...

    async def create_workspace(self, workspace: Workspace) -> None: ...

    async def clear_workspace(self, workspace_id: uuid.UUID) -> None:
        """Delete everything in the workspace except the workspace itself and its backup
        history, settings, and uploads."""
        ...


class BackupRecords(Protocol):
    """Backup history, settings, and uploads."""

    async def add_backup(self, backup: Backup) -> None:
        """Raises `ConflictError` when a backup of the workspace is already running."""
        ...

    async def finish_backup(
        self,
        backup_id: uuid.UUID,
        *,
        status: BackupStatus,
        finished_at: datetime,
        fields: Mapping[str, Any],
    ) -> None: ...

    async def get_backup(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> Backup | None: ...

    async def list_backups(self, workspace_id: uuid.UUID, limit: int) -> list[Backup]: ...

    async def delete_backup(self, backup_id: uuid.UUID) -> None: ...

    async def fail_stale_backups(self, started_before: datetime, now: datetime) -> int:
        """Mark backups still running since before `started_before` as failed."""
        ...

    async def scheduled_beyond(self, workspace_id: uuid.UUID, keep: int) -> list[Backup]:
        """Successful scheduled backups older than the newest `keep`."""
        ...

    async def get_settings(self, workspace_id: uuid.UUID) -> BackupSettings | None: ...

    async def save_settings(self, settings: BackupSettings) -> None: ...

    async def due_settings(self, now: datetime) -> list[tuple[BackupSettings, Workspace]]:
        """Automatic backups due now, with their workspaces."""
        ...

    async def claim_run(
        self,
        workspace_id: uuid.UUID,
        expected: datetime | None,
        next_run_at: datetime | None,
        now: datetime,
    ) -> bool:
        """Move the next run from `expected` to `next_run_at` if no one else has; whoever
        moves it runs the backup."""
        ...

    async def set_next_run(self, workspace_id: uuid.UUID, next_run_at: datetime | None) -> None: ...

    async def add_upload(self, upload: BackupUpload) -> None: ...

    async def get_upload(
        self, workspace_id: uuid.UUID, upload_id: uuid.UUID
    ) -> BackupUpload | None: ...

    async def list_uploads(self, workspace_id: uuid.UUID, limit: int) -> list[BackupUpload]: ...

    async def update_upload(
        self,
        upload_id: uuid.UUID,
        *,
        status: UploadStatus,
        expected: Collection[UploadStatus] | None = None,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        finished_at: datetime | None = None,
        expires_at: datetime | None = None,
    ) -> bool:
        """Change the status (only from one of `expected`, if given); return whether it did."""
        ...

    async def completed_upload_with(
        self, workspace_id: uuid.UUID, sha256: str, exclude: uuid.UUID
    ) -> BackupUpload | None:
        """An earlier upload of the same file that was already restored or imported here."""
        ...

    async def expired_uploads(self, now: datetime) -> list[BackupUpload]: ...

    async def stale_restores(self, now: datetime) -> list[BackupUpload]:
        """Restores still running past their deadline (their process died)."""
        ...


class ArchiveStore(Protocol):
    """Where stored backups and staged uploads live (a folder on the API's machine)."""

    async def temporary(self, suffix: str) -> Path:
        """A new private (`0600`) temporary file beside the archives, for the caller to move
        into place or delete."""
        ...

    async def keep_backup(
        self, workspace_id: uuid.UUID, backup_id: uuid.UUID, source: Path
    ) -> None:
        """Move `source` into place as the backup's archive."""
        ...

    async def backup_path(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> Path | None: ...

    async def delete_backup(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> None: ...

    async def keep_upload(
        self, workspace_id: uuid.UUID, upload_id: uuid.UUID, source: Path
    ) -> None: ...

    async def upload_path(self, workspace_id: uuid.UUID, upload_id: uuid.UUID) -> Path | None: ...

    async def delete_upload(self, workspace_id: uuid.UUID, upload_id: uuid.UUID) -> None: ...

    async def remove(self, path: Path) -> None: ...


class AttachmentFiles(Protocol):
    """The attachment store, as a backup reads and restores it."""

    async def locate(self, workspace_id: uuid.UUID, attachment_id: uuid.UUID) -> Path | None: ...

    async def checksum(self, workspace_id: uuid.UUID, blob_id: uuid.UUID) -> str | None: ...

    async def write_stream(
        self,
        workspace_id: uuid.UUID,
        blob_id: uuid.UUID,
        copy: Callable[[Callable[[IO[bytes]], str]], str],
    ) -> str:
        """Write a file whose bytes `copy` streams to the writer it's given; return the
        SHA-256 written."""
        ...

    async def delete(
        self, workspace_id: uuid.UUID, attachment_ids: Sequence[uuid.UUID]
    ) -> None: ...
