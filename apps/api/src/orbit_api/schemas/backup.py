"""Request and response models for backups, restores, imports, and exports."""

import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, model_validator

from orbit_api.schemas.common import Name
from orbit_api.services.backup.catalog import MODULE_LABELS, MODULES, Module
from orbit_api.services.backup.formats import EXPORT_FORMATS
from orbit_api.services.backup.models import (
    MIN_PASSWORD_LENGTH,
    ArchiveSummary,
    Backup,
    BackupKind,
    BackupSettings,
    BackupStatus,
    BackupUpload,
    Encryption,
    ExportFormat,
    Frequency,
    Inspection,
    RestoreReport,
    RestoreStrategy,
    TableResult,
    UploadKind,
    UploadStatus,
)
from orbit_api.services.backup.service import Overview, Verification

# Never echoed back, stored, or logged; only used to derive a key.
Password = Annotated[
    SecretStr,
    Field(
        min_length=MIN_PASSWORD_LENGTH, max_length=1024, json_schema_extra={"format": "password"}
    ),
]
# Opening an existing backup takes whatever its password was.
AnyPassword = Annotated[SecretStr, Field(min_length=1, max_length=1024)]


def _reveal(password: SecretStr | None) -> str | None:
    return password.get_secret_value() if password is not None else None


class BackupResponse(BaseModel):
    id: uuid.UUID
    kind: BackupKind
    status: BackupStatus
    include_files: bool
    encrypted: bool
    size_bytes: int | None
    sha256: str | None
    record_count: int
    file_count: int
    modules: list[str]
    record_counts: dict[str, int]
    warnings: list[str]
    error: str | None
    format_version: int
    schema_revision: str
    app_version: str
    started_at: datetime
    finished_at: datetime | None
    created_at: datetime

    @classmethod
    def of(cls, backup: Backup) -> "BackupResponse":
        return cls(
            id=backup.id,
            kind=backup.kind,
            status=backup.status,
            include_files=backup.include_files,
            encrypted=backup.encrypted,
            size_bytes=backup.size_bytes,
            sha256=backup.sha256,
            record_count=backup.record_count,
            file_count=backup.file_count,
            modules=list(backup.modules),
            record_counts=backup.record_counts,
            warnings=list(backup.warnings),
            error=backup.error,
            format_version=backup.format_version,
            schema_revision=backup.schema_revision,
            app_version=backup.app_version,
            started_at=backup.started_at,
            finished_at=backup.finished_at,
            created_at=backup.created_at,
        )


class BackupSettingsResponse(BaseModel):
    frequency: Frequency
    retention_count: int
    include_files: bool
    encrypt: bool
    # Whether a backup password is set (the password itself is never stored or returned).
    has_backup_password: bool
    backup_password_set_at: datetime | None
    next_run_at: datetime | None
    last_run_at: datetime | None

    @classmethod
    def of(cls, settings: BackupSettings) -> "BackupSettingsResponse":
        return cls(
            frequency=settings.frequency,
            retention_count=settings.retention_count,
            include_files=settings.include_files,
            encrypt=settings.encrypt,
            has_backup_password=settings.key is not None,
            backup_password_set_at=settings.key.created_at if settings.key else None,
            next_run_at=settings.next_run_at,
            last_run_at=settings.last_run_at,
        )


class TableResultResponse(BaseModel):
    table: str
    module: str
    added: int
    duplicates: int
    matched: int
    skipped: int

    @classmethod
    def of(cls, result: TableResult) -> "TableResultResponse":
        return cls(
            table=result.table,
            module=result.module,
            added=result.added,
            duplicates=result.duplicates,
            matched=result.matched,
            skipped=result.skipped,
        )


class RestoreTotalsResponse(BaseModel):
    added: int
    duplicates: int
    matched: int
    skipped: int


