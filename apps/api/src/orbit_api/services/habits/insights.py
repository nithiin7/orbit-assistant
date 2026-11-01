"""What habits and routines add up to: a habit's progress on a day, analytics over a date range,
calendar entries, and what each reminder time should announce next. Pure functions over loaded
data; the rules are in `services.habits.progress` and `services.habits.schedule`."""

import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from orbit_api.services.habits.models import (
    REMINDER_HORIZON_DAYS,
    CalendarEntry,
    CategoryPerformance,
    Habit,
    HabitAnalytics,
    HabitCategory,
    HabitLog,
    HabitPerformance,
    HabitProgress,
    HabitReminder,
    HeatmapDay,
    Routine,
    TrendPoint,
)
from orbit_api.services.habits.progress import (
    LogEntry,
    Period,
    counts,
    day_state,
    period_on,
    periods,
    rate,
    streaks,
    within,
)
from orbit_api.services.habits.schedule import days, is_due, week_start
from orbit_api.services.reminders.managed import ReminderTarget
from orbit_api.services.reminders.recurrence import WEEKDAYS, Schedule, local_to_utc

# How long a habit or routine without a duration lasts on the calendar.
DEFAULT_BLOCK_MINUTES = 15


def today_in(timezone: str, now: datetime) -> date:
    return now.astimezone(ZoneInfo(timezone)).date()


def entries(logs: Iterable[HabitLog]) -> dict[date, LogEntry]:
    return {log.day: log.entry for log in logs}


def progress(habit: Habit, logs: Sequence[HabitLog], day: date, today: date) -> HabitProgress:
    """The habit on `day` (often `today`), with streaks and rates over its history to `today`."""
    timeline = habit.timeline
    log = entries(logs)
    history = periods(timeline, log, habit.start_date, today, today)
    streak = streaks(timeline, history)
    period = period_on(timeline, log, day, today)
    if timeline.version_on(day).schedule.flexible:
        week_done, week_due = (period.done, period.required) if period else (0, 0)
    else:
        week_done = week_due = 0
        monday = week_start(day)
        for each in days(monday, monday + timedelta(days=6)):
            version = timeline.version_on(each)
            if timeline.tracked(each) and not version.schedule.flexible and is_due(version, each):
                week_due += 1
                entry = log.get(each)
                week_done += entry is not None and entry.completed
    return HabitProgress(
        habit=habit,
        day=day,
        state=day_state(timeline, log, day, today),
        log=next((item for item in logs if item.day == day), None),
        period=period,
        week_done=week_done,
        week_due=week_due,
        current_streak=streak.current,
        longest_streak=streak.longest,
        streak_unit=streak.unit,
        total_completions=sum(1 for item in logs if item.entry.completed),
        completion_rate=rate(history),
        weekly_rate=rate(within(history, today - timedelta(days=6), today)),
        monthly_rate=rate(within(history, today - timedelta(days=29), today)),
    )


def heatmap(
    habits: Sequence[Habit], logs: Mapping[uuid.UUID, Sequence[HabitLog]], start: date, end: date
) -> list[HeatmapDay]:
    """Per day: fixed-day occurrences due and completed, and other completions."""
    due: dict[date, int] = defaultdict(int)
    done: dict[date, int] = defaultdict(int)
    extra: dict[date, int] = defaultdict(int)
    for habit in habits:
        timeline = habit.timeline
        log = entries(logs.get(habit.id, ()))
        for day in days(max(start, habit.start_date), end):
            if not timeline.tracked(day):
                continue
            version = timeline.version_on(day)
            entry = log.get(day)
            completed = entry is not None and entry.completed
            if not version.schedule.flexible and is_due(version, day):
                due[day] += 1
                done[day] += completed
            elif completed:
                extra[day] += 1
    return [HeatmapDay(day, due[day], done[day], extra[day]) for day in days(start, end)]


