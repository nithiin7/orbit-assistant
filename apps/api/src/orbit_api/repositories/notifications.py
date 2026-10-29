"""Notifications. Every query is filtered by recipient, so users never reach each other's rows."""

import uuid
from datetime import datetime

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import NotificationModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.notifications.models import (
    Notification,
    NotificationPage,
    NotificationQuery,
)


def _to_notification(model: NotificationModel) -> Notification:
    return Notification(
        id=model.id,
        user_id=model.user_id,
        workspace_id=model.workspace_id,
        reminder_id=model.reminder_id,
        occurrence_id=model.occurrence_id,
        title=model.title,
        body=model.body,
        scheduled_for=model.scheduled_for,
        created_at=model.created_at,
        read_at=model.read_at,
    )


def _unread(user_id: uuid.UUID) -> list[ColumnElement[bool]]:
    return [NotificationModel.user_id == user_id, NotificationModel.read_at.is_(None)]


class SqlNotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, notification: Notification) -> None:
        self._session.add(
            NotificationModel(
                id=notification.id,
                user_id=notification.user_id,
                workspace_id=notification.workspace_id,
                reminder_id=notification.reminder_id,
                occurrence_id=notification.occurrence_id,
                title=notification.title,
                body=notification.body,
                scheduled_for=notification.scheduled_for,
                created_at=notification.created_at,
                read_at=notification.read_at,
            )
        )
        await flush(self._session)

    async def find(self, user_id: uuid.UUID, query: NotificationQuery) -> NotificationPage:
        conditions = (
            _unread(user_id) if query.unread_only else [NotificationModel.user_id == user_id]
        )
        total = await self._session.scalar(select(func.count()).where(*conditions))
        models = await self._session.scalars(
            select(NotificationModel)
            .where(*conditions)
            .order_by(NotificationModel.created_at.desc(), NotificationModel.id.asc())
            .limit(query.limit)
            .offset(query.offset)
        )
        return NotificationPage(
            notifications=[_to_notification(model) for model in models],
            total=total or 0,
            unread=await self.unread_count(user_id),
        )

    async def unread_count(self, user_id: uuid.UUID) -> int:
        count = await self._session.scalar(select(func.count()).where(*_unread(user_id)))
        return count or 0

    async def set_read_at(
        self, user_id: uuid.UUID, notification_id: uuid.UUID, read_at: datetime | None
    ) -> Notification | None:
        model = await self._session.scalar(
            select(NotificationModel).where(
                NotificationModel.id == notification_id, NotificationModel.user_id == user_id
            )
        )
        if model is None:
            return None
        # Keep the first read time when marking a read notification read again.
        if read_at is None or model.read_at is None:
            model.read_at = read_at
            await flush(self._session)
        return _to_notification(model)

    async def mark_all_read(self, user_id: uuid.UUID, read_at: datetime) -> int:
        rows = await self._session.execute(
            update(NotificationModel)
            .where(*_unread(user_id))
            .values(read_at=read_at)
            .returning(NotificationModel.id)
            .execution_options(synchronize_session=False)
        )
        return len(rows.all())
