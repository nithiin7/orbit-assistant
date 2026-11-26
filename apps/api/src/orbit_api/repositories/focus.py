"""Focus sessions. Every query is filtered by workspace."""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import FocusSessionModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.focus.models import FocusSession, FocusSummary, TaskFocus


class SqlFocusRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, session: FocusSession) -> None:
        self._session.add(
            FocusSessionModel(
                id=session.id,
                workspace_id=session.workspace_id,
                task_id=session.task_id,
                started_at=session.started_at,
                ended_at=session.ended_at,
                focused_seconds=session.focused_seconds,
                day=session.day,
                completed=session.completed,
                created_at=session.created_at,
            )
        )
        await flush(self._session)

    async def summary(self, workspace_id: uuid.UUID, today: date) -> FocusSummary:
        seconds = func.sum(FocusSessionModel.focused_seconds)
        rows = await self._session.execute(
            select(FocusSessionModel.task_id, seconds, func.count())
            .where(FocusSessionModel.workspace_id == workspace_id)
            .group_by(FocusSessionModel.task_id)
            .order_by(seconds.desc(), FocusSessionModel.task_id)
        )
        today_row = (
            await self._session.execute(
                select(func.coalesce(seconds, 0), func.count()).where(
                    FocusSessionModel.workspace_id == workspace_id, FocusSessionModel.day == today
                )
            )
        ).one()
        return FocusSummary(
            today_seconds=int(today_row[0]),
            today_sessions=int(today_row[1]),
            tasks=tuple(
                TaskFocus(task_id=task_id, focused_seconds=int(total), sessions=int(count))
                for task_id, total, count in rows
            ),
        )