def analytics(
    habits: Sequence[Habit],
    logs: Mapping[uuid.UUID, Sequence[HabitLog]],
    categories: Sequence[HabitCategory],
    start: date,
    end: date,
    today: date,
) -> HabitAnalytics:
    """Habit analytics for `start` to `end`, counted up to `today`."""
    last = min(end, today)
    weekly: dict[date, list[int]] = defaultdict(lambda: [0, 0])
    monthly: dict[date, list[int]] = defaultdict(lambda: [0, 0])
    by_category: dict[uuid.UUID | None, list[int]] = defaultdict(lambda: [0, 0])
    performance: list[HabitPerformance] = []
    middle = start + (last - start) / 2 if last >= start else start
    for habit in habits:
        timeline = habit.timeline
        habit_logs = logs.get(habit.id, ())
        log = entries(habit_logs)
        in_range = periods(timeline, log, start, last, today)
        if not in_range and not any(start <= item.day <= last for item in habit_logs):
            continue
        for period in in_range:
            for bucket in (weekly[week_start(period.end)], monthly[period.end.replace(day=1)]):
                bucket[0] += period.state == "met"
                bucket[1] += period.state == "missed"
        met, missed = counts(in_range)
        by_category[habit.category_id][0] += met
        by_category[habit.category_id][1] += missed
        streak = streaks(timeline, periods(timeline, log, habit.start_date, today, today))
        performance.append(
            HabitPerformance(
                habit=habit,
                met=met,
                missed=missed,
                completions=sum(
                    1 for item in habit_logs if start <= item.day <= last and item.entry.completed
                ),
                current_streak=streak.current,
                longest_streak=streak.longest,
                streak_unit=streak.unit,
                trend=_trend(in_range, middle),
            )
        )
    category_index = {category.id: category for category in categories}
    return HabitAnalytics(
        start=start,
        end=end,
        heatmap=heatmap(habits, logs, start, last) if last >= start else [],
        weekly=_points(weekly, lambda first: first + timedelta(days=6)),
        monthly=_points(monthly, _month_end),
        habits=performance,
        categories=[
            CategoryPerformance(category_index.get(key) if key else None, met, missed)
            for key, (met, missed) in by_category.items()
        ],
    )


def _trend(in_range: Sequence[Period], middle: date) -> float | None:
    first = rate(p for p in in_range if p.end < middle)
    second = rate(p for p in in_range if p.end >= middle)
    return None if first is None or second is None else second - first


def _month_end(first: date) -> date:
    following = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    return following - timedelta(days=1)


def _points(buckets: Mapping[date, list[int]], end_of: Callable[[date], date]) -> list[TrendPoint]:
    return [
        TrendPoint(start=first, end=end_of(first), met=met, missed=missed)
        for first, (met, missed) in sorted(buckets.items())
    ]


def calendar_entries(
    habits: Sequence[Habit],
    logs: Mapping[uuid.UUID, Sequence[HabitLog]],
    routines: Sequence[Routine],
    finished: Mapping[uuid.UUID, set[date]],
    window: tuple[datetime, datetime],
    now: datetime,
) -> list[CalendarEntry]:
    """Habits and routines with a time of day, on the days they're due, whose start falls in
    `window` (UTC instants). Weekly targets have no fixed days, so they aren't shown."""
    begin, finish = window
    result: list[CalendarEntry] = []
    for habit in habits:
        if habit.time_of_day is None or habit.status == "archived":
            continue
        zone = ZoneInfo(habit.timezone)
        timeline = habit.timeline
        log = entries(logs.get(habit.id, ()))
        today = today_in(habit.timezone, now)
        minutes = int(habit.target or 0) if habit.kind == "duration" else 0
        for day in _local_days(window, zone):
            version = timeline.version_on(day)
            if not timeline.tracked(day) or version.schedule.flexible or not is_due(version, day):
                continue
            start_at = local_to_utc(day, habit.time_of_day, zone)
            if begin <= start_at < finish:
                result.append(
                    CalendarEntry(
                        kind="habit",
                        id=habit.id,
                        title=habit.name,
                        color=habit.color,
                        icon=habit.icon,
                        day=day,
                        start_at=start_at,
                        end_at=start_at + timedelta(minutes=minutes or DEFAULT_BLOCK_MINUTES),
                        state=day_state(timeline, log, day, today),
                    )
                )
    for routine in routines:
        if routine.time_of_day is None or routine.status != "active":
            continue
        zone = ZoneInfo(routine.timezone)
        for day in _local_days(window, zone):
            if routine.weekdays and WEEKDAYS[day.weekday()] not in routine.weekdays:
                continue
            start_at = local_to_utc(day, routine.time_of_day, zone)
            if begin <= start_at < finish:
                length = routine.estimated_minutes or DEFAULT_BLOCK_MINUTES
                result.append(
                    CalendarEntry(
                        kind="routine",
                        id=routine.id,
                        title=routine.name,
                        color=routine.color,
                        icon=routine.icon,
                        day=day,
                        start_at=start_at,
                        end_at=start_at + timedelta(minutes=length),
                        state="completed" if day in finished.get(routine.id, set()) else None,
                    )
                )
    result.sort(key=lambda entry: (entry.start_at, entry.title))
    return result