class RestoreReportResponse(BaseModel):
    dry_run: bool
    strategy: RestoreStrategy | Literal["merge"]
    workspace_id: uuid.UUID
    workspace_name: str
    remapped: int
    totals: RestoreTotalsResponse
    tables: list[TableResultResponse]
    files_restored: int
    files_reused: int
    files_missing: int
    warnings: list[str]
    pre_restore_backup_id: uuid.UUID | None

    @classmethod
    def of(cls, report: RestoreReport) -> "RestoreReportResponse":
        totals = report.totals()
        return cls(
            dry_run=report.dry_run,
            strategy=report.strategy,
            workspace_id=report.workspace_id,
            workspace_name=report.workspace_name,
            remapped=max(report.remapped, 0),
            totals=RestoreTotalsResponse(
                added=totals.added,
                duplicates=totals.duplicates,
                matched=totals.matched,
                skipped=totals.skipped,
            ),
            tables=[TableResultResponse.of(table) for table in report.tables],
            files_restored=report.files_restored,
            files_reused=report.files_reused,
            files_missing=report.files_missing,
            warnings=report.warnings,
            pre_restore_backup_id=report.pre_restore_backup_id,
        )


class BackupUploadResponse(BaseModel):
    id: uuid.UUID
    kind: UploadKind
    encrypted: bool
    filename: str
    size_bytes: int
    status: UploadStatus
    error: str | None
    created_at: datetime
    expires_at: datetime
    finished_at: datetime | None
    result: RestoreReportResponse | None

    @classmethod
    def of(cls, upload: BackupUpload) -> "BackupUploadResponse":
        result = None
        if upload.result is not None:
            data = dict(upload.result)
            report = RestoreReport(
                dry_run=bool(data.get("dry_run")),
                strategy=data.get("strategy", "merge"),
                workspace_id=uuid.UUID(str(data["workspace_id"])),
                workspace_name=str(data.get("workspace_name", "")),
                remapped=int(data.get("remapped", 0)),
                tables=[TableResult(**table) for table in data.get("tables", [])],
                files_restored=int(data.get("files_restored", 0)),
                files_reused=int(data.get("files_reused", 0)),
                files_missing=int(data.get("files_missing", 0)),
                warnings=list(data.get("warnings", [])),
                pre_restore_backup_id=uuid.UUID(str(data["pre_restore_backup_id"]))
                if data.get("pre_restore_backup_id")
                else None,
            )
            result = RestoreReportResponse.of(report)
        return cls(
            id=upload.id,
            kind=upload.kind,
            encrypted=upload.encrypted,
            filename=upload.filename,
            size_bytes=upload.size_bytes,
            status=upload.status,
            error=upload.error,
            created_at=upload.created_at,
            expires_at=upload.expires_at,
            finished_at=upload.finished_at,
            result=result,
        )


class ExportModuleInfo(BaseModel):
    module: Module
    label: str
    formats: list[ExportFormat]


class BackupOverviewResponse(BaseModel):
    settings: BackupSettingsResponse
    backups: list[BackupResponse]
    uploads: list[BackupUploadResponse]
    total_bytes: int
    last_success_at: datetime | None
    running: bool
    modules: list[ExportModuleInfo]
    folder: str | None = Field(
        description="The folder on the API's machine holding this workspace's backups. Only in "
        "local mode, outside production."
    )
    can_reveal_folder: bool = Field(
        description="Whether the API can open that folder in the file manager."
    )

    @classmethod
    def of(cls, overview: Overview, *, folder: str | None) -> "BackupOverviewResponse":
        last = overview.last_success
        return cls(
            settings=BackupSettingsResponse.of(overview.settings),
            backups=[BackupResponse.of(backup) for backup in overview.backups],
            uploads=[BackupUploadResponse.of(upload) for upload in overview.uploads],
            total_bytes=overview.total_bytes,
            last_success_at=last.finished_at if last else None,
            running=overview.running is not None,
            modules=[
                ExportModuleInfo(
                    module=module, label=MODULE_LABELS[module], formats=list(EXPORT_FORMATS[module])
                )
                for module in MODULES
            ],
            folder=folder,
            can_reveal_folder=folder is not None,
        )


