"""When a habit is due: its schedule, the history of schedule versions, and the habit's active
days.

A habit's schedule is a small versioned document (`SCHEDULE_VERSION`), never expanded into rows.
Changing it adds a new version effective from a date; earlier days keep the version that applied
to them, so history never changes after the fact.

Schedule types:

- `daily`: every `every` days (1 is every day), counted from the version's first day.
- `weekdays`: on the listed weekdays.
- `monthly`: on the listed days of the month. A day a month lacks (29th to 31st) falls on its last
  day; two listed days that land on the same date (30 and 31 in February) count once.
- `weekly_target`: any `times_per_week` days in each week. Weeks run Monday to Sunday (ISO
  weeks) for every habit, whatever the calendar's display preference.

All dates are local dates in the habit's time zone; nothing here converts time zones.
"""

import calendar
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Final, Literal, cast, get_args

from orbit_api.services.reminders.recurrence import WEEKDAYS, Weekday

ScheduleType = Literal["daily", "weekdays", "monthly", "weekly_target"]
SCHEDULE_TYPES: Final[tuple[ScheduleType, ...]] = get_args(ScheduleType)
SCHEDULE_VERSION: Final = 1
MAX_EVERY: Final = 365

_TYPE_NAMES: Final[dict[object, ScheduleType]] = {name: name for name in SCHEDULE_TYPES}
_WEEKDAY_NAMES: Final[dict[object, Weekday]] = {name: name for name in WEEKDAYS}


class InvalidScheduleError(ValueError):
    """A schedule that can't produce due days, or a stored one this version can't read."""


@dataclass(frozen=True, slots=True)
class HabitSchedule:
    type: ScheduleType
    # `daily` only: every this many days.
    every: int = 1
    # `weekdays` only.
    weekdays: frozenset[Weekday] = frozenset()
    # `monthly` only: days of the month, 1 to 31.
    month_days: frozenset[int] = frozenset()
    # `weekly_target` only: 1 to 7.
    times_per_week: int = 0

    def __post_init__(self) -> None:
        kind = self.type
        if not 1 <= self.every <= MAX_EVERY or (kind != "daily" and self.every != 1):
            raise InvalidScheduleError(f"`every` must be 1 to {MAX_EVERY}, for daily schedules.")
        if (kind == "weekdays") != bool(self.weekdays):
            raise InvalidScheduleError("Weekday schedules need weekdays; others take none.")
        if (kind == "monthly") != bool(self.month_days):
            raise InvalidScheduleError("Monthly schedules need days of the month; others none.")
        if any(not 1 <= day <= 31 for day in self.month_days):
            raise InvalidScheduleError("Days of the month must be 1 to 31.")
        if kind == "weekly_target":
            if not 1 <= self.times_per_week <= 7:
                raise InvalidScheduleError("A weekly target must be 1 to 7 times.")
        elif self.times_per_week:
            raise InvalidScheduleError("Only weekly targets take `times_per_week`.")

    @property
    def flexible(self) -> bool:
        """Whether it has a weekly target rather than fixed due days."""
        return self.type == "weekly_target"


@dataclass(frozen=True, slots=True)
class ScheduleVersion:
    """The schedule in effect from `effective_from` until the next version's first day."""

    effective_from: date
    schedule: HabitSchedule


@dataclass(frozen=True, slots=True)
class Pause:
    """Days `[start, end)` the habit wasn't tracked: paused or archived. `end` is `None` while it
    still is."""

    start: date
    end: date | None

    def covers(self, day: date) -> bool:
        return self.start <= day and (self.end is None or day < self.end)


