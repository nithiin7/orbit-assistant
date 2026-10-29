"""In-app notification types."""

import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class Notification:
    id: uuid.UUID
    # The recipient. Notifications are private to them, whichever workspace they came from.
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    # The source; `None` once the reminder (or its occurrence) has been deleted.
    reminder_id: uuid.UUID | None
    occurrence_id: uuid.UUID | None
    # Copied from the reminder when delivered, so later edits don't rewrite history.
    title: str
    body: str
    # When the reminder was scheduled to fire; `created_at` is when it was delivered.
    scheduled_for: datetime
    created_at: datetime
    read_at: datetime | None


@dataclass(frozen=True, slots=True)
class NotificationQuery:
    unread_only: bool = False
    limit: int = 20
    offset: int = 0


@dataclass(frozen=True, slots=True)
class NotificationPage:
    notifications: list[Notification]
    # Notifications matching the query, ignoring `limit` and `offset`.
    total: int
    # All of the user's unread notifications.
    unread: int


class NotificationNotFoundError(Exception):
    """The notification does not exist or belongs to someone else."""