class ArchiveSummaryResponse(BaseModel):
    kind: UploadKind
    format_version: int
    app_version: str
    schema_revision: str
    created_at: datetime
    source_workspace_name: str
    include_files: bool
    module_counts: dict[str, int]
    file_count: int
    file_bytes: int
    missing_files: int

    @classmethod
    def of(cls, summary: ArchiveSummary) -> "ArchiveSummaryResponse":
        return cls(
            kind=summary.kind,
            format_version=summary.format_version,
            app_version=summary.app_version,
            schema_revision=summary.schema_revision,
            created_at=summary.created_at,
            source_workspace_name=summary.source_workspace_name,
            include_files=summary.include_files,
            module_counts=summary.module_counts,
            file_count=summary.file_count,
            file_bytes=summary.file_bytes,
            missing_files=summary.missing_files,
        )


class RestoreTargetResponse(BaseModel):
    record_count: int
    has_integrations: bool


class InspectionResponse(BaseModel):
    summary: ArchiveSummaryResponse
    compatible: bool
    issues: list[str]
    warnings: list[str]
    target: RestoreTargetResponse
    dry_run: RestoreReportResponse | None

    @classmethod
    def of(cls, inspection: Inspection) -> "InspectionResponse":
        return cls(
            summary=ArchiveSummaryResponse.of(inspection.summary),
            compatible=inspection.compatible,
            issues=list(inspection.issues),
            warnings=list(inspection.warnings),
            target=RestoreTargetResponse(
                record_count=inspection.target.record_count,
                has_integrations=inspection.target.has_integrations,
            ),
            dry_run=RestoreReportResponse.of(inspection.dry_run) if inspection.dry_run else None,
        )


class VerificationResponse(BaseModel):
    ok: bool
    level: Literal["checksum", "full"]
    message: str

    @classmethod
    def of(cls, verification: Verification) -> "VerificationResponse":
        level: Literal["checksum", "full"] = "full" if verification.level == "full" else "checksum"
        return cls(ok=verification.ok, level=level, message=verification.message)


class CreateBackupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_files: bool = True
    # `password`: a password for this backup only; `backup_key`: the backup password set in
    # the automatic backup settings.
    encryption: Encryption = "none"
    password: Password | None = None

    @model_validator(mode="after")
    def _password_matches(self) -> Self:
        if (self.encryption == "password") != (self.password is not None):
            raise ValueError("A password is needed exactly when encrypting with a password.")
        return self

    def secret(self) -> str | None:
        return _reveal(self.password)


class UpdateBackupSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency: Frequency
    retention_count: int = Field(ge=1, le=50)
    include_files: bool
    encrypt: bool
    # A new backup password, to set or change it. Earlier backups keep their password.
    password: Password | None = None

    def secret(self) -> str | None:
        return _reveal(self.password)


class ExportArchiveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_files: bool = True
    password: Password | None = None

    def secret(self) -> str | None:
        return _reveal(self.password)


class ExportModuleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # A module, or `null` for every module (JSON only).
    module: Module | None
    format: ExportFormat


class ArchivePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: AnyPassword | None = None

    def secret(self) -> str | None:
        return _reveal(self.password)


class RestoreUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Backups: where to restore. Exports are always added to this workspace (`null`).
    strategy: RestoreStrategy | None = None
    password: AnyPassword | None = None
    # The new workspace's name (`new_workspace`); defaults to the backup's name + "(restored)".
    workspace_name: Name | None = None
    # `replace`: this workspace's name, typed by the person to confirm.
    confirm_name: Annotated[str, StringConstraints(max_length=100)] | None = None
    # Use a file that was already restored or imported here once before.
    allow_repeat: bool = False
    dry_run: bool = False

    def secret(self) -> str | None:
        return _reveal(self.password)


class UploadParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: Annotated[str, StringConstraints(min_length=1, max_length=255)] = "upload"
