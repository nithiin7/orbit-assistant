"""People: the people in your life, and their birthdays, anniversaries, and other yearly dates.

- Each person owns at most one managed reminder (marked "Managed in People"), pointed at their
  soonest upcoming date alert in the same transaction as every change, and moved on to the next
  one by `after_delivery` once it fires. Deleting the person deletes it (the foreign key
  cascades); its delivered notifications stay.
- Reminders carry names and dates only, never contact details or notes.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from orbit_api.services.people.dates import check_dates, reminder_target
from orbit_api.services.people.models import (
    Person,
    PersonChanges,
    PersonDraft,
    PersonNotFoundError,
)
from orbit_api.services.reminders.managed import ReminderStore, point_reminder
from orbit_api.services.reminders.models import CommitmentLink, Reminder
from orbit_api.services.reminders.service import OccurrenceScheduler
from orbit_api.services.transactions import Transaction
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now


class PeopleStore(Protocol):
    async def all(self, workspace_id: uuid.UUID) -> list[Person]:
        """Every person in the workspace, by name."""
        ...

    async def get(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> Person | None:
        """The person, only if they belong to `workspace_id`."""
        ...

    async def add(self, person: Person) -> None: ...

    async def save(self, person: Person) -> None:
        """Store an existing person's fields and replace their dates. Matches on both the ID
        and the workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> bool:
        """Delete the person if they belong to `workspace_id`; report whether they existed."""
        ...


class PeopleReminders:
    """Keeps each person's managed reminder pointed at their next date alert."""

    def __init__(
        self,
        store: PeopleStore,
        reminders: ReminderStore,
        occurrences: OccurrenceScheduler,
        clock: Callable[[], datetime],
    ) -> None:
        self._store = store
        self._reminders = reminders
        self._occurrences = occurrences
        self._clock = clock

    async def sync(self, person: Person) -> None:
        now = self._clock()
        await point_reminder(
            self._reminders,
            self._occurrences,
            person.workspace_id,
            CommitmentLink(kind="person", id=person.id),
            reminder_target(person, now),
            now,
        )

    async def after_delivery(self, reminder: Reminder, now: datetime) -> None:
        """Point a delivered reminder at the person's next date alert. Called by the reminder
        worker inside its delivery transaction, which commits."""
        link = reminder.commitment
        if link is None or link.kind != "person":
            return
        person = await self._store.get(reminder.workspace_id, link.id)
        if person is not None:
            await point_reminder(
                self._reminders,
                self._occurrences,
                person.workspace_id,
                link,
                reminder_target(person, now),
                now,
            )


class PeopleService:
    def __init__(
        self,
        store: PeopleStore,
        reminders: ReminderStore,
        occurrences: OccurrenceScheduler,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._transaction = transaction
        self._clock = clock
        self._reminders = PeopleReminders(store, reminders, occurrences, clock)

    async def people(self, workspace_id: uuid.UUID) -> list[Person]:
        return await self._store.all(workspace_id)

    async def get(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> Person:
        person = await self._store.get(workspace_id, person_id)
        if person is None:
            raise PersonNotFoundError
        return person

    async def add(self, workspace_id: uuid.UUID, draft: PersonDraft) -> Person:
        """Add a person. Raises `PersonDateError` for a day that doesn't exist or a second
        birthday."""
        check_dates(draft.dates)
        now = self._clock()
        person = Person(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=draft.name,
            relationship=draft.relationship,
            phone=draft.phone,
            email=draft.email,
            note=draft.note,
            favorite=draft.favorite,
            dates=draft.dates,
            reminder_time=draft.reminder_time,
            timezone=draft.timezone,
            created_at=now,
            updated_at=now,
        )
        await self._store.add(person)
        await self._reminders.sync(person)
        await self._transaction.commit()
        return person

    async def update(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, changes: PersonChanges
    ) -> Person:
        """Change some of a person's fields; `dates` replaces all of them."""
        person = await self.get(workspace_id, person_id)
        if changes.dates is not UNSET:
            check_dates(changes.dates)
        updated = replace(
            person,
            name=person.name if changes.name is UNSET else changes.name,
            relationship=person.relationship
            if changes.relationship is UNSET
            else changes.relationship,
            phone=person.phone if changes.phone is UNSET else changes.phone,
            email=person.email if changes.email is UNSET else changes.email,
            note=person.note if changes.note is UNSET else changes.note,
            favorite=person.favorite if changes.favorite is UNSET else changes.favorite,
            dates=person.dates if changes.dates is UNSET else changes.dates,
            reminder_time=person.reminder_time
            if changes.reminder_time is UNSET
            else changes.reminder_time,
            timezone=person.timezone if changes.timezone is UNSET else changes.timezone,
        )
        if updated == person:
            return person
        updated = replace(updated, updated_at=self._clock())
        await self._store.save(updated)
        await self._reminders.sync(updated)
        await self._transaction.commit()
        return updated

    async def delete(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> None:
        """Delete the person, their dates, and their managed reminder."""
        if not await self._store.delete(workspace_id, person_id):
            raise PersonNotFoundError
        await self._transaction.commit()