def _local_days(window: tuple[datetime, datetime], zone: ZoneInfo) -> Iterable[date]:
    """Local dates in `zone` that can hold an instant in `window`, with a day's margin."""
    first = window[0].astimezone(zone).date() - timedelta(days=1)
    last = window[1].astimezone(zone).date() + timedelta(days=1)
    return days(first, last)


def _reminder_at(day: date, at: time, zone: ZoneInfo) -> datetime:
    return local_to_utc(day, at, zone)


def _target(at: datetime, title: str, description: str) -> ReminderTarget:
    at = at.astimezone(UTC)
    return ReminderTarget(
        schedule=Schedule(
            start_date=at.date(),
            time_of_day=at.time().replace(second=0, microsecond=0),
            timezone="UTC",
        ),
        title=title,
        description=description,
    )


def describe_goal(habit: Habit) -> str:
    match habit.kind:
        case "boolean":
            goal = "Time for your habit."
        case "numeric":
            goal = f"Today's goal: {habit.daily_target:g} {habit.unit}".rstrip() + "."
        case "duration":
            goal = f"Today's goal: {habit.daily_target:g} minutes."
    schedule = habit.schedule
    if schedule.flexible:
        goal += f" Aim: {schedule.times_per_week} times this week."
    return goal


def habit_reminder_target(
    habit: Habit, reminder: HabitReminder, logs: Sequence[HabitLog], now: datetime
) -> ReminderTarget | None:
    """The next due day the reminder applies to that isn't already done or skipped, at its
    time, still ahead of `now`; `None` while the habit is paused or archived. Weekly targets
    remind on each remaining day of a week until the week's target is met."""
    if habit.status != "active":
        return None
    zone = ZoneInfo(habit.timezone)
    today = today_in(habit.timezone, now)
    timeline = habit.timeline
    log = entries(logs)
    first = max(today, timeline.start_date)
    for day in days(first, first + timedelta(days=REMINDER_HORIZON_DAYS)):
        if timeline.end_date is not None and day > timeline.end_date:
            return None
        if reminder.weekdays and WEEKDAYS[day.weekday()] not in reminder.weekdays:
            continue
        entry = log.get(day)
        # Partial progress still needs the reminder; a finished or excused day doesn't.
        if not timeline.tracked(day) or (entry and (entry.completed or entry.skipped)):
            continue
        version = timeline.version_on(day)
        if version.schedule.flexible:
            period = period_on(timeline, log, day, today)
            if period is None or period.state in ("met", "skipped"):
                continue
        elif not is_due(version, day):
            continue
        at = _reminder_at(day, reminder.time_of_day, zone)
        if at > now:
            return _target(at, habit.name, describe_goal(habit))
    return None


def routine_reminder_target(
    routine: Routine, reminder: HabitReminder, finished: set[date], now: datetime
) -> ReminderTarget | None:
    """The next day the routine applies to, without a finished session, at the reminder's
    time; `None` while it is paused or archived."""
    if routine.status != "active":
        return None
    zone = ZoneInfo(routine.timezone)
    today = today_in(routine.timezone, now)
    steps = len(routine.steps)
    description = f"{steps} step{'s' if steps != 1 else ''}"
    if routine.estimated_minutes:
        description += f", about {routine.estimated_minutes} minutes"
    for day in days(today, today + timedelta(days=14)):
        weekday = WEEKDAYS[day.weekday()]
        if routine.weekdays and weekday not in routine.weekdays:
            continue
        if reminder.weekdays and weekday not in reminder.weekdays:
            continue
        if day in finished:
            continue
        at = _reminder_at(day, reminder.time_of_day, zone)
        if at > now:
            return _target(at, routine.name, description + ".")
    return None
