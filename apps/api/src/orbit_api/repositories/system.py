"""The server-wide settings row and the health checks behind the status page."""

from datetime import datetime

from alembic.runtime.migration import MigrationContext
from sqlalchemy import Connection, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import ReminderOccurrenceModel, SystemSettingsModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.system.models import Release, UpdateCheckState

_ROW_ID = 1


class SqlSystemSettings:
    """No row means update checks are off and never ran."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def update_check(self) -> UpdateCheckState:
        model = await self._session.get(SystemSettingsModel, _ROW_ID)
        if model is None:
            return UpdateCheckState(
                enabled=False,
                latest_version=None,
                latest_published_at=None,
                checked_at=None,
                check_failed=False,
            )
        return UpdateCheckState(
            enabled=model.update_check_enabled,
            latest_version=model.latest_version,
            latest_published_at=model.latest_published_at,
            checked_at=model.checked_at,
            check_failed=model.check_failed,
        )

    async def set_update_check_enabled(self, enabled: bool) -> None:
        model = await self._row()
        model.update_check_enabled = enabled
        await flush(self._session)

    async def record_check(self, release: Release | None, checked_at: datetime) -> None:
        model = await self._row()
        model.checked_at = checked_at
        model.check_failed = release is None
        if release is not None:
            model.latest_version = release.version
            model.latest_published_at = release.published_at
        await flush(self._session)

    async def _row(self) -> SystemSettingsModel:
        model = await self._session.get(SystemSettingsModel, _ROW_ID)
        if model is None:
            model = SystemSettingsModel(id=_ROW_ID, update_check_enabled=False, check_failed=False)
            self._session.add(model)
        return model


class SqlSystemHealth:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def schema_revision(self) -> str | None:
        connection = await self._session.connection()
        return await connection.run_sync(_current_revision)

    async def reminders_waiting_since(self, before: datetime) -> bool:
        row = await self._session.scalar(
            select(ReminderOccurrenceModel.id)
            .where(
                ReminderOccurrenceModel.status == "pending",
                ReminderOccurrenceModel.available_at < before,
            )
            .limit(1)
        )
        return row is not None


def _current_revision(connection: Connection) -> str | None:
    return MigrationContext.configure(connection).get_current_revision()
