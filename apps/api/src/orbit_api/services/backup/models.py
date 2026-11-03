"""Backups, restores, and imports: domain types and errors."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

BackupKind = Literal["manual", "scheduled", "pre_restore"]
BackupStatus = Literal["running", "succeeded", "failed"]
Frequency = Literal["manual", "daily", "weekly", "monthly"]
Encryption = Literal["none", "password", "backup_key"]
RestoreStrategy = Literal["new_workspace", "into_empty", "replace"]
UploadKind = Literal["backup", "export"]
UploadStatus = Literal["uploaded", "restoring", "completed", "failed", "expired", "discarded"]
ExportFormat = Literal["json", "csv", "ics", "markdown"]

DEFAULT_RETENTION = 7
MIN_PASSWORD_LENGTH = 10


@dataclass(frozen=True, slots=True)
class Backup:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    kind: BackupKind
    status: BackupStatus
    include_files: bool
    encrypted: bool
    size_bytes: int | None
    sha256: str | None
    record_count: int
    file_count: int
    modules: tuple[str, ...]
    record_counts: dict[str, int]
    warnings: tuple[str, ...]
    error: str | None
    format_version: int
    schema_revision: str
    app_version: str
    started_at: datetime
    finished_at: datetime | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class KeyMaterial:
    """The backup key: its public half, and its private half sealed with the backup password."""

    public_key: str
    sealed_private_key: dict[str, Any]
    created_at: datetime


@dataclass(frozen=True, slots=True)
class BackupSettings:
    workspace_id: uuid.UUID
    frequency: Frequency = "manual"
    retention_count: int = DEFAULT_RETENTION
    include_files: bool = True
    encrypt: bool = False
    key: KeyMaterial | None = None
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class BackupUpload:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    kind: UploadKind
    encrypted: bool
    filename: str
    size_bytes: int
    sha256: str
    status: UploadStatus
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    expires_at: datetime
    finished_at: datetime | None


@dataclass(frozen=True, slots=True)
class TableEntry:
    module: str
    rows: int
    size: int
    sha256: str


@dataclass(frozen=True, slots=True)
class FileEntry:
    id: uuid.UUID
    size: int
    sha256: str


@dataclass(frozen=True, slots=True)
class Manifest:
    """What an archive says it contains, validated."""

    format_version: int
    kind: str
    app_version: str
    schema_revision: str
    created_at: datetime
    workspace_id: uuid.UUID
    workspace_name: str
    owner_id: uuid.UUID
    include_files: bool
    modules: tuple[str, ...]
    tables: dict[str, TableEntry]
    files: tuple[FileEntry, ...]
    missing_files: tuple[uuid.UUID, ...]

    @property
    def record_count(self) -> int:
        return sum(entry.rows for entry in self.tables.values())

    def module_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for entry in self.tables.values():
            counts[entry.module] = counts.get(entry.module, 0) + entry.rows
        return counts


@dataclass(slots=True)
class TableResult:
    table: str
    module: str
    # Records added, already present (same ID in this workspace), matched to an existing record
    # by their natural key (the same category name), and left out because they conflict with
    # existing records or refer to records that aren't in this workspace or the file.
    added: int = 0
    duplicates: int = 0
    matched: int = 0
    skipped: int = 0


@dataclass(slots=True)
class RestoreReport:
    """What a restore or import did, or would do in a dry run."""

    dry_run: bool
    strategy: RestoreStrategy | Literal["merge"]
    workspace_id: uuid.UUID
    workspace_name: str
    # Whether records got new IDs because their IDs already exist elsewhere.
    remapped: int = 0
    tables: list[TableResult] = field(default_factory=list[TableResult])
    files_restored: int = 0
    files_reused: int = 0
    files_missing: int = 0
    warnings: list[str] = field(default_factory=list[str])
    pre_restore_backup_id: uuid.UUID | None = None

    def totals(self) -> TableResult:
        total = TableResult(table="", module="")
        for table in self.tables:
            total.added += table.added
            total.duplicates += table.duplicates
            total.matched += table.matched
            total.skipped += table.skipped
        return total


@dataclass(frozen=True, slots=True)
class ArchiveSummary:
    """An uploaded archive or export as inspected: what it is and what it holds."""

    kind: UploadKind
    format_version: int
    app_version: str
    schema_revision: str
    created_at: datetime
    source_workspace_id: uuid.UUID
    source_workspace_name: str
    include_files: bool
    module_counts: dict[str, int]
    file_count: int
    file_bytes: int
    missing_files: int


@dataclass(frozen=True, slots=True)
class TargetState:
    """The workspace an upload was made from, as it bears on restoring into it."""

    record_count: int
    has_integrations: bool


@dataclass(frozen=True, slots=True)
class Inspection:
    summary: ArchiveSummary
    # Problems that make the archive unusable here (a newer Orbit, unknown columns).
    compatible: bool
    issues: tuple[str, ...]
    warnings: tuple[str, ...]
    target: TargetState
    # A dry run of importing into this workspace (exports) or of restoring (backups).
    dry_run: RestoreReport | None


class BackupError(Exception):
    """Base class; `message` is safe to show the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class InvalidArchiveError(BackupError):
    """The archive is damaged, tampered with, or not an Orbit backup or export."""


class IncompatibleArchiveError(BackupError):
    """The archive is valid but can't be restored by this version of Orbit."""


class PasswordRequiredError(BackupError):
    def __init__(self) -> None:
        super().__init__("This backup is encrypted. Enter its password.")


class WrongPasswordError(BackupError):
    def __init__(self) -> None:
        super().__init__("That password doesn't open this backup.")


class BackupKeyMissingError(BackupError):
    def __init__(self) -> None:
        super().__init__("Set a backup password in the automatic backup settings first.")


class BackupRunningError(BackupError):
    def __init__(self) -> None:
        super().__init__("A backup of this workspace is already running. Try again shortly.")


class BackupNotFoundError(BackupError):
    def __init__(self) -> None:
        super().__init__("Backup not found.")


class UploadNotFoundError(BackupError):
    def __init__(self) -> None:
        super().__init__("Upload not found.")


class BackupFileMissingError(BackupError):
    def __init__(self) -> None:
        super().__init__("The backup file is missing from storage.")


class RestoreRejectedError(BackupError):
    """The restore can't go ahead as asked (the workspace isn't empty, the confirmation doesn't
    match, the upload was already used)."""


class RestoreFailedError(BackupError):
    """The restore ran and failed; nothing was changed."""


class BackupFailedError(BackupError):
    """Creating a backup failed; the failure is recorded in the history."""
