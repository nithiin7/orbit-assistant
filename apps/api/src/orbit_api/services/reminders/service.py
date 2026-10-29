"""Reminders: one-time or recurring prompts inside a workspace, optionally about a task.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. A reminder or task ID alone
never reaches a row: one in another workspace is indistinguishable from one that doesn't exist.

Scheduling: each enabled reminder has at most one pending occurrence, its next one, stored in the
database so it survives restarts. Changing a reminder's schedule or switching it on or off
replaces that occurrence in the same transaction as the change. The worker
(`services.reminders.delivery`) delivers due occurrences and schedules the next.

Tasks and reminders:

- A reminder's time is independent of its task's due date. Rescheduling the task (changing its
  due date) leaves its reminders where they are.
- While the task is completed, its reminders don't notify: occurrences that come due are
  cancelled, and recurring reminders keep their schedule, so reopening the task resumes them.
- Deleting the task deletes its reminders (a database cascade). Notifications already delivered
  stay in the inbox.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from typing import Protocol

from orbit_api.services.reminders.models import (
    Occurrence,
    Reminder,
    ReminderChanges,
    ReminderDraft,
    ReminderInPastError,
    ReminderNotFoundError,
    ReminderPage,
    ReminderQuery,
    ReminderTaskNotFoundError,
    ReminderView,
)
from orbit_api.services.reminders.recurrence import Schedule, next_occurrence
from orbit_api.services.tasks.models import UNSET, Task
from orbit_api.services.transactions import Transaction

DEFAULT_TIMEZONE = "UTC"


class ReminderRepository(Protocol):
    async def add(self, reminder: Reminder) -> None: ...

    async def get(self, workspace_id: uuid.UUID, reminder_id: uuid.UUID) -> Reminder | None:
        """The reminder, only if it belongs to `workspace_id`."""
        ...

    async def view(
        self, workspace_id: uuid.UUID, reminder_id: uuid.UUID, now: datetime
    ) -> ReminderView | None: ...

    async def find(
        self, workspace_id: uuid.UUID, query: ReminderQuery, now: datetime
    ) -> ReminderPage: ...

    async def upcoming(
        self, workspace_id: uuid.UUID, now: datetime, limit: int
    ) -> list[ReminderView]:
        """Enabled reminders with an active occurrence whose task (if any) is open, soonest
        first. Includes occurrences that are due but not delivered yet."""
        ...

    async def save(self, reminder: Reminder) -> None:
        """Store an existing reminder's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, reminder_id: uuid.UUID) -> bool:
        """Delete the reminder and its occurrences if it belongs to `workspace_id`."""
        ...


class OccurrenceScheduler(Protocol):
    """The occurrence operations needed when a reminder changes."""

    async def add(self, occurrence: Occurrence) -> None: ...

    async def remove_pending(self, reminder_id: uuid.UUID) -> None:
        """Delete the reminder's pending occurrences. Ones a worker is processing are kept."""
        ...

    async def has_active(self, reminder_id: uuid.UUID) -> bool:
        """Whether the reminder has a pending or processing occurrence."""
        ...


class TaskLookup(Protocol):
    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None: ...


def _utc_now() -> datetime:
    return datetime.now(UTC)


async def schedule_next(
    occurrences: OccurrenceScheduler, reminder: Reminder, after: datetime, now: datetime
) -> Occurrence | None:
    """Add the reminder's next occurrence after `after`, unless it is disabled, has no later
    occurrence, or already has an active one (whose processing will schedule the next)."""
    if not reminder.enabled or await occurrences.has_active(reminder.id):
        return None
    at = next_occurrence(reminder.schedule, after)
    if at is None:
        return None
    occurrence = Occurrence(
        id=uuid.uuid4(),
        reminder_id=reminder.id,
        scheduled_for=at,
        status="pending",
        attempts=0,
        available_at=at,
        created_at=now,
    )
    await occurrences.add(occurrence)
    return occurrence


