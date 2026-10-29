"""When a reminder fires: a local date and time in an IANA time zone, optionally repeating.

Schedules are kept in local wall-clock terms and converted to UTC one occurrence at a time, so a
reminder set for 09:00 stays at 09:00 local time on both sides of a daylight-saving change.

Edge cases, decided deliberately:

- **Times skipped by a DST change** (02:30 on the night clocks jump from 02:00 to 03:00) fire at
  the instant that wall-clock time would have been without the jump: 03:30 local time.
- **Times that happen twice** (01:30 on the night clocks fall back) fire once, at the first.
- **Monthly reminders on a day a month lacks** (the 29th to 31st) fire on that month's last day,
  and return to the original day in longer months: Jan 31, Feb 28 (29 in leap years), Mar 31.
- **Weekly reminders** repeat on the listed weekdays, starting from the start date.

Stored recurrence is versioned (`RECURRENCE_VERSION`), so the format can change without
misreading old rows. Nothing here evaluates user-supplied expressions.
"""

import calendar
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from functools import cache
from typing import Any, Final, Literal, cast, get_args
from zoneinfo import ZoneInfo, available_timezones

Frequency = Literal["daily", "weekly", "monthly"]
# In `date.weekday()` order: Monday is 0.
Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

FREQUENCIES: Final[tuple[Frequency, ...]] = get_args(Frequency)
WEEKDAYS: Final[tuple[Weekday, ...]] = get_args(Weekday)
RECURRENCE_VERSION: Final = 1

_FREQUENCY_NAMES: Final[dict[object, Frequency]] = {name: name for name in FREQUENCIES}
_WEEKDAY_NAMES: Final[dict[object, Weekday]] = {name: name for name in WEEKDAYS}


class InvalidRecurrenceError(ValueError):
    """A recurrence that cannot produce a schedule, or a stored one this version can't read."""


@dataclass(frozen=True, slots=True)
class Recurrence:
    frequency: Frequency
    # Weekly reminders only, and required for them; empty for other frequencies.
    weekdays: frozenset[Weekday] = frozenset()

    def __post_init__(self) -> None:
        if self.frequency == "weekly" and not self.weekdays:
            raise InvalidRecurrenceError("Weekly recurrence needs at least one weekday.")
        if self.frequency != "weekly" and self.weekdays:
            raise InvalidRecurrenceError("Only weekly recurrence takes weekdays.")


@dataclass(frozen=True, slots=True)
class Schedule:
    # The date of a one-time reminder, or the first possible date of a recurring one.
    start_date: date
    # Local wall-clock time, without a time zone.
    time_of_day: time
    # An IANA time zone name, such as `Europe/Paris`.
    timezone: str
    recurrence: Recurrence | None = None


@cache
def _zone_names() -> frozenset[str]:
    return frozenset(available_timezones())


def is_valid_timezone(name: str) -> bool:
    """Whether `name` is an IANA time zone known to this installation."""
    return name in _zone_names()


def local_to_utc(day: date, time_of_day: time, zone: ZoneInfo) -> datetime:
    """The UTC instant of a local date and time, resolving DST gaps and overlaps as documented
    above. `fold=0` gives exactly those rules (PEP 495)."""
    return datetime.combine(day, time_of_day, tzinfo=zone).astimezone(UTC)


def next_occurrence(schedule: Schedule, after: datetime) -> datetime | None:
    """The schedule's first occurrence strictly after `after`, in UTC, or `None` if there is
    none (a one-time reminder whose time has passed)."""
    zone = ZoneInfo(schedule.timezone)
    recurrence = schedule.recurrence
    if recurrence is None:
        at = local_to_utc(schedule.start_date, schedule.time_of_day, zone)
        return at if at > after else None

    # Start a day early: an occurrence late on the previous local day can still be after
    # `after` once a DST gap moves it forward.
    first = max(schedule.start_date, after.astimezone(zone).date() - timedelta(days=1))
    for day in _days(schedule, recurrence, first):
        at = local_to_utc(day, schedule.time_of_day, zone)
        if at > after:
            return at
    raise AssertionError("A recurring schedule always has a later occurrence.")  # pragma: no cover


def _days(schedule: Schedule, recurrence: Recurrence, first: date) -> Iterator[date]:
    """Every local date the schedule fires on, from `first` onward, in order."""
    match recurrence.frequency:
        case "daily":
            day = first
            while True:
                yield day
                day += timedelta(days=1)
        case "weekly":
            day = first
            while True:
                if WEEKDAYS[day.weekday()] in recurrence.weekdays:
                    yield day
                day += timedelta(days=1)
        case "monthly":
            anchor = schedule.start_date.day
            year, month = first.year, first.month
            while True:
                day = date(year, month, min(anchor, calendar.monthrange(year, month)[1]))
                if day >= first:
                    yield day
                year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def recurrence_to_json(recurrence: Recurrence | None) -> dict[str, Any] | None:
    """The stored form of a recurrence."""
    if recurrence is None:
        return None
    return {
        "version": RECURRENCE_VERSION,
        "frequency": recurrence.frequency,
        # Stored in weekday order so equal recurrences store identically.
        "weekdays": [day for day in WEEKDAYS if day in recurrence.weekdays],
    }


def recurrence_from_json(value: object) -> Recurrence | None:
    """Read a stored recurrence, validating it rather than trusting the database."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise InvalidRecurrenceError("Stored recurrence is not an object.")
    stored = cast(dict[str, object], value)
    if stored.get("version") != RECURRENCE_VERSION:
        raise InvalidRecurrenceError("Unsupported recurrence version.")
    frequency = _FREQUENCY_NAMES.get(stored.get("frequency"))
    weekdays = stored.get("weekdays", [])
    if frequency is None or not isinstance(weekdays, list):
        raise InvalidRecurrenceError("Stored recurrence is malformed.")
    days: set[Weekday] = set()
    for item in cast(list[object], weekdays):
        day = _WEEKDAY_NAMES.get(item)
        if day is None:
            raise InvalidRecurrenceError("Stored recurrence has an unknown weekday.")
        days.add(day)
    return Recurrence(frequency=frequency, weekdays=frozenset(days))
