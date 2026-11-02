"""How health records connect to habits, the calendar, notes, and documents. Nothing here copies
another module's data or runs its own scheduler.

- **Habits.** A habit can be linked to one kind of record: workouts, water, or one kind of
  activity. With `contributes` on (it's off by default), saving such a record records the day's
  total on the habit through `HabitService.contribute`, in the same transaction:

  - yes-or-no habits: a completed workout; the water target met (any water without a target);
    an entry of that activity kind;
  - duration habits: minutes of workouts, or minutes of that activity;
  - amount habits: the number of workouts; the water total in the profile's water unit; steps,
    distance (in km or mi), sleep hours, or cardio minutes.

  Contributions only raise a day (never lower or remove it, and never touch a skipped day), and
  the habit log keeps one entry per day, so nothing is counted twice. Completing a habit never
  creates a health record.
- **Calendar.** Scheduling a workout creates an ordinary calendar event (its alerts are the
  reminders) and links it, optionally to a template; an existing event can be linked instead,
  so there's never a second event for the same workout. Starting a workout from the event
  records which event it came from.
- **Notes and documents** link to workouts and goals; the records stay where they live.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol

from orbit_api.services.calendar.models import CalendarRange, DateWindow
from orbit_api.services.fitness.calculations import (
    DISTANCE_ACTIVITIES,
    distance_in_unit,
    water_in_unit,
)
from orbit_api.services.fitness.models import (
    ActivityKind,
    FitnessNotFoundError,
    HabitLink,
    HabitLinkDraft,
    HabitSource,
    InvalidFitnessError,
    LinkedRecord,
    LinkOwnerKind,
    LinkTargetKind,
    Owner,
    ProfileDraft,
    ScheduledWorkout,
)
from orbit_api.services.fitness.store import FitnessStore
from orbit_api.services.transactions import Transaction

# A contribution: `None` completes the day; a number records progress toward the target.
type Contribution = float | None


class HabitRecorder(Protocol):
    async def contribute(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, day: date, value: float | None
    ) -> bool: ...


class CalendarReader(Protocol):
    async def range(self, workspace_id: uuid.UUID, window: DateWindow) -> CalendarRange: ...


@dataclass(frozen=True, slots=True)
class DayRecords:
    """What one day holds for a contribution source."""

    count: int = 0
    seconds: int = 0
    water_ml: int = 0
    steps: int = 0
    distance_m: int = 0


def contribution(
    habit_kind: str,
    source: HabitSource,
    activity_kind: ActivityKind | None,
    records: DayRecords,
    profile: ProfileDraft,
) -> tuple[bool, Contribution]:
    """Whether to write to the habit, and what (see the module docstring)."""
    if source == "water":
        if habit_kind == "boolean":
            target = profile.targets.water_ml
            met = records.water_ml >= target if target else records.water_ml > 0
            return met, None
        if habit_kind == "numeric" and records.water_ml > 0:
            return True, water_in_unit(records.water_ml, profile.water_unit)
        return False, None
    if records.count == 0:
        return False, None
    if habit_kind == "boolean":
        return True, None
    if habit_kind == "duration":
        return (records.seconds > 0), round(records.seconds / 60, 2)
    if source == "workout" or activity_kind == "rest_day":
        return True, float(records.count)
    if activity_kind == "steps":
        return True, float(records.steps)
    if activity_kind in DISTANCE_ACTIVITIES:
        miles = profile.distance_unit == "mi"
        return (records.distance_m > 0), distance_in_unit(records.distance_m, miles)
    if activity_kind == "sleep":
        return True, round(records.seconds / 3600, 2)
    return (records.seconds > 0), round(records.seconds / 60, 2)


class Contributions:
    """Applies a day's records to the habits linked to them, without committing."""

    def __init__(self, store: FitnessStore, habits: HabitRecorder) -> None:
        self._store = store
        self._habits = habits

    async def workouts(self, owner: Owner, day: date) -> None:
        await self._apply(owner, "workout", None, day)

    async def water(self, owner: Owner, day: date) -> None:
        await self._apply(owner, "water", None, day)

    async def activity(self, owner: Owner, kind: ActivityKind, day: date) -> None:
        await self._apply(owner, "activity", kind, day)

    async def _apply(
        self, owner: Owner, source: HabitSource, kind: ActivityKind | None, day: date
    ) -> None:
        links = [
            link
            for link in await self._store.habit_links(owner, source)
            if link.contributes and link.activity_kind == kind
        ]
        if not links:
            return
        records = await self._records(owner, source, kind, day)
        stored = await self._store.get_profile(owner)
        profile = stored.settings if stored is not None else ProfileDraft()
        for link in links:
            write, value = contribution(link.habit_kind, source, kind, records, profile)
            if write:
                await self._habits.contribute(owner.workspace_id, link.habit_id, day, value)

    async def _records(
        self, owner: Owner, source: HabitSource, kind: ActivityKind | None, day: date
    ) -> DayRecords:
        if source == "workout":
            sessions = await self._store.sessions(
                owner, start=day, end=day, statuses=("completed",)
            )
            return DayRecords(count=len(sessions), seconds=sum(s.duration_s or 0 for s in sessions))
        if source == "water":
            entries = await self._store.water_entries(owner, day, day)
            return DayRecords(count=len(entries), water_ml=sum(e.amount_ml for e in entries))
        activities = await self._store.activities(owner, day, day, kind)
        return DayRecords(
            count=len(activities),
            seconds=sum(a.details.duration_s or 0 for a in activities),
            steps=sum(a.details.steps or 0 for a in activities),
            distance_m=sum(a.details.distance_m or 0 for a in activities),
        )


