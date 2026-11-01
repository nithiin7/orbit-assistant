"""Habits: categories, habits and their schedules, the daily log, links to tasks and notes,
reminder times, the Today view, analytics, and calendar entries.

Every method takes a `workspace_id` that the caller has already authorized (`WorkspaceDep`), and
the store filters every query by it.

- **Schedules** are versions. A new schedule takes effect from a date (today by default) and
  replaces only versions from that date on; earlier days keep theirs.
- **Status**: pausing or archiving records a pause from today; resuming or restoring ends it the
  day before. Paused days aren't due, so they neither break streaks nor lower rates.
- **Log**: one entry per habit and local date, never in the future or outside the habit's dates.
  A new entry stores the habit's target; editing an entry keeps the target it was logged with.
- **Reminders** are reminder times, each managing one reminder (`Reminder.commitment` with kind
  `habit_reminder`) that the existing worker delivers. Every change re-points them at the next
  due day that isn't done yet, in the same transaction; pausing or archiving cancels them, and
  `after_delivery` moves them on once they fire.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.habits.insights import (
    analytics,
    calendar_entries,
    habit_reminder_target,
    heatmap,
    progress,
    routine_reminder_target,
    today_in,
)
from orbit_api.services.habits.models import (
    DEFAULT_CATEGORIES,
    MAX_CATEGORIES,
    MAX_REMINDERS,
    CalendarEntry,
    Habit,
    HabitAnalytics,
    HabitCategory,
    HabitCategoryNameTakenError,
    HabitCategoryNotFoundError,
    HabitChanges,
    HabitColor,
    HabitDay,
    HabitDetail,
    HabitDraft,
    HabitHistory,
    HabitIcon,
    HabitLog,
    HabitNotFoundError,
    HabitProgress,
    HabitReminder,
    HabitStatus,
    InvalidHabitError,
    InvalidLogError,
    LinkedItemNotFoundError,
    LinkedNote,
    LogDraft,
    ReminderTime,
    Routine,
    RoutineStatus,
    TodayView,
    TooManyHabitCategoriesError,
    UpcomingDay,
)
from orbit_api.services.habits.progress import day_state, periods
from orbit_api.services.habits.schedule import (
    HabitSchedule,
    Pause,
    ScheduleVersion,
    days,
    is_due,
    week_start,
)
from orbit_api.services.reminders.managed import ReminderStore, ReminderTarget, point_reminder
from orbit_api.services.reminders.models import CommitmentLink, Reminder
from orbit_api.services.reminders.service import DEFAULT_TIMEZONE, OccurrenceScheduler
from orbit_api.services.tasks.models import Task
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

MAX_LOG_VALUE = 1_000_000
MAX_RANGE_DAYS = 366


class HabitStore(Protocol):
    """Storage for habits and routines. Every query is filtered by workspace."""

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[HabitCategory]: ...

    async def add_category(self, category: HabitCategory) -> None: ...

    async def save_category(self, category: HabitCategory) -> None: ...

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        """Delete it; habits and routines in it keep no category."""
        ...

    # Habits

    async def habits(
        self, workspace_id: uuid.UUID, statuses: Sequence[HabitStatus] | None = None
    ) -> list[Habit]: ...

    async def get_habit(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> Habit | None: ...

    async def add_habit(self, habit: Habit) -> None:
        """Insert the habit with its versions and pauses."""
        ...

    async def save_habit(self, habit: Habit) -> None:
        """Store the habit's fields, versions, and pauses as given."""
        ...

    async def delete_habit(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> bool: ...

    async def logs(
        self,
        workspace_id: uuid.UUID,
        habit_ids: Sequence[uuid.UUID],
        start: date | None = None,
        end: date | None = None,
    ) -> dict[uuid.UUID, list[HabitLog]]:
        """Entries by habit, oldest first, optionally limited to `start` to `end`."""
        ...

    async def put_log(self, log: HabitLog) -> None:
        """Insert or replace the entry for its habit and day."""
        ...

    async def delete_log(self, workspace_id: uuid.UUID, habit_id: uuid.UUID, day: date) -> bool: ...

    # Links

    async def habit_tasks(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> list[Task]: ...

    async def habit_notes(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID
    ) -> list[LinkedNote]: ...

    async def link_task(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        """Idempotent."""
        ...

    async def unlink_task(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, task_id: uuid.UUID
    ) -> None: ...

    async def link_note(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        """Idempotent."""
        ...

    async def unlink_note(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, note_id: uuid.UUID
    ) -> None: ...

    async def task_exists(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> bool: ...

    async def note_exists(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> bool: ...

    # Reminder times

    async def reminder_times(
        self,
        workspace_id: uuid.UUID,
        *,
        habit_id: uuid.UUID | None = None,
        routine_id: uuid.UUID | None = None,
    ) -> list[HabitReminder]: ...

    async def get_reminder_time(
        self, workspace_id: uuid.UUID, reminder_id: uuid.UUID
    ) -> HabitReminder | None: ...

    async def set_reminder_times(
        self,
        workspace_id: uuid.UUID,
        times: Sequence[ReminderTime],
        *,
        habit_id: uuid.UUID | None = None,
        routine_id: uuid.UUID | None = None,
    ) -> None:
        """Make the owner's reminder times exactly `times`, keeping those at an unchanged time
        (and their reminders). Removing one deletes its reminder."""
        ...

    # Routines (the parts habits need)

    async def routines(
        self, workspace_id: uuid.UUID, statuses: Sequence[RoutineStatus] | None = None
    ) -> list[Routine]: ...

    async def get_routine(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID
    ) -> Routine | None: ...

    async def finished_days(
        self, workspace_id: uuid.UUID, routine_ids: Sequence[uuid.UUID], start: date, end: date
    ) -> dict[uuid.UUID, set[date]]:
        """Days with a completed session, by routine."""
        ...


def normalize_name(name: str) -> str:
    return " ".join(name.split()).casefold()


class HabitReminders:
    """Keeps habit and routine reminder times pointed at what they should announce next."""

    def __init__(
        self,
        store: HabitStore,
        reminders: ReminderStore,
        occurrences: OccurrenceScheduler,
        clock: Callable[[], datetime],
    ) -> None:
        self._store = store
        self._reminders = reminders
        self._occurrences = occurrences
        self._clock = clock

    async def sync_habit(self, habit: Habit) -> None:
        now = self._clock()
        times = await self._store.reminder_times(habit.workspace_id, habit_id=habit.id)
        if not times:
            return
        start = week_start(today_in(habit.timezone, now))
        logs = (await self._store.logs(habit.workspace_id, [habit.id], start)).get(habit.id, [])
        for time in times:
            await self._point(time, habit_reminder_target(habit, time, logs, now), now)

    async def sync_routine(self, routine: Routine) -> None:
        now = self._clock()
        times = await self._store.reminder_times(routine.workspace_id, routine_id=routine.id)
        if not times:
            return
        today = today_in(routine.timezone, now)
        finished = await self._store.finished_days(
            routine.workspace_id, [routine.id], today, today + timedelta(days=14)
        )
        for time in times:
            target = routine_reminder_target(routine, time, finished.get(routine.id, set()), now)
            await self._point(time, target, now)

    async def after_delivery(self, reminder: Reminder, now: datetime) -> None:
        """Point a delivered reminder time at its next day. Called by the reminder worker inside
        its delivery transaction, which commits."""
        link = reminder.commitment
        if link is None or link.kind != "habit_reminder":
            return
        time = await self._store.get_reminder_time(reminder.workspace_id, link.id)
        if time is None:
            return
        if time.habit_id is not None:
            habit = await self._store.get_habit(reminder.workspace_id, time.habit_id)
            if habit is not None:
                await self.sync_habit(habit)
        elif time.routine_id is not None:
            routine = await self._store.get_routine(reminder.workspace_id, time.routine_id)
            if routine is not None:
                await self.sync_routine(routine)

    async def _point(
        self, time: HabitReminder, target: ReminderTarget | None, now: datetime
    ) -> None:
        await point_reminder(
            self._reminders,
            self._occurrences,
            time.workspace_id,
            CommitmentLink(kind="habit_reminder", id=time.id),
            target,
            now,
        )


def check_reminder_times(times: Sequence[ReminderTime]) -> None:
    if len(times) > MAX_REMINDERS:
        raise InvalidHabitError(f"A habit or routine can have at most {MAX_REMINDERS} reminders.")
    if len({t.time_of_day for t in times}) != len(times):
        raise InvalidHabitError("Two reminders can't share a time.")


class HabitService:
    def __init__(
        self,
        store: HabitStore,
        reminders: ReminderStore,
        occurrences: OccurrenceScheduler,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._transaction = transaction
        self._clock = clock
        self.reminders = HabitReminders(store, reminders, occurrences, clock)

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[HabitCategory]:
        """The workspace's categories, creating the defaults the first time."""
        categories = await self._store.categories(workspace_id)
        if categories:
            return categories
        now = self._clock()
        try:
            for position, (name, color, icon) in enumerate(DEFAULT_CATEGORIES):
                await self._store.add_category(
                    HabitCategory(uuid.uuid4(), workspace_id, name, color, icon, position, now, now)
                )
            await self._transaction.commit()
        except ConflictError:
            # A concurrent first request created them.
            await self._transaction.rollback()
        return await self._store.categories(workspace_id)

    async def create_category(
        self, workspace_id: uuid.UUID, name: str, color: HabitColor, icon: HabitIcon
    ) -> HabitCategory:
        existing = await self.categories(workspace_id)
        if len(existing) >= MAX_CATEGORIES:
            raise TooManyHabitCategoriesError
        if any(normalize_name(c.name) == normalize_name(name) for c in existing):
            raise HabitCategoryNameTakenError
        now = self._clock()
        position = max((c.position for c in existing), default=-1) + 1
        category = HabitCategory(uuid.uuid4(), workspace_id, name, color, icon, position, now, now)
        try:
            await self._store.add_category(category)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise HabitCategoryNameTakenError from None
        return category

    async def update_category(
        self,
        workspace_id: uuid.UUID,
        category_id: uuid.UUID,
        *,
        name: str | None = None,
        color: HabitColor | None = None,
        icon: HabitIcon | None = None,
    ) -> HabitCategory:
        existing = await self.categories(workspace_id)
        category = next((c for c in existing if c.id == category_id), None)
        if category is None:
            raise HabitCategoryNotFoundError
        if name is not None and any(
            c.id != category_id and normalize_name(c.name) == normalize_name(name) for c in existing
        ):
            raise HabitCategoryNameTakenError
        updated = replace(
            category,
            name=category.name if name is None else name,
            color=color or category.color,
            icon=icon or category.icon,
            updated_at=self._clock(),
        )
        try:
            await self._store.save_category(updated)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise HabitCategoryNameTakenError from None
        return updated

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None:
        if not await self._store.delete_category(workspace_id, category_id):
            raise HabitCategoryNotFoundError
        await self._transaction.commit()

    # Habits

    async def find(
        self, workspace_id: uuid.UUID, statuses: Sequence[HabitStatus] | None
    ) -> list[HabitProgress]:
        habits = await self._store.habits(workspace_id, statuses)
        logs = await self._store.logs(workspace_id, [h.id for h in habits])
        now = self._clock()
        result: list[HabitProgress] = []
        for habit in habits:
            today = today_in(habit.timezone, now)
            result.append(progress(habit, logs.get(habit.id, []), today, today))
        return result

    async def today(self, workspace_id: uuid.UUID, day: date | None, timezone: str) -> TodayView:
        """Habits as of `day` (today in `timezone` by default): its states, its week, and the
        days after it."""
        now = self._clock()
        day = day or today_in(timezone, now)
        habits = await self._store.habits(workspace_id, ("active", "paused"))
        logs = await self._store.logs(workspace_id, [h.id for h in habits])
        monday = week_start(day)
        upcoming: list[UpcomingDay] = []
        for later in days(day + timedelta(days=1), day + timedelta(days=7)):
            due: list[uuid.UUID] = []
            for habit in habits:
                timeline = habit.timeline
                version = timeline.version_on(later)
                if (
                    habit.status == "active"
                    and timeline.tracked(later)
                    and not version.schedule.flexible
                    and is_due(version, later)
                ):
                    due.append(habit.id)
            upcoming.append(UpcomingDay(later, due))
        return TodayView(
            day=day,
            habits=[
                progress(
                    habit, logs.get(habit.id, []), day, max(day, today_in(habit.timezone, now))
                )
                for habit in habits
            ],
            week=heatmap(habits, logs, monday, monday + timedelta(days=6)),
            upcoming=upcoming,
        )

    async def create(
        self, workspace_id: uuid.UUID, draft: HabitDraft, *, default_timezone: str | None
    ) -> HabitDetail:
        now = self._clock()
        await self._require_category(workspace_id, draft.category_id)
        check_reminder_times(draft.reminders)
        habit = Habit(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            category_id=draft.category_id,
            name=draft.name,
            description=draft.description,
            icon=draft.icon,
            color=draft.color,
            kind=draft.kind,
            unit=draft.unit if draft.kind == "numeric" else "",
            target=draft.target,
            time_of_day=draft.time_of_day,
            start_date=draft.start_date,
            end_date=draft.end_date,
            timezone=draft.timezone or default_timezone or DEFAULT_TIMEZONE,
            status="active",
            versions=(ScheduleVersion(draft.start_date, draft.schedule),),
            pauses=(),
            created_at=now,
            updated_at=now,
        )
        _check_habit(habit)
        await self._store.add_habit(habit)
        await self._store.set_reminder_times(workspace_id, draft.reminders, habit_id=habit.id)
        await self.reminders.sync_habit(habit)
        await self._transaction.commit()
        return await self.get(workspace_id, habit.id)

    async def get(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> HabitDetail:
        habit = await self._require_habit(workspace_id, habit_id)
        logs = (await self._store.logs(workspace_id, [habit_id])).get(habit_id, [])
        today = today_in(habit.timezone, self._clock())
        return HabitDetail(
            progress=progress(habit, logs, today, today),
            reminders=await self._store.reminder_times(workspace_id, habit_id=habit_id),
            tasks=await self._store.habit_tasks(workspace_id, habit_id),
            notes=await self._store.habit_notes(workspace_id, habit_id),
        )

    async def update(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, changes: HabitChanges
    ) -> HabitDetail:
        habit = await self._require_habit(workspace_id, habit_id)
        if changes.category_id is not UNSET:
            await self._require_category(workspace_id, changes.category_id)
        timezone = habit.timezone if changes.timezone is UNSET else changes.timezone
        today = today_in(timezone, self._clock())

        updated = replace(
            habit,
            name=habit.name if changes.name is UNSET else changes.name,
            description=habit.description if changes.description is UNSET else changes.description,
            category_id=habit.category_id if changes.category_id is UNSET else changes.category_id,
            icon=habit.icon if changes.icon is UNSET else changes.icon,
            color=habit.color if changes.color is UNSET else changes.color,
            unit=habit.unit if changes.unit is UNSET or habit.kind != "numeric" else changes.unit,
            target=habit.target if changes.target is UNSET else changes.target,
            time_of_day=habit.time_of_day if changes.time_of_day is UNSET else changes.time_of_day,
            start_date=habit.start_date if changes.start_date is UNSET else changes.start_date,
            end_date=habit.end_date if changes.end_date is UNSET else changes.end_date,
            timezone=timezone,
        )
        if changes.schedule is not UNSET:
            updated = replace(
                updated,
                versions=_with_schedule(updated, changes.schedule, changes.schedule_from or today),
            )
        if changes.status is not UNSET and changes.status != habit.status:
            updated = replace(
                updated, status=changes.status, pauses=_with_status(updated, changes.status, today)
            )
        if updated == habit:
            return await self.get(workspace_id, habit_id)
        _check_habit(updated)
        updated = replace(updated, updated_at=self._clock())
        await self._store.save_habit(updated)
        await self.reminders.sync_habit(updated)
        await self._transaction.commit()
        return await self.get(workspace_id, habit_id)

    async def delete(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> None:
        """Delete the habit, its history, and its reminders. Routine steps keep no habit."""
        if not await self._store.delete_habit(workspace_id, habit_id):
            raise HabitNotFoundError
        await self._transaction.commit()

    async def history(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, start: date, end: date
    ) -> HabitHistory:
        _check_range(start, end)
        habit = await self._require_habit(workspace_id, habit_id)
        today = today_in(habit.timezone, self._clock())
        logs = (await self._store.logs(workspace_id, [habit_id])).get(habit_id, [])
        by_day = {log.day: log for log in logs}
        entries = {log.day: log.entry for log in logs}
        timeline = habit.timeline
        return HabitHistory(
            habit=habit,
            days=[
                HabitDay(day, day_state(timeline, entries, day, today), by_day.get(day))
                for day in days(start, end)
            ],
            periods=periods(timeline, entries, start, end, today),
        )

    # Log

    async def log(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, day: date, draft: LogDraft
    ) -> HabitProgress:
        habit = await self._require_habit(workspace_id, habit_id)
        await self.record(habit, day, draft)
        await self._transaction.commit()
        return await self._progress_on(habit, day)

    async def record(self, habit: Habit, day: date, draft: LogDraft) -> None:
        """Record the day without committing, and re-point the habit's reminders."""
        now = self._clock()
        today = today_in(habit.timezone, now)
        if day > today:
            raise InvalidLogError("You can't log a day that hasn't happened yet.")
        if day < habit.start_date or (habit.end_date is not None and day > habit.end_date):
            raise InvalidLogError("That day is outside the habit's dates.")
        existing = (await self._store.logs(habit.workspace_id, [habit.id], day, day)).get(
            habit.id, []
        )
        current = existing[0] if existing else None
        target = current.target if current else habit.daily_target
        if draft.status == "skipped":
            value, skipped = 0.0, True
        elif draft.status == "completed":
            value, skipped = (draft.value if draft.value is not None else target), False
        else:
            if draft.value is None:
                raise InvalidLogError("Progress needs a value.")
            value, skipped = draft.value, False
        if habit.kind == "boolean" and not skipped:
            value = 1.0 if draft.status == "completed" or value >= 1 else 0.0
        if not 0 <= value <= MAX_LOG_VALUE:
            raise InvalidLogError(f"The value must be between 0 and {MAX_LOG_VALUE:,}.")
        await self._store.put_log(
            HabitLog(
                id=current.id if current else uuid.uuid4(),
                workspace_id=habit.workspace_id,
                habit_id=habit.id,
                day=day,
                value=value,
                target=target,
                skipped=skipped,
                note=draft.note,
                logged_at=now,
                created_at=current.created_at if current else now,
                updated_at=now,
            )
        )
        await self.reminders.sync_habit(habit)

    async def unlog(self, workspace_id: uuid.UUID, habit_id: uuid.UUID, day: date) -> HabitProgress:
        """Undo the day's entry. Idempotent."""
        habit = await self._require_habit(workspace_id, habit_id)
        await self._store.delete_log(workspace_id, habit_id, day)
        await self.reminders.sync_habit(habit)
        await self._transaction.commit()
        return await self._progress_on(habit, day)

    # Reminders, tasks, and notes

    async def set_reminders(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, times: Sequence[ReminderTime]
    ) -> HabitDetail:
        habit = await self._require_habit(workspace_id, habit_id)
        check_reminder_times(times)
        await self._store.set_reminder_times(workspace_id, times, habit_id=habit_id)
        await self.reminders.sync_habit(habit)
        await self._transaction.commit()
        return await self.get(workspace_id, habit_id)

    async def link_task(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        await self._require_habit(workspace_id, habit_id)
        if not await self._store.task_exists(workspace_id, task_id):
            raise LinkedItemNotFoundError("task")
        await self._store.link_task(workspace_id, habit_id, task_id)
        await self._transaction.commit()

    async def unlink_task(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        await self._require_habit(workspace_id, habit_id)
        await self._store.unlink_task(workspace_id, habit_id, task_id)
        await self._transaction.commit()

    async def link_note(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        await self._require_habit(workspace_id, habit_id)
        if not await self._store.note_exists(workspace_id, note_id):
            raise LinkedItemNotFoundError("note")
        await self._store.link_note(workspace_id, habit_id, note_id)
        await self._transaction.commit()

    async def unlink_note(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        await self._require_habit(workspace_id, habit_id)
        await self._store.unlink_note(workspace_id, habit_id, note_id)
        await self._transaction.commit()

    # Analytics and the calendar

    async def analytics(
        self,
        workspace_id: uuid.UUID,
        start: date,
        end: date,
        timezone: str,
        category_id: uuid.UUID | None = None,
    ) -> HabitAnalytics:
        _check_range(start, end)
        habits = await self._store.habits(workspace_id)
        if category_id is not None:
            habits = [h for h in habits if h.category_id == category_id]
        logs = await self._store.logs(workspace_id, [h.id for h in habits])
        categories = await self.categories(workspace_id)
        today = today_in(timezone, self._clock())
        return analytics(habits, logs, categories, start, end, today)

    async def calendar(
        self, workspace_id: uuid.UUID, start: date, end: date, timezone: str
    ) -> list[CalendarEntry]:
        """Habits and routines with a time of day on local dates `[start, end)` in `timezone`."""
        _check_range(start, end)
        zone = ZoneInfo(timezone)
        window = (
            datetime.combine(start, datetime.min.time(), tzinfo=zone),
            datetime.combine(end, datetime.min.time(), tzinfo=zone),
        )
        habits = [h for h in await self._store.habits(workspace_id) if h.time_of_day is not None]
        routines = [
            r for r in await self._store.routines(workspace_id, ("active",)) if r.time_of_day
        ]
        logs = await self._store.logs(
            workspace_id, [h.id for h in habits], start - timedelta(days=1), end
        )
        finished = await self._store.finished_days(
            workspace_id, [r.id for r in routines], start - timedelta(days=1), end
        )
        return calendar_entries(habits, logs, routines, finished, window, self._clock())

    # Helpers

    async def _progress_on(self, habit: Habit, day: date) -> HabitProgress:
        logs = (await self._store.logs(habit.workspace_id, [habit.id])).get(habit.id, [])
        today = today_in(habit.timezone, self._clock())
        return progress(habit, logs, day, max(day, today))

    async def _require_habit(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> Habit:
        habit = await self._store.get_habit(workspace_id, habit_id)
        if habit is None:
            raise HabitNotFoundError
        return habit

    async def _require_category(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID | None
    ) -> None:
        if category_id is None:
            return
        if not any(c.id == category_id for c in await self._store.categories(workspace_id)):
            raise HabitCategoryNotFoundError


def _check_range(start: date, end: date) -> None:
    if end < start:
        raise InvalidLogError("The range must end after it starts.")
    if (end - start).days > MAX_RANGE_DAYS:
        raise InvalidLogError(f"A range can span at most {MAX_RANGE_DAYS} days.")


def _check_habit(habit: Habit) -> None:
    if habit.kind == "boolean" and habit.target is not None:
        raise InvalidHabitError("A yes-or-no habit has no target.")
    if habit.kind != "boolean" and (habit.target is None or habit.target <= 0):
        raise InvalidHabitError("Numeric and duration habits need a target above zero.")
    if habit.end_date is not None and habit.end_date < habit.start_date:
        raise InvalidHabitError("The end date must be on or after the start date.")


def _with_schedule(
    habit: Habit, schedule: HabitSchedule, effective: date
) -> tuple[ScheduleVersion, ...]:
    """The versions with `schedule` from `effective` on. A change on or before the start date
    replaces the whole history; otherwise earlier days keep their versions."""
    if habit.schedule == schedule:
        return habit.versions
    if effective <= habit.start_date:
        return (ScheduleVersion(habit.start_date, schedule),)
    kept = tuple(v for v in habit.versions if v.effective_from < effective)
    return (*kept, ScheduleVersion(effective, schedule))


def _with_status(habit: Habit, status: HabitStatus, today: date) -> tuple[Pause, ...]:
    """Pausing or archiving opens a pause from today; resuming or restoring closes it, so
    today counts again. A pause opened and closed on the same day leaves nothing."""
    pauses = list(habit.pauses)
    open_pause = next((p for p in pauses if p.end is None), None)
    if status == "active":
        if open_pause is not None:
            pauses.remove(open_pause)
            if today > open_pause.start:
                pauses.append(Pause(open_pause.start, today))
    elif open_pause is None:
        pauses.append(Pause(today, None))
    return tuple(sorted(pauses, key=lambda p: p.start))