@dataclass(frozen=True, slots=True)
class Timeline:
    """Everything that decides whether a habit was due on a day."""

    start_date: date
    end_date: date | None
    versions: Sequence[ScheduleVersion]
    pauses: Sequence[Pause] = ()

    def __post_init__(self) -> None:
        if not self.versions:
            raise InvalidScheduleError("A habit needs a schedule.")

    def tracked(self, day: date) -> bool:
        """Within the habit's dates and not paused or archived."""
        if day < self.start_date or (self.end_date is not None and day > self.end_date):
            return False
        return not any(pause.covers(day) for pause in self.pauses)

    def version_on(self, day: date) -> ScheduleVersion:
        """The version in effect on `day` (the first one, for days before any version)."""
        current = self.versions[0]
        for version in self.versions:
            if version.effective_from <= day:
                current = version
            else:
                break
        return current

    @property
    def current(self) -> HabitSchedule:
        return self.versions[-1].schedule


def week_start(day: date) -> date:
    """The Monday of `day`'s week."""
    return day - timedelta(days=day.weekday())


def month_dates(year: int, month: int, days: frozenset[int]) -> frozenset[int]:
    """The listed days of the month as they fall in this month, without duplicates."""
    last = calendar.monthrange(year, month)[1]
    return frozenset(min(day, last) for day in days)


def is_due(version: ScheduleVersion, day: date) -> bool:
    """Whether a fixed-day schedule falls on `day`. Weekly targets have no fixed days."""
    schedule = version.schedule
    match schedule.type:
        case "daily":
            return (day - version.effective_from).days % schedule.every == 0
        case "weekdays":
            return WEEKDAYS[day.weekday()] in schedule.weekdays
        case "monthly":
            return day.day in month_dates(day.year, day.month, schedule.month_days)
        case "weekly_target":
            return False


def days(start: date, end: date) -> Iterator[date]:
    """Every date from `start` to `end`, inclusive."""
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def due_on(timeline: Timeline, day: date) -> bool:
    """Whether the habit was due on `day`: tracked, and a fixed-day schedule falls on it."""
    return timeline.tracked(day) and is_due(timeline.version_on(day), day)


def schedule_to_json(schedule: HabitSchedule) -> dict[str, Any]:
    """The stored form. Collections are sorted so equal schedules store identically."""
    return {
        "version": SCHEDULE_VERSION,
        "type": schedule.type,
        "every": schedule.every,
        "weekdays": [day for day in WEEKDAYS if day in schedule.weekdays],
        "month_days": sorted(schedule.month_days),
        "times_per_week": schedule.times_per_week,
    }


def schedule_from_json(value: object) -> HabitSchedule:
    """Read a stored schedule, validating it rather than trusting the database."""
    if not isinstance(value, dict):
        raise InvalidScheduleError("Stored schedule is not an object.")
    stored = cast(dict[str, object], value)
    if stored.get("version") != SCHEDULE_VERSION:
        raise InvalidScheduleError("Unsupported schedule version.")
    kind = _TYPE_NAMES.get(stored.get("type"))
    every, times = stored.get("every", 1), stored.get("times_per_week", 0)
    weekdays, month_days = stored.get("weekdays", []), stored.get("month_days", [])
    if (
        kind is None
        or not isinstance(every, int)
        or not isinstance(times, int)
        or not isinstance(weekdays, list)
        or not isinstance(month_days, list)
    ):
        raise InvalidScheduleError("Stored schedule is malformed.")
    parsed_weekdays: set[Weekday] = set()
    for item in cast(list[object], weekdays):
        weekday = _WEEKDAY_NAMES.get(item)
        if weekday is None:
            raise InvalidScheduleError("Stored schedule has an unknown weekday.")
        parsed_weekdays.add(weekday)
    parsed_days: set[int] = set()
    for item in cast(list[object], month_days):
        if not isinstance(item, int):
            raise InvalidScheduleError("Stored schedule has an invalid day of the month.")
        parsed_days.add(item)
    return HabitSchedule(
        type=kind,
        every=every,
        weekdays=frozenset(parsed_weekdays),
        month_days=frozenset(parsed_days),
        times_per_week=times,
    )
