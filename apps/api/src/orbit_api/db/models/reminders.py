"""Reminders, their scheduled occurrences, and the notifications they deliver."""

import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class ReminderModel(Base):
    """A reminder in one workspace, optionally about one of its tasks.

    The schedule is stored in local terms (`start_date`, `time_of_day`, an IANA `timezone`, and a
    versioned `recurrence` document) so recurring reminders keep their wall-clock time across
    daylight-saving changes. Deleting the workspace or the task deletes the reminder.
    """

    __tablename__ = "reminders"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
        CheckConstraint("length(timezone) BETWEEN 1 AND 64", name="timezone_length"),
        CheckConstraint(
            "last_outcome IN ('delivered', 'cancelled', 'failed')", name="last_outcome"
        ),
        # Keeps a reminder's task in the reminder's own workspace. Rows without a task are not
        # checked (a NULL in a composite foreign key skips it).
        ForeignKeyConstraint(
            ["task_id", "workspace_id"], ["tasks.id", "tasks.workspace_id"], ondelete="CASCADE"
        ),
        Index("ix_reminders_workspace_created_at", "workspace_id", "created_at"),
        Index("ix_reminders_task_id", "task_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None]
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool]
    start_date: Mapped[date] = mapped_column(Date)
    time_of_day: Mapped[time] = mapped_column(Time)
    timezone: Mapped[str] = mapped_column(String(64))
    recurrence: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    last_occurrence_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_outcome: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    # Set by the service when the user edits the reminder; the worker's bookkeeping doesn't
    # count as an edit.
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class ReminderOccurrenceModel(Base):
    """One scheduled firing of a reminder: the durable work queue the worker drains.

    A worker claims an occurrence by setting `status = 'processing'` with a `claim_token` and a
    lease (`claimed_until`) in one conditional update; an expired lease can be claimed again.
    The unique `(reminder_id, scheduled_for)` pair means a reminder never fires twice for the
    same instant.
    """

    __tablename__ = "reminder_occurrences"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'processing', 'delivered', 'cancelled', 'failed')",
            name="status",
        ),
        CheckConstraint("attempts >= 0", name="attempts"),
        CheckConstraint(
            "(status = 'processing' AND claim_token IS NOT NULL AND claimed_until IS NOT NULL)"
            " OR (status <> 'processing' AND claim_token IS NULL AND claimed_until IS NULL)",
            name="claim_matches_status",
        ),
        CheckConstraint(
            "(status IN ('delivered', 'cancelled', 'failed') AND finished_at IS NOT NULL)"
            " OR (status IN ('pending', 'processing') AND finished_at IS NULL)",
            name="finished_at_matches_status",
        ),
        CheckConstraint("length(last_error) <= 100", name="last_error_length"),
        UniqueConstraint(
            "reminder_id", "scheduled_for", name="uq_reminder_occurrences_reminder_time"
        ),
        # The worker's poll: pending rows that are available, and processing rows whose lease
        # expired.
        Index("ix_reminder_occurrences_status_available_at", "status", "available_at"),
        Index("ix_reminder_occurrences_reminder_status", "reminder_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    reminder_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reminders.id", ondelete="CASCADE"))
    scheduled_for: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(16))
    attempts: Mapped[int] = mapped_column(Integer)
    available_at: Mapped[datetime] = mapped_column(UTCDateTime)
    claim_token: Mapped[uuid.UUID | None]
    claimed_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # A short, content-free description of the last failure, such as an exception class name.
    last_error: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class NotificationModel(Base):
    """An in-app notification for one user. Deleting the user or workspace deletes it; deleting
    the reminder keeps it, without the link."""

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("length(body) <= 2000", name="body_length"),
        # At most one notification per occurrence and recipient, however often delivery runs.
        UniqueConstraint("occurrence_id", "user_id", name="uq_notifications_occurrence_user"),
        # The inbox (newest first) and the unread count, both per user.
        Index("ix_notifications_user_created_at", "user_id", "created_at"),
        Index("ix_notifications_user_read_at", "user_id", "read_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    reminder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reminders.id", ondelete="SET NULL"), index=True
    )
    occurrence_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reminder_occurrences.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    scheduled_for: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
