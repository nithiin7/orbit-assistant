"""SQLAlchemy implementations of the backup services' storage protocols.

`SqlBackupData` reads and writes every backed-up table generically, from the ORM metadata, so a
new module is covered by backups as soon as its tables are classified in
`services.backup.catalog`. Every query is filtered by the workspace (tables without a
`workspace_id`, like reminder occurrences, through their parent).
"""

import uuid
from collections.abc import AsyncIterator, Callable, Collection, Mapping, Sequence
from datetime import datetime
from functools import cache
from typing import Any, cast

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKeyConstraint,
    Integer,
    Select,
    SmallInteger,
    String,
    Table,
    Text,
    Time,
    Uuid,
    and_,
    delete,
    exists,
    func,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import __version__
from orbit_api.config import Settings
from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime
from orbit_api.db.migrate import head_revision, known_revisions
from orbit_api.db.models.backup import BackupModel, BackupSettingsModel, BackupUploadModel
from orbit_api.db.models.integrations import IntegrationConnectionModel
from orbit_api.db.models.workspaces import WorkspaceModel
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.backup.archive import ArchiveLimits
from orbit_api.services.backup.catalog import (
    ColumnKind,
    ColumnSpec,
    Reference,
    TableSpec,
    module_of,
)
from orbit_api.services.backup.models import (
    Backup,
    BackupKind,
    BackupSettings,
    BackupStatus,
    BackupUpload,
    Frequency,
    KeyMaterial,
    RestoreFailedError,
    UploadKind,
    UploadStatus,
)
from orbit_api.services.backup.service import BackupEnvironment, BackupService
from orbit_api.services.workspaces.models import Workspace
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.system.backup_store import FileArchiveStore
from orbit_api.utils.clock import utc_now

_CHUNK = 500
_STREAM_BATCH = 1000
# Workspace rows a replace keeps: the backup history (including the pre-restore backup), the
# settings, the upload being restored, and usage accounting.
_KEPT_ON_REPLACE = frozenset({"backups", "backup_settings", "backup_uploads", "ai_usage"})


def _kind(table: str, column: Any) -> ColumnKind:
    column_type = column.type
    if isinstance(column_type, UTCDateTime):
        return "datetime"
    if isinstance(column_type, Uuid):
        return "uuid"
    if isinstance(column_type, Boolean):
        return "boolean"
    if isinstance(column_type, Integer | BigInteger | SmallInteger):
        return "integer"
    if isinstance(column_type, Float):
        return "float"
    if isinstance(column_type, DateTime):
        return "datetime" if column_type.timezone else "local_datetime"
    if isinstance(column_type, Date):
        return "date"
    if isinstance(column_type, Time):
        return "time"
    if isinstance(column_type, JSON):
        return "json"
    if isinstance(column_type, String | Text):
        return "text"
    raise TypeError(f"{table}.{column.name} has a type backups don't support: {column_type!r}")


def _spec(table: Table) -> TableSpec | None:
    module = module_of(table.name)
    if module is None:
        return None
    columns = tuple(
        ColumnSpec(
            name=column.name,
            kind=_kind(table.name, column),
            nullable=bool(column.nullable),
            has_default=column.default is not None or column.server_default is not None,
        )
        for column in table.columns
    )
    primary_key = tuple(column.name for column in table.primary_key.columns)
    references: list[Reference] = []
    user_columns: list[str] = []
    foreign: set[str] = set()
    for constraint in table.constraints:
        if not isinstance(constraint, ForeignKeyConstraint):
            continue
        for element in constraint.elements:
            local = element.parent.name
            target = element.column
            foreign.add(local)
            if target.table.name == "users":
                user_columns.append(local)
            elif local != "workspace_id" and target.primary_key:
                references.append(Reference(column=local, table=target.table.name))
    identity = (
        primary_key[0]
        if len(primary_key) == 1
        and primary_key[0] not in foreign
        and isinstance(table.columns[primary_key[0]].type, Uuid)
        else None
    )
    parent = next((ref.column for ref in references if ref.table == table.name), None)
    return TableSpec(
        name=table.name,
        module=module,
        columns=columns,
        primary_key=primary_key,
        identity=identity,
        references=tuple(dict.fromkeys(references)),
        user_columns=tuple(dict.fromkeys(user_columns)),
        scoped="workspace_id" in table.columns,
        parent_column=parent,
    )


@cache
def table_specs() -> tuple[TableSpec, ...]:
    """Every backed-up table, parents before children."""
    return tuple(spec for table in Base.metadata.sorted_tables if (spec := _spec(table)))


