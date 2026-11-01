"""Day states, periods, streaks, and completion rates, computed from a habit's timeline and log.

Everything is derived on read from stored facts (schedule versions, pauses, and log entries), so
the numbers are always explainable from history and never drift.

**Log entries.** At most one per habit and local date. An entry records a value and the target
that applied when it was logged; it is *completed* when the value reaches that target, *partial*
when it is above zero but below it, or *skipped* when the user excused the day.

**Periods** are what streaks and rates count:

- Fixed-day schedules (`daily`, `weekdays`, `monthly`): one period per due day. It is *met* when
  completed, *skipped* when skipped, *pending* while it is today and not yet met, and *missed*
  otherwise (a partial entry on a past day is missed: progress is shown, but the target wasn't
  reached).
- Weekly targets: one period per week (Monday to Sunday). The week needs
  `min(times_per_week, tracked days in the week that weren't skipped)` completed days, so a week
  shortened by the habit starting, ending, or pausing, or by skipped days, asks for less. A week
  whose requirement drops to zero is skipped. The current week is pending until met.
- When a schedule changes in the middle of a week under a weekly target, each part of the week
  is a period of its own, under its own version.

**Streaks** count consecutive met periods, in the current schedule's unit: days for fixed-day
schedules, weeks for weekly targets. Skipped periods and paused days neither break nor extend a
streak; a missed period ends it; a pending period (today, or this week) doesn't end it yet.
Changing between a fixed-day schedule and a weekly target ends the run, since days and weeks
can't be added up; schedule changes within one unit carry the streak on.

**Rates** are met periods divided by met plus missed ones. Skipped, pending, and paused periods
aren't counted, and days the habit wasn't due never are, so a rate is never lowered by days off.
A range with nothing due has no rate (`None`), not 0%.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from orbit_api.services.habits.schedule import (
    Timeline,
    days,
    is_due,
    week_start,
)

# How one day looks for one habit.
# - `completed`, `partial`, `skipped`: the day has a log entry (on a due or flexible day).
# - `missed`: due, in the past, with no completed entry.
# - `pending`: due today, not completed yet.
# - `open`: a weekly-target day without an entry.
# - `bonus`: completed on a day it wasn't due.
# - `unscheduled`: not due; `paused`: paused or archived; `inactive`: outside the habit's dates.
DayState = Literal[
    "completed",
    "partial",
    "skipped",
    "missed",
    "pending",
    "open",
    "bonus",
    "unscheduled",
    "paused",
    "inactive",
]
PeriodState = Literal["met", "missed", "skipped", "pending"]
PeriodUnit = Literal["day", "week"]


@dataclass(frozen=True, slots=True)
class LogEntry:
    """What was recorded for one day."""

    day: date
    value: float
    target: float
    skipped: bool

    @property
    def completed(self) -> bool:
        return not self.skipped and self.value >= self.target

    @property
    def partial(self) -> bool:
        return not self.skipped and 0 < self.value < self.target


@dataclass(frozen=True, slots=True)
class Period:
    unit: PeriodUnit
    start: date
    end: date
    state: PeriodState
    # Completed days, and the days needed (1 for a day period).
    done: int
    required: int


@dataclass(frozen=True, slots=True)
class Streaks:
    current: int
    longest: int
    unit: PeriodUnit


def day_state(timeline: Timeline, log: Mapping[date, LogEntry], day: date, today: date) -> DayState:
    if day < timeline.start_date or (timeline.end_date is not None and day > timeline.end_date):
        return "inactive"
    entry = log.get(day)
    if not timeline.tracked(day):
        return "paused"
    version = timeline.version_on(day)
    if version.schedule.flexible:
        if entry is None:
            return "open"
        return "skipped" if entry.skipped else "completed" if entry.completed else "partial"
    if not is_due(version, day):
        return "bonus" if entry is not None and entry.completed else "unscheduled"
    if entry is not None:
        if entry.skipped:
            return "skipped"
        if entry.completed:
            return "completed"
        if day >= today and entry.partial:
            return "partial"
    if day >= today:
        return "pending"
    return "partial" if entry is not None and entry.partial else "missed"


def periods(
    timeline: Timeline, log: Mapping[date, LogEntry], start: date, end: date, today: date
) -> list[Period]:
    """The periods that overlap `start` to `end` (inclusive), in order. Nothing after `today`
    counts: the current week is pending, later days are left out."""
    end = min(end, today)
    first = max(start, timeline.start_date)
    if first > end:
        return []
    result: list[Period] = []
    # Fixed-day periods day by day; weekly-target weeks in segments of one version each, from
    # the start of the first week so a week that began before `start` is judged whole.
    day = week_start(first)
    while day <= end:
        version = timeline.version_on(day)
        if version.schedule.flexible:
            segment = _week_segment(timeline, day)
            period = _week_period(timeline, log, segment, version.schedule.times_per_week, today)
            if period is not None and period.start <= end and period.end >= first:
                result.append(period)
            day = segment[1] + timedelta(days=1)
            continue
        if day >= first and timeline.tracked(day) and is_due(version, day):
            result.append(_day_period(log.get(day), day, today))
        day += timedelta(days=1)
    return result


def _week_segment(timeline: Timeline, day: date) -> tuple[date, date]:
    """The run of days from `day` to the end of its week under the same version."""
    version = timeline.version_on(day)
    last = week_start(day) + timedelta(days=6)
    end = day
    while end < last and timeline.version_on(end + timedelta(days=1)) == version:
        end += timedelta(days=1)
    return day, end


def _week_period(
    timeline: Timeline,
    log: Mapping[date, LogEntry],
    segment: tuple[date, date],
    times: int,
    today: date,
) -> Period | None:
    tracked = [d for d in days(*segment) if timeline.tracked(d)]
    if not tracked:
        return None
    entries = [log[d] for d in tracked if d in log]
    available = len(tracked) - sum(1 for e in entries if e.skipped)
    required = min(times, available)
    done = sum(1 for e in entries if e.completed)
    state: PeriodState
    if required == 0:
        state = "skipped"
    elif done >= required:
        state = "met"
    elif tracked[-1] >= today:
        state = "pending"
    else:
        state = "missed"
    return Period("week", tracked[0], tracked[-1], state, done, required)


def _day_period(entry: LogEntry | None, day: date, today: date) -> Period:
    state: PeriodState
    if entry is not None and entry.skipped:
        state = "skipped"
    elif entry is not None and entry.completed:
        state = "met"
    elif day >= today:
        state = "pending"
    else:
        state = "missed"
    return Period("day", day, day, state, 1 if state == "met" else 0, 1)


def streaks(timeline: Timeline, all_periods: Sequence[Period]) -> Streaks:
    """Current and longest streaks over a habit's whole history, in its current unit."""
    unit: PeriodUnit = "week" if timeline.current.flexible else "day"
    run = longest = 0
    for period in all_periods:
        if period.unit != unit:
            run = 0
        elif period.state == "met":
            run += 1
            longest = max(longest, run)
        elif period.state == "missed":
            run = 0
    return Streaks(current=run, longest=longest, unit=unit)


