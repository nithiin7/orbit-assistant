"""Notifications: the signed-in user's in-app inbox, filled by the reminder worker.

Every method takes the recipient's user ID, which the caller has authenticated (`CurrentUserDep`),
and repositories filter every query by it. A notification ID alone never reaches a row: one
belonging to someone else is indistinguishable from one that doesn't exist.
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from orbit_api.services.notifications.models import (
    Notification,
    NotificationNotFoundError,
    NotificationPage,
    NotificationQuery,
)
from orbit_api.services.transactions import Transaction


class NotificationRepository(Protocol):
    async def add(self, notification: Notification) -> None: ...

    async def find(self, user_id: uuid.UUID, query: NotificationQuery) -> NotificationPage: ...

    async def unread_count(self, user_id: uuid.UUID) -> int: ...

    async def set_read_at(
        self, user_id: uuid.UUID, notification_id: uuid.UUID, read_at: datetime | None
    ) -> Notification | None:
        """Set the read time of the user's notification, keeping an earlier one; `None` if the
        notification isn't theirs."""
        ...

    async def mark_all_read(self, user_id: uuid.UUID, read_at: datetime) -> int:
        """Mark every unread notification of the user read; return how many changed."""
        ...


def _utc_now() -> datetime:
    return datetime.now(UTC)


class NotificationService:
    def __init__(
        self,
        notifications: NotificationRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._notifications = notifications
        self._transaction = transaction
        self._clock = clock

    async def find(self, user_id: uuid.UUID, query: NotificationQuery) -> NotificationPage:
        return await self._notifications.find(user_id, query)

    async def unread_count(self, user_id: uuid.UUID) -> int:
        return await self._notifications.unread_count(user_id)

    async def set_read(
        self, user_id: uuid.UUID, notification_id: uuid.UUID, *, read: bool
    ) -> Notification:
        """Idempotent: marking a read notification read keeps when it was first read."""
        notification = await self._notifications.set_read_at(
            user_id, notification_id, self._clock() if read else None
        )
        if notification is None:
            raise NotificationNotFoundError
        await self._transaction.commit()
        return notification

    async def mark_all_read(self, user_id: uuid.UUID) -> int:
        count = await self._notifications.mark_all_read(user_id, self._clock())
        await self._transaction.commit()
        return count