class ReminderService:
    def __init__(
        self,
        reminders: ReminderRepository,
        occurrences: OccurrenceScheduler,
        tasks: TaskLookup,
        transaction: Transaction,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._reminders = reminders
        self._occurrences = occurrences
        self._tasks = tasks
        self._transaction = transaction
        self._clock = clock

    async def create(
        self, workspace_id: uuid.UUID, draft: ReminderDraft, *, default_timezone: str | None
    ) -> ReminderView:
        """`default_timezone` (the creator's preference) applies when the draft has none."""
        now = self._clock()
        if draft.task_id is not None:
            await self._require_task(workspace_id, draft.task_id)
        schedule = Schedule(
            start_date=draft.start_date,
            time_of_day=draft.time_of_day,
            timezone=draft.timezone or default_timezone or DEFAULT_TIMEZONE,
            recurrence=draft.recurrence,
        )
        reminder = Reminder(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            task_id=draft.task_id,
            title=draft.title,
            description=draft.description,
            enabled=draft.enabled,
            schedule=schedule,
            last_occurrence_at=None,
            last_outcome=None,
            created_at=now,
            updated_at=now,
        )
        _require_future(reminder, now)
        await self._reminders.add(reminder)
        await schedule_next(self._occurrences, reminder, now, now)
        await self._transaction.commit()
        return await self.get(workspace_id, reminder.id)

    async def get(self, workspace_id: uuid.UUID, reminder_id: uuid.UUID) -> ReminderView:
        view = await self._reminders.view(workspace_id, reminder_id, self._clock())
        if view is None:
            raise ReminderNotFoundError
        return view

    async def find(self, workspace_id: uuid.UUID, query: ReminderQuery) -> ReminderPage:
        return await self._reminders.find(workspace_id, query, self._clock())

    async def upcoming(self, workspace_id: uuid.UUID, limit: int) -> list[ReminderView]:
        return await self._reminders.upcoming(workspace_id, self._clock(), limit)

    async def update(
        self, workspace_id: uuid.UUID, reminder_id: uuid.UUID, changes: ReminderChanges
    ) -> ReminderView:
        reminder = await self._reminders.get(workspace_id, reminder_id)
        if reminder is None:
            raise ReminderNotFoundError
        if changes.task_id is not UNSET and changes.task_id is not None:
            await self._require_task(workspace_id, changes.task_id)

        schedule = reminder.schedule
        updated = replace(
            reminder,
            title=reminder.title if changes.title is UNSET else changes.title,
            description=(
                reminder.description if changes.description is UNSET else changes.description
            ),
            task_id=reminder.task_id if changes.task_id is UNSET else changes.task_id,
            enabled=reminder.enabled if changes.enabled is UNSET else changes.enabled,
            schedule=Schedule(
                start_date=(
                    schedule.start_date if changes.start_date is UNSET else changes.start_date
                ),
                time_of_day=(
                    schedule.time_of_day if changes.time_of_day is UNSET else changes.time_of_day
                ),
                timezone=schedule.timezone if changes.timezone is UNSET else changes.timezone,
                recurrence=(
                    schedule.recurrence if changes.recurrence is UNSET else changes.recurrence
                ),
            ),
        )
        # A request that changes nothing leaves `updated_at` and the schedule alone.
        if updated == reminder:
            return await self.get(workspace_id, reminder_id)

        now = self._clock()
        reschedule = updated.schedule != reminder.schedule or updated.enabled != reminder.enabled
        if reschedule:
            _require_future(updated, now)
        # Saving first locks the reminder's row, so a worker delivering one of its occurrences
        # sees either the old reminder or the new one, never a mix.
        await self._reminders.save(replace(updated, updated_at=now))
        if reschedule:
            await self._occurrences.remove_pending(reminder.id)
            await schedule_next(self._occurrences, updated, now, now)
        await self._transaction.commit()
        return await self.get(workspace_id, reminder_id)

    async def delete(self, workspace_id: uuid.UUID, reminder_id: uuid.UUID) -> None:
        if not await self._reminders.delete(workspace_id, reminder_id):
            raise ReminderNotFoundError
        await self._transaction.commit()

    async def _require_task(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> None:
        if await self._tasks.get(workspace_id, task_id) is None:
            raise ReminderTaskNotFoundError


def _require_future(reminder: Reminder, now: datetime) -> None:
    """An enabled one-time reminder must be in the future, or it would never fire."""
    schedule = reminder.schedule
    if reminder.enabled and schedule.recurrence is None and next_occurrence(schedule, now) is None:
        raise ReminderInPastError
