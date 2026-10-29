"""Reminder and occurrence types."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Literal

from orbit_api.services.reminders.recurrence import Recurrence, Schedule
from orbit_api.services.tasks.models import UNSET, Change, TaskStatus

# Derived, never stored:
# - `disabled`: switched off; nothing fires.
# - `completed`: nothing left to fire (a one-time reminder that fired), or its task is completed.
# - `overdue`: an occurrence is due but not delivered yet, or the latest delivery failed.
# - `scheduled`: the next occurrence is in the future.
ReminderStatus = Literal["scheduled", "overdue", "completed", "disabled"]

# One occurrence's lifecycle. `pending` and `processing` are active; the rest are final.
# `processing` means a worker holds a lease on it, not that a notification exists: a notification
# exists exactly when the occurrence is `delivered`, and both are written in one transaction.
OccurrenceStatus = Literal["pending", "processing", "delivered", "cancelled", "failed"]
DeliveryOutcome = Literal["delivered", "cancelled", "failed"]


@dataclass(frozen=True, slots=True)
class Reminder:
    id: uuid.UUID
    workspace_id: uuid.UUID
    # A reminder about a task, or `None` for a standalone reminder.
    task_id: uuid.UUID | None
    title: str
    description: str
    enabled: bool
    schedule: Schedule
    # The scheduled time and outcome of the most recent occurrence the worker finished.
    last_occurrence_at: datetime | None
    last_outcome: DeliveryOutcome | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ReminderTask:
    """The task a reminder is about, as shown alongside it."""

    id: uuid.UUID
    title: str
    status: TaskStatus


@dataclass(frozen=True, slots=True)
class ReminderView:
    reminder: Reminder
    status: ReminderStatus
    # The earliest active occurrence, which may already be due.
    next_occurrence_at: datetime | None
    task: ReminderTask | None


@dataclass(frozen=True, slots=True)
class ReminderDraft:
    title: str
    start_date: date
    time_of_day: time
    # `None` uses the creator's time zone preference, or UTC without one.
    timezone: str | None
    description: str = ""
    task_id: uuid.UUID | None = None
    enabled: bool = True
    recurrence: Recurrence | None = None


@dataclass(frozen=True, slots=True)
class ReminderChanges:
    """A partial update. `UNSET` leaves a field as it is; `None` detaches the task or makes the
    reminder one-time."""

    title: Change[str] = UNSET
    description: Change[str] = UNSET
    task_id: Change[uuid.UUID | None] = UNSET
    enabled: Change[bool] = UNSET
    start_date: Change[date] = UNSET
    time_of_day: Change[time] = UNSET
    timezone: Change[str] = UNSET
    recurrence: Change[Recurrence | None] = UNSET


@dataclass(frozen=True, slots=True)
class ReminderQuery:
    status: ReminderStatus | None = None
    task_id: uuid.UUID | None = None
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True, slots=True)
class ReminderPage:
    reminders: list[ReminderView]
    # All reminders matching the query, ignoring `limit` and `offset`.
    total: int


@dataclass(frozen=True, slots=True)
class Occurrence:
    id: uuid.UUID
    reminder_id: uuid.UUID
    scheduled_for: datetime
    status: OccurrenceStatus
    # Delivery attempts so far; a claim counts as an attempt.
    attempts: int
    # When a worker may next claim it: `scheduled_for`, or later after a failed attempt.
    available_at: datetime
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ClaimedOccurrence:
    """An occurrence a worker has leased. Only the holder of `claim_token` may finish it."""

    id: uuid.UUID
    reminder_id: uuid.UUID
    scheduled_for: datetime
    attempts: int
    claim_token: uuid.UUID


@dataclass(frozen=True, slots=True)
class DeliveryTarget:
    """What the worker needs to deliver one of a reminder's occurrences."""

    reminder: Reminder
    task_completed: bool
    # Who is notified: the workspace's owner, the only member a workspace has today.
    recipients: tuple[uuid.UUID, ...]


class ReminderNotFoundError(Exception):
    """The reminder does not exist in this workspace."""


class ReminderTaskNotFoundError(Exception):
    """The task a reminder should be about does not exist in the reminder's workspace."""


class ReminderInPastError(Exception):
    """A one-time reminder was scheduled, or re-enabled, at a time that has already passed."""