class IntegrationService:
    def __init__(
        self, store: FitnessStore, calendar: CalendarReader, transaction: Transaction
    ) -> None:
        self._store = store
        self._calendar = calendar
        self._transaction = transaction

    # Habits

    async def habit_links(self, owner: Owner) -> list[HabitLink]:
        return await self._store.habit_links(owner)

    async def link_habit(self, owner: Owner, draft: HabitLinkDraft) -> HabitLink:
        """Link a habit to a kind of record, or change its link. Contributions apply to records
        saved from now on; earlier days aren't changed."""
        if await self._store.habit(owner.workspace_id, draft.habit_id) is None:
            raise InvalidFitnessError("That habit doesn't exist in this workspace.")
        if (draft.source == "activity") != (draft.activity_kind is not None):
            raise InvalidFitnessError("Activity links need an activity kind, and only they do.")
        existing = {link.habit_id: link for link in await self._store.habit_links(owner)}
        current = existing.get(draft.habit_id)
        await self._store.put_habit_link(owner, current.id if current else uuid.uuid4(), draft)
        await self._transaction.commit()
        links = {link.habit_id: link for link in await self._store.habit_links(owner)}
        return links[draft.habit_id]

    async def unlink_habit(self, owner: Owner, habit_id: uuid.UUID) -> None:
        if not await self._store.delete_habit_link(owner, habit_id):
            raise FitnessNotFoundError("Habit link")
        await self._transaction.commit()

    # Calendar

    async def link_event(
        self, owner: Owner, event_id: uuid.UUID, template_id: uuid.UUID | None
    ) -> ScheduledWorkout:
        """Mark a calendar event as a scheduled workout (idempotent; changes its template)."""
        title = await self._store.event_title(owner.workspace_id, event_id)
        if title is None:
            raise InvalidFitnessError("That event doesn't exist in this workspace.")
        if template_id is not None and await self._store.get_template(owner, template_id) is None:
            raise InvalidFitnessError("That template doesn't exist.")
        await self._store.put_workout_event(owner, event_id, template_id)
        await self._transaction.commit()
        return await self.scheduled_for_event(owner, event_id)

    async def unlink_event(self, owner: Owner, event_id: uuid.UUID) -> None:
        """The event stays on the calendar; it's just no longer a workout."""
        if not await self._store.delete_workout_event(owner, event_id):
            raise FitnessNotFoundError("Scheduled workout")
        await self._transaction.commit()

    async def scheduled_for_event(self, owner: Owner, event_id: uuid.UUID) -> ScheduledWorkout:
        events = await self._store.workout_events(owner, [event_id])
        title = await self._store.event_title(owner.workspace_id, event_id)
        if event_id not in events or title is None:
            raise FitnessNotFoundError("Scheduled workout")
        return await self._scheduled(owner, event_id, title, events[event_id], None, None)

    async def scheduled(
        self, owner: Owner, start: date, end: date, timezone: str
    ) -> list[ScheduledWorkout]:
        """Scheduled workouts' occurrences on local dates `[start, end)`."""
        events = await self._store.workout_events(owner)
        if not events:
            return []
        window = DateWindow(start=start, end=end, timezone=timezone, include_tasks=False)
        occurrences = (await self._calendar.range(owner.workspace_id, window)).occurrences
        result: list[ScheduledWorkout] = []
        for occurrence in occurrences:
            event = occurrence.event
            if event.id not in events:
                continue
            result.append(
                await self._scheduled(
                    owner,
                    event.id,
                    occurrence.title,
                    events[event.id],
                    occurrence.start_at,
                    occurrence.end_at,
                )
            )
        return sorted(result, key=lambda s: s.start_at or datetime.min.replace(tzinfo=UTC))

    async def _scheduled(
        self,
        owner: Owner,
        event_id: uuid.UUID,
        title: str,
        template_id: uuid.UUID | None,
        start_at: datetime | None,
        end_at: datetime | None,
    ) -> ScheduledWorkout:
        template = (
            await self._store.get_template(owner, template_id) if template_id is not None else None
        )
        sessions = await self._store.sessions(owner, calendar_event_id=event_id)
        return ScheduledWorkout(
            calendar_event_id=event_id,
            title=title,
            template_id=template.id if template else None,
            template_name=template.name if template else None,
            start_at=start_at,
            end_at=end_at,
            session_ids=tuple(s.id for s in sessions),
        )

    # Notes and documents

    async def links(
        self, owner: Owner, kind: LinkOwnerKind, owner_id: uuid.UUID
    ) -> list[LinkedRecord]:
        await self._require_owner(owner, kind, owner_id)
        return await self._store.links(owner, kind, owner_id)

    async def link(
        self,
        owner: Owner,
        kind: LinkOwnerKind,
        owner_id: uuid.UUID,
        target: LinkTargetKind,
        target_id: uuid.UUID,
    ) -> list[LinkedRecord]:
        await self._require_owner(owner, kind, owner_id)
        if await self._store.record_title(owner.workspace_id, target, target_id) is None:
            raise InvalidFitnessError(f"That {target} doesn't exist in this workspace.")
        await self._store.put_link(owner, kind, owner_id, target, target_id)
        await self._transaction.commit()
        return await self._store.links(owner, kind, owner_id)

    async def unlink(
        self,
        owner: Owner,
        kind: LinkOwnerKind,
        owner_id: uuid.UUID,
        target: LinkTargetKind,
        target_id: uuid.UUID,
    ) -> None:
        """Idempotent."""
        await self._require_owner(owner, kind, owner_id)
        await self._store.delete_link(owner, kind, owner_id, target, target_id)
        await self._transaction.commit()

    async def _require_owner(self, owner: Owner, kind: LinkOwnerKind, owner_id: uuid.UUID) -> None:
        found = (
            await self._store.get_session(owner, owner_id)
            if kind == "session"
            else await self._store.get_goal(owner, owner_id)
        )
        if found is None:
            raise FitnessNotFoundError("Workout" if kind == "session" else "Goal")
