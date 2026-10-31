"""Reminders that a finance record manages: a loan's next EMI, a subscription's or bill's next
due date, or a deposit's maturity. The record owns at most one reminder (a unique link), and
points it at whatever it should announce next, in the same transaction as the change that moved
it. Idempotent: pointing it at the same target twice changes nothing.
"""

import uuid
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol

from orbit_api.services.reminders.models import CommitmentLink, Reminder
from orbit_api.services.reminders.recurrence import Schedule
from orbit_api.services.reminders.service import OccurrenceScheduler, schedule_next


class ReminderStore(Protocol):
    """The reminder operations a finance record needs to manage its reminder."""

    async def for_commitment(
        self, workspace_id: uuid.UUID, link: CommitmentLink
    ) -> Reminder | None: ...

    async def add(self, reminder: Reminder) -> None: ...

    async def save(self, reminder: Reminder) -> None: ...

    async def delete(self, workspace_id: uuid.UUID, reminder_id: uuid.UUID) -> bool: ...


@dataclass(frozen=True, slots=True)
class ReminderTarget:
    """What the managed reminder should say, and when (a one-time schedule)."""

    schedule: Schedule
    title: str
    description: str


async def point_reminder(
    store: ReminderStore,
    scheduler: OccurrenceScheduler,
    workspace_id: uuid.UUID,
    link: CommitmentLink,
    target: ReminderTarget | None,
    now: datetime,
) -> None:
    """Make the record's reminder announce `target`, or delete it when there is none."""
    existing = await store.for_commitment(workspace_id, link)
    if target is None:
        if existing is not None:
            await store.delete(workspace_id, existing.id)
        return
    if existing is None:
        reminder = Reminder(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            task_id=None,
            title=target.title,
            description=target.description,
            enabled=True,
            schedule=target.schedule,
            last_occurrence_at=None,
            last_outcome=None,
            created_at=now,
            updated_at=now,
            commitment=link,
        )
        await store.add(reminder)
        await schedule_next(scheduler, reminder, now, now)
        return
    updated = replace(
        existing,
        title=target.title,
        description=target.description,
        enabled=True,
        schedule=target.schedule,
    )
    if updated == existing and await scheduler.has_active(existing.id):
        return
    updated = replace(updated, updated_at=now)
    await store.save(updated)
    await scheduler.remove_pending(existing.id)
    await schedule_next(scheduler, updated, now, now)