def rate(all_periods: Iterable[Period]) -> float | None:
    """Met over met plus missed, or `None` when nothing was due."""
    met = missed = 0
    for period in all_periods:
        if period.state == "met":
            met += 1
        elif period.state == "missed":
            missed += 1
    return None if met + missed == 0 else met / (met + missed)


def counts(all_periods: Iterable[Period]) -> tuple[int, int]:
    """Met and missed periods."""
    met = missed = 0
    for period in all_periods:
        met += period.state == "met"
        missed += period.state == "missed"
    return met, missed


def within(all_periods: Iterable[Period], start: date, end: date) -> list[Period]:
    """Periods that end between `start` and `end`, inclusive."""
    return [p for p in all_periods if start <= p.end <= end]


def period_on(
    timeline: Timeline, log: Mapping[date, LogEntry], day: date, today: date
) -> Period | None:
    """The period containing `day`: its week (or the part of it under one version) for weekly
    targets, the day itself when due, or `None`. Unlike `periods`, a later day counts too."""
    if not timeline.tracked(day):
        return None
    version = timeline.version_on(day)
    if not version.schedule.flexible:
        return _day_period(log.get(day), day, today) if is_due(version, day) else None
    first = day
    monday = week_start(day)
    while first > monday and timeline.version_on(first - timedelta(days=1)) == version:
        first -= timedelta(days=1)
    return _week_period(
        timeline, log, _week_segment(timeline, first), version.schedule.times_per_week, today
    )