def _table(name: str) -> Table:
    return Base.metadata.tables[name]


class SqlBackupData:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._specs = {spec.name: spec for spec in table_specs()}

    def specs(self) -> Sequence[TableSpec]:
        return table_specs()

    def _scope(
        self, spec: TableSpec, statement: Select[Any], workspace_id: uuid.UUID
    ) -> Select[Any]:
        table = _table(spec.name)
        if spec.scoped:
            return statement.where(table.c.workspace_id == workspace_id)
        # A child without its own workspace column (reminder occurrences): through its parent.
        parent_ref = next(ref for ref in spec.references if self._specs[ref.table].scoped)
        parent = _table(parent_ref.table)
        return statement.join(parent, table.c[parent_ref.column] == parent.c.id).where(
            parent.c.workspace_id == workspace_id
        )

    async def _ensure_transaction(self) -> None:
        """SQLite's Python driver begins a transaction only before a write, so a series of
        reads would each see the latest state. Begin one explicitly: in WAL mode a read
        transaction sees one snapshot without blocking writers, and savepoints nest in it."""
        connection = await self._session.connection()
        if connection.dialect.name != "sqlite":
            return
        raw = await connection.get_raw_connection()
        driver = cast(Any, raw.driver_connection)
        if not driver.in_transaction:
            await connection.exec_driver_sql("BEGIN")

    async def begin_snapshot(self) -> None:
        # End whatever the session was doing so the snapshot starts fresh.
        await self._session.rollback()
        connection = await self._session.connection()
        if connection.dialect.name == "postgresql":
            await connection.exec_driver_sql(
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
            )
            return
        await self._ensure_transaction()

    async def end_snapshot(self) -> None:
        await self._session.rollback()

    async def stream_rows(
        self, spec: TableSpec, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> AsyncIterator[list[Mapping[str, Any]]]:
        table = _table(spec.name)
        statement = self._scope(spec, select(table), workspace_id)
        for column in spec.user_columns:
            statement = statement.where(or_(table.c[column] == user_id, table.c[column].is_(None)))
        statement = statement.order_by(*(table.c[name] for name in spec.primary_key))
        result = await self._session.stream(statement.execution_options(yield_per=_STREAM_BATCH))
        async for partition in result.mappings().partitions(_STREAM_BATCH):
            yield [dict(row) for row in partition]

    async def begin_write(self) -> None:
        await self._ensure_transaction()

    async def existing_values(
        self, table: str, column: str, values: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, uuid.UUID | None]:
        spec = self._specs[table]
        model = _table(table)
        found: dict[uuid.UUID, uuid.UUID | None] = {}
        unique = list(dict.fromkeys(values))
        for start in range(0, len(unique), _CHUNK):
            chunk = unique[start : start + _CHUNK]
            if spec.scoped:
                statement = select(model.c[column], model.c.workspace_id)
            else:
                parent_ref = next(ref for ref in spec.references if self._specs[ref.table].scoped)
                parent = _table(parent_ref.table)
                statement = select(model.c[column], parent.c.workspace_id).join(
                    parent, model.c[parent_ref.column] == parent.c.id
                )
            rows = await self._session.execute(statement.where(model.c[column].in_(chunk)))
            for value, workspace_id in rows:
                found[value] = workspace_id
        return found

    async def existing_keys(self, spec: TableSpec, workspace_id: uuid.UUID) -> set[tuple[Any, ...]]:
        table = _table(spec.name)
        statement = self._scope(
            spec, select(*(table.c[name] for name in spec.primary_key)), workspace_id
        )
        return {tuple(row) for row in await self._session.execute(statement)}

    async def natural_keys(
        self, spec: TableSpec, workspace_id: uuid.UUID, columns: tuple[str, ...]
    ) -> dict[tuple[Any, ...], uuid.UUID]:
        assert spec.identity is not None
        table = _table(spec.name)
        statement = self._scope(
            spec,
            select(table.c[spec.identity], *(table.c[name] for name in columns)),
            workspace_id,
        )
        found: dict[tuple[Any, ...], uuid.UUID] = {}
        for row in await self._session.execute(statement):
            key = tuple(row[1:])
            if any(part is None or part is False for part in key):
                continue
            found.setdefault(key, row[0])
        return found

    async def insert(self, spec: TableSpec, rows: list[dict[str, Any]], *, lenient: bool) -> int:
        if not rows:
            return 0
        table = _table(spec.name)
        # One statement per shape: rows from an older backup may lack defaulted columns.
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows:
            groups.setdefault(tuple(sorted(row)), []).append(row)
        inserted = 0
        for group in groups.values():
            try:
                async with self._session.begin_nested():
                    await self._session.execute(insert(table), group)
                inserted += len(group)
                continue
            except (IntegrityError, DataError):
                if not lenient:
                    raise RestoreFailedError(
                        f"Records in {spec.name} couldn't be restored: they conflict with "
                        "existing data or break a rule. Nothing was changed."
                    ) from None
            for row in group:
                try:
                    async with self._session.begin_nested():
                        await self._session.execute(insert(table), [row])
                    inserted += 1
                except (IntegrityError, DataError):
                    continue
        return inserted

    async def counts(self, workspace_id: uuid.UUID) -> dict[str, int]:
        counts: dict[str, int] = {}
        for spec in table_specs():
            statement = self._scope(
                spec, select(func.count()).select_from(_table(spec.name)), workspace_id
            )
            counts[spec.name] = int((await self._session.execute(statement)).scalar_one())
        return counts

    async def has_integrations(self, workspace_id: uuid.UUID) -> bool:
        return bool(
            await self._session.scalar(
                select(exists().where(IntegrationConnectionModel.workspace_id == workspace_id))
            )
        )

    async def create_workspace(self, workspace: Workspace) -> None:
        await self._session.execute(
            insert(WorkspaceModel).values(
                id=workspace.id,
                owner_id=workspace.owner_id,
                name=workspace.name,
                is_personal=workspace.is_personal,
                created_at=workspace.created_at,
                updated_at=workspace.updated_at,
            )
        )

    async def clear_workspace(self, workspace_id: uuid.UUID) -> None:
        # Children before parents, each filtered by the workspace.
        for table in reversed(Base.metadata.sorted_tables):
            if table.name in _KEPT_ON_REPLACE or table.name == "workspaces":
                continue
            if "workspace_id" in table.columns:
                await self._session.execute(
                    delete(table).where(table.c.workspace_id == workspace_id)
                )
                continue
            spec = self._specs.get(table.name)
            if spec is not None and not spec.scoped:
                parent_ref = next(ref for ref in spec.references if self._specs[ref.table].scoped)
                parent = _table(parent_ref.table)
                await self._session.execute(
                    delete(table).where(
                        table.c[parent_ref.column].in_(
                            select(parent.c.id).where(parent.c.workspace_id == workspace_id)
                        )
                    )
                )


def _backup(model: BackupModel) -> Backup:
    return Backup(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        kind=cast(BackupKind, model.kind),
        status=cast(BackupStatus, model.status),
        include_files=model.include_files,
        encrypted=model.encrypted,
        size_bytes=model.size_bytes,
        sha256=model.sha256,
        record_count=model.record_count,
        file_count=model.file_count,
        modules=tuple(model.modules),
        record_counts=dict(model.record_counts),
        warnings=tuple(model.warnings),
        error=model.error,
        format_version=model.format_version,
        schema_revision=model.schema_revision,
        app_version=model.app_version,
        started_at=model.started_at,
        finished_at=model.finished_at,
        created_at=model.created_at,
    )


def _settings(model: BackupSettingsModel) -> BackupSettings:
    material = model.key_material
    key = None
    if material:
        key = KeyMaterial(
            public_key=str(material["public_key"]),
            sealed_private_key=dict(material["sealed_private_key"]),
            created_at=datetime.fromisoformat(str(material["created_at"])),
        )
    return BackupSettings(
        workspace_id=model.workspace_id,
        frequency=cast(Frequency, model.frequency),
        retention_count=model.retention_count,
        include_files=model.include_files,
        encrypt=model.encrypt,
        key=key,
        next_run_at=model.next_run_at,
        last_run_at=model.last_run_at,
        updated_at=model.updated_at,
    )


def _upload(model: BackupUploadModel) -> BackupUpload:
    return BackupUpload(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        kind=cast(UploadKind, model.kind),
        encrypted=model.encrypted,
        filename=model.filename,
        size_bytes=model.size_bytes,
        sha256=model.sha256,
        status=cast(UploadStatus, model.status),
        result=model.result,
        error=model.error,
        created_at=model.created_at,
        expires_at=model.expires_at,
        finished_at=model.finished_at,
    )


def _workspace(model: WorkspaceModel) -> Workspace:
    return Workspace(
        id=model.id,
        owner_id=model.owner_id,
        name=model.name,
        is_personal=model.is_personal,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _rowcount(result: object) -> int:
    return cast(CursorResult[Any], result).rowcount


class SqlBackupRecords:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add_backup(self, backup: Backup) -> None:
        self._session.add(
            BackupModel(
                id=backup.id,
                workspace_id=backup.workspace_id,
                user_id=backup.user_id,
                kind=backup.kind,
                status=backup.status,
                include_files=backup.include_files,
                encrypted=backup.encrypted,
                size_bytes=backup.size_bytes,
                sha256=backup.sha256,
                record_count=backup.record_count,
                file_count=backup.file_count,
                modules=list(backup.modules),
                record_counts=dict(backup.record_counts),
                warnings=list(backup.warnings),
                error=backup.error,
                format_version=backup.format_version,
                schema_revision=backup.schema_revision,
                app_version=backup.app_version,
                started_at=backup.started_at,
                finished_at=backup.finished_at,
                created_at=backup.created_at,
            )
        )
        await flush(self._session)

    async def finish_backup(
        self,
        backup_id: uuid.UUID,
        *,
        status: BackupStatus,
        finished_at: datetime,
        fields: Mapping[str, Any],
    ) -> None:
        await self._session.execute(
            update(BackupModel)
            .where(BackupModel.id == backup_id)
            .values(status=status, finished_at=finished_at, **fields)
        )

    async def get_backup(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> Backup | None:
        model = await self._session.scalar(
            select(BackupModel)
            .where(BackupModel.id == backup_id, BackupModel.workspace_id == workspace_id)
            .execution_options(populate_existing=True)
        )
        return _backup(model) if model is not None else None

    async def list_backups(self, workspace_id: uuid.UUID, limit: int) -> list[Backup]:
        models = await self._session.scalars(
            select(BackupModel)
            .where(BackupModel.workspace_id == workspace_id)
            .order_by(BackupModel.created_at.desc(), BackupModel.id)
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        return [_backup(model) for model in models]

    async def delete_backup(self, backup_id: uuid.UUID) -> None:
        await self._session.execute(delete(BackupModel).where(BackupModel.id == backup_id))

    async def fail_stale_backups(self, started_before: datetime, now: datetime) -> int:
        result = await self._session.execute(
            update(BackupModel)
            .where(BackupModel.status == "running", BackupModel.started_at < started_before)
            .values(status="failed", finished_at=now, error="The backup was interrupted.")
        )
        return _rowcount(result)

    async def scheduled_beyond(self, workspace_id: uuid.UUID, keep: int) -> list[Backup]:
        models = await self._session.scalars(
            select(BackupModel)
            .where(
                BackupModel.workspace_id == workspace_id,
                BackupModel.kind == "scheduled",
                BackupModel.status == "succeeded",
            )
            .order_by(BackupModel.created_at.desc(), BackupModel.id)
            .offset(keep)
        )
        return [_backup(model) for model in models]

    async def get_settings(self, workspace_id: uuid.UUID) -> BackupSettings | None:
        model = await self._session.get(BackupSettingsModel, workspace_id, populate_existing=True)
        return _settings(model) if model is not None else None

    async def save_settings(self, settings: BackupSettings) -> None:
        key = settings.key
        material = (
            {
                "public_key": key.public_key,
                "sealed_private_key": key.sealed_private_key,
                "created_at": key.created_at.isoformat(),
            }
            if key is not None
            else None
        )
        model = await self._session.get(BackupSettingsModel, settings.workspace_id)
        if model is None:
            model = BackupSettingsModel(workspace_id=settings.workspace_id)
            self._session.add(model)
        model.frequency = settings.frequency
        model.retention_count = settings.retention_count
        model.include_files = settings.include_files
        model.encrypt = settings.encrypt
        model.key_material = material
        model.next_run_at = settings.next_run_at
        model.last_run_at = settings.last_run_at
        model.updated_at = settings.updated_at or utc_now()
        await flush(self._session)

    async def due_settings(self, now: datetime) -> list[tuple[BackupSettings, Workspace]]:
        rows = await self._session.execute(
            select(BackupSettingsModel, WorkspaceModel)
            .join(WorkspaceModel, WorkspaceModel.id == BackupSettingsModel.workspace_id)
            .where(
                BackupSettingsModel.frequency != "manual",
                BackupSettingsModel.next_run_at.is_not(None),
                BackupSettingsModel.next_run_at <= now,
            )
            .execution_options(populate_existing=True)
        )
        return [(_settings(settings), _workspace(workspace)) for settings, workspace in rows]

    async def claim_run(
        self,
        workspace_id: uuid.UUID,
        expected: datetime | None,
        next_run_at: datetime | None,
        now: datetime,
    ) -> bool:
        current = (
            BackupSettingsModel.next_run_at.is_(None)
            if expected is None
            else BackupSettingsModel.next_run_at == expected
        )
        result = await self._session.execute(
            update(BackupSettingsModel)
            .where(BackupSettingsModel.workspace_id == workspace_id, current)
            .values(next_run_at=next_run_at, last_run_at=now)
        )
        return _rowcount(result) == 1

    async def set_next_run(self, workspace_id: uuid.UUID, next_run_at: datetime | None) -> None:
        await self._session.execute(
            update(BackupSettingsModel)
            .where(BackupSettingsModel.workspace_id == workspace_id)
            .values(next_run_at=next_run_at)
        )

    async def add_upload(self, upload: BackupUpload) -> None:
        self._session.add(
            BackupUploadModel(
                id=upload.id,
                workspace_id=upload.workspace_id,
                user_id=upload.user_id,
                kind=upload.kind,
                encrypted=upload.encrypted,
                filename=upload.filename,
                size_bytes=upload.size_bytes,
                sha256=upload.sha256,
                status=upload.status,
                result=upload.result,
                error=upload.error,
                created_at=upload.created_at,
                expires_at=upload.expires_at,
                finished_at=upload.finished_at,
            )
        )
        await flush(self._session)

    async def get_upload(
        self, workspace_id: uuid.UUID, upload_id: uuid.UUID
    ) -> BackupUpload | None:
        model = await self._session.scalar(
            select(BackupUploadModel)
            .where(
                BackupUploadModel.id == upload_id, BackupUploadModel.workspace_id == workspace_id
            )
            .execution_options(populate_existing=True)
        )
        return _upload(model) if model is not None else None

    async def list_uploads(self, workspace_id: uuid.UUID, limit: int) -> list[BackupUpload]:
        models = await self._session.scalars(
            select(BackupUploadModel)
            .where(BackupUploadModel.workspace_id == workspace_id)
            .order_by(BackupUploadModel.created_at.desc(), BackupUploadModel.id)
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        return [_upload(model) for model in models]

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
        values: dict[str, Any] = {"status": status}
        if result is not None:
            values["result"] = result
        if error is not None:
            values["error"] = error[:300]
        if finished_at is not None:
            values["finished_at"] = finished_at
        if expires_at is not None:
            values["expires_at"] = expires_at
        conditions = [BackupUploadModel.id == upload_id]
        if expected is not None:
            conditions.append(BackupUploadModel.status.in_(list(expected)))
        outcome = await self._session.execute(
            update(BackupUploadModel).where(and_(*conditions)).values(**values)
        )
        return _rowcount(outcome) == 1

    async def completed_upload_with(
        self, workspace_id: uuid.UUID, sha256: str, exclude: uuid.UUID
    ) -> BackupUpload | None:
        model = await self._session.scalar(
            select(BackupUploadModel)
            .where(
                BackupUploadModel.workspace_id == workspace_id,
                BackupUploadModel.sha256 == sha256,
                BackupUploadModel.status == "completed",
                BackupUploadModel.id != exclude,
            )
            .order_by(BackupUploadModel.created_at.desc())
            .limit(1)
        )
        return _upload(model) if model is not None else None

    async def expired_uploads(self, now: datetime) -> list[BackupUpload]:
        models = await self._session.scalars(
            select(BackupUploadModel).where(
                BackupUploadModel.status.in_(("uploaded", "failed")),
                BackupUploadModel.expires_at <= now,
            )
        )
        return [_upload(model) for model in models]

    async def stale_restores(self, now: datetime) -> list[BackupUpload]:
        models = await self._session.scalars(
            select(BackupUploadModel).where(
                BackupUploadModel.status == "restoring", BackupUploadModel.expires_at <= now
            )
        )
        return [_upload(model) for model in models]


def build_backup_service(
    session: AsyncSession, settings: Settings, clock: Callable[[], datetime] = utc_now
) -> BackupService:
    return BackupService(
        SqlBackupData(session),
        SqlBackupRecords(session),
        FileArchiveStore(settings.backups_dir),
        FileAttachmentStore(settings.attachments_dir),
        SqlTransaction(session),
        _environment(settings),
        clock,
    )


@cache
def _cached_environment(storage_mode: str, max_extracted: int) -> BackupEnvironment:
    return BackupEnvironment(
        app_version=__version__,
        schema_revision=head_revision() or "",
        known_revisions=known_revisions(),
        storage_mode=storage_mode,
        limits=ArchiveLimits(max_extracted_bytes=max_extracted),
    )


def _environment(settings: Settings) -> BackupEnvironment:
    # Reading the migration scripts is slow; the answer never changes while running.
    return _cached_environment(settings.storage_mode, settings.backup_max_extracted_bytes)
