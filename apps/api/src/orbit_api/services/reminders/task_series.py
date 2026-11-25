"""Reminders of a repeating task follow the series from one occurrence to the next.

A one-time reminder keeps its distance from the due date, so "the day before" stays the day before
each occurrence. A recurring reminder has its own rhythm and keeps its schedule.
"""

import uuid
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Protocol

from orbit_api.services.reminders.models import Reminder
from orbit_api.services.reminders.service import OccurrenceScheduler, schedule_next


class TaskReminderStore(Protocol):
    async def for_task(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> list[Reminder]:
        """The task's reminders, locked for this transaction."""
        ...

    async def save(self, reminder: Reminder) -> None: ...


class SeriesReminders:
    def __init__(self, reminders: TaskReminderStore, occurrences: OccurrenceScheduler) -> None:
        self._reminders = reminders
        self._occurrences = occurrences

    async def move(
        self,
        workspace_id: uuid.UUID,
        source_id: uuid.UUID,
        target_id: uuid.UUID,
        shift: timedelta,
        now: datetime,
    ) -> None:
        """Move the source task's reminders to the target, moving one-time ones by `shift`."""
        for reminder in await self._reminders.for_task(workspace_id, source_id):
            schedule = reminder.schedule
            if schedule.recurrence is not None:
                await self._reminders.save(replace(reminder, task_id=target_id, updated_at=now))
                continue
            moved = replace(
                reminder,
                task_id=target_id,
                schedule=replace(schedule, start_date=schedule.start_date + shift),
                updated_at=now,
            )
            # Saving first locks the row against a worker delivering one of its occurrences.
            await self._reminders.save(moved)
            await self._occurrences.remove_pending(reminder.id)
            await schedule_next(self._occurrences, moved, now, now)
