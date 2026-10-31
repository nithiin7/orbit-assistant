"""Recurring calendar events: RFC 5545 recurrence rules, expanded on demand.

A series stores its rule, never its occurrences. Occurrences are generated for the date range a
view asks for, with `dateutil.rrule` (the standard Python implementation of RFC 5545 RRULEs), in
the event's **local wall-clock time**, then converted to UTC one at a time. So a weekly 09:00
meeting stays at 09:00 local time on both sides of a daylight-saving change.

The rule is a small, validated structure (frequency, interval, weekdays, and an optional count or
end date) stored as versioned JSON. It is translated into an `rrule` here; no user-supplied RRULE
text is ever parsed.

Edge cases, decided deliberately:

- **Monthly on the 29th to 31st** falls on the last day of shorter months and returns to the
  original day in longer ones (Jan 31, Feb 28 or 29, Mar 31, Apr 30), like Orbit's reminders. In
  RFC 5545 terms that is `BYMONTHDAY=28,…,31;BYSETPOS=-1`: the last of those days the month has.
- **Yearly on February 29** falls on February 28 in common years, the same way.
- **Weekly** rules repeat on the listed weekdays, which must include the start date's weekday, so
  the first occurrence is always the event's own start.
- **Times skipped by a DST change** (02:30 on the night clocks jump forward) happen at the
  instant that wall-clock time would have been without the jump (03:30); **repeated times** happen
  once, at the first. These are `local_to_utc`'s rules, shared with reminders.
- **Count** counts every occurrence the rule generates, including ones later skipped or moved by
  an exception (RFC 5545 semantics), so skipping an occurrence never extends the series.
- **Identity:** an occurrence is identified by its event and its *original* local start, the
  RFC 5545 `RECURRENCE-ID`. Exceptions are stored under that key, so expanding the same range
  twice gives the same occurrences, and an occurrence can't appear twice.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any, Final, Literal, cast, get_args

from dateutil.rrule import DAILY, MONTHLY, WEEKLY, YEARLY, rrule, weekday
from dateutil.rrule import FR as _FR
from dateutil.rrule import MO as _MO
from dateutil.rrule import SA as _SA
from dateutil.rrule import SU as _SU
from dateutil.rrule import TH as _TH
from dateutil.rrule import TU as _TU
from dateutil.rrule import WE as _WE

from orbit_api.services.reminders.recurrence import WEEKDAYS, Weekday

EventFrequency = Literal["daily", "weekly", "monthly", "yearly"]
EVENT_FREQUENCIES: Final[tuple[EventFrequency, ...]] = get_args(EventFrequency)
RULE_VERSION: Final = 1
MAX_INTERVAL: Final = 99
MAX_COUNT: Final = 999

_FREQ: Final[dict[EventFrequency, Literal[0, 1, 2, 3]]] = {
    "daily": DAILY,
    "weekly": WEEKLY,
    "monthly": MONTHLY,
    "yearly": YEARLY,
}
_RRULE_WEEKDAYS: Final[dict[Weekday, weekday]] = {
    "mon": _MO,
    "tue": _TU,
    "wed": _WE,
    "thu": _TH,
    "fri": _FR,
    "sat": _SA,
    "sun": _SU,
}
_FREQUENCY_NAMES: Final[dict[object, EventFrequency]] = {name: name for name in EVENT_FREQUENCIES}
_WEEKDAY_NAMES: Final[dict[object, Weekday]] = {name: name for name in WEEKDAYS}


class InvalidEventRecurrenceError(ValueError):
    """A rule that can't describe a series, or a stored one this version can't read."""


@dataclass(frozen=True, slots=True)
class EventRecurrence:
    frequency: EventFrequency
    # Every `interval` days, weeks, months, or years.
    interval: int = 1
    # Weekly rules only, and required for them.
    weekdays: frozenset[Weekday] = frozenset()
    # At most one of these ends the series: after `count` occurrences, or on `until` (a local
    # date, inclusive). Neither: the series never ends.
    count: int | None = None
    until: date | None = None

    def __post_init__(self) -> None:
        if not 1 <= self.interval <= MAX_INTERVAL:
            raise InvalidEventRecurrenceError(f"The interval must be 1 to {MAX_INTERVAL}.")
        if self.frequency == "weekly" and not self.weekdays:
            raise InvalidEventRecurrenceError("Weekly events need at least one weekday.")
        if self.frequency != "weekly" and self.weekdays:
            raise InvalidEventRecurrenceError("Only weekly events take weekdays.")
        if self.count is not None and self.until is not None:
            raise InvalidEventRecurrenceError("End after a number of times or on a date, not both.")
        if self.count is not None and not 1 <= self.count <= MAX_COUNT:
            raise InvalidEventRecurrenceError(f"The count must be 1 to {MAX_COUNT}.")


def validate_rule(rule: EventRecurrence, start: datetime) -> None:
    """Check that `rule` fits a series starting at `start` (local, naive)."""
    if rule.frequency == "weekly" and WEEKDAYS[start.weekday()] not in rule.weekdays:
        raise InvalidEventRecurrenceError(
            "Weekly events must repeat on their start date's weekday."
        )
    if rule.until is not None and rule.until < start.date():
        raise InvalidEventRecurrenceError("The series can't end before it starts.")


def _anchored_days(day: int) -> dict[str, Any]:
    """`BYMONTHDAY` for a day of the month, clamped to the month's last day for the 29th to 31st."""
    if day <= 28:
        return {"bymonthday": day}
    return {"bymonthday": tuple(range(28, day + 1)), "bysetpos": -1}


def build_rrule(rule: EventRecurrence, start: datetime) -> rrule:
    """The `rrule` for a series starting at `start`, a naive local datetime."""
    options: dict[str, Any] = {"dtstart": start, "interval": rule.interval}
    match rule.frequency:
        case "daily":
            pass
        case "weekly":
            options["byweekday"] = tuple(
                _RRULE_WEEKDAYS[day] for day in WEEKDAYS if day in rule.weekdays
            )
            options["wkst"] = _MO
        case "monthly":
            options.update(_anchored_days(start.day))
        case "yearly":
            options["bymonth"] = start.month
            options.update(_anchored_days(start.day))
    if rule.count is not None:
        options["count"] = rule.count
    if rule.until is not None:
        # Inclusive: any occurrence on the end date counts.
        options["until"] = datetime.combine(rule.until, time.max)
    return rrule(_FREQ[rule.frequency], **options)


def starts_between(
    rule: EventRecurrence, start: datetime, after: datetime, before: datetime
) -> list[datetime]:
    """The series' original local starts in `[after, before]`, in order. All values are naive
    local datetimes."""
    if before < after:
        return []
    return list(build_rrule(rule, start).between(after, before, inc=True))


def is_occurrence(rule: EventRecurrence, start: datetime, candidate: datetime) -> bool:
    """Whether `candidate` (local, naive) is one of the series' original starts."""
    return bool(starts_between(rule, start, candidate, candidate))


def last_start(rule: EventRecurrence, start: datetime) -> datetime | None:
    """The series' final original start, or `None` when it never ends."""
    if rule.count is None and rule.until is None:
        return None
    values = list(build_rrule(rule, start))
    return values[-1] if values else None


def count_before(rule: EventRecurrence, start: datetime, before: datetime) -> int:
    """How many original starts come strictly before `before`."""
    return sum(1 for _ in _iter_before(build_rrule(rule, start), before))


def _iter_before(values: rrule, before: datetime) -> Iterator[datetime]:
    for value in values:
        if value >= before:
            return
        yield value


def truncate_before(
    rule: EventRecurrence, start: datetime, split: datetime
) -> EventRecurrence | None:
    """The rule ending just before the occurrence at `split`, or `None` if no occurrence would be
    left (the split is at the first one)."""
    if split <= start:
        return None
    previous = build_rrule(rule, start).before(split)
    if previous is None:
        return None
    return EventRecurrence(
        frequency=rule.frequency,
        interval=rule.interval,
        weekdays=rule.weekdays,
        until=previous.date(),
    )


def remaining_from(rule: EventRecurrence, start: datetime, split: datetime) -> EventRecurrence:
    """The rule for a new series starting at the occurrence `split`, ending where the original
    did: the same end date, or the occurrences the original had left."""
    count = rule.count
    if count is not None:
        count = max(count - count_before(rule, start, split), 1)
    return EventRecurrence(
        frequency=rule.frequency,
        interval=rule.interval,
        weekdays=rule.weekdays,
        count=count,
        until=rule.until,
    )


def rule_to_json(rule: EventRecurrence | None) -> dict[str, Any] | None:
    if rule is None:
        return None
    return {
        "version": RULE_VERSION,
        "frequency": rule.frequency,
        "interval": rule.interval,
        # Weekday order, so equal rules store identically.
        "weekdays": [day for day in WEEKDAYS if day in rule.weekdays],
        "count": rule.count,
        "until": rule.until.isoformat() if rule.until else None,
    }


def rule_from_json(value: object) -> EventRecurrence | None:
    """Read a stored rule, validating it rather than trusting the database."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise InvalidEventRecurrenceError("Stored rule is not an object.")
    stored = cast(dict[str, object], value)
    if stored.get("version") != RULE_VERSION:
        raise InvalidEventRecurrenceError("Unsupported rule version.")
    frequency = _FREQUENCY_NAMES.get(stored.get("frequency"))
    interval = stored.get("interval", 1)
    weekdays = stored.get("weekdays", [])
    count = stored.get("count")
    until = stored.get("until")
    if (
        frequency is None
        or not isinstance(interval, int)
        or not isinstance(weekdays, list)
        or not (count is None or isinstance(count, int))
        or not (until is None or isinstance(until, str))
    ):
        raise InvalidEventRecurrenceError("Stored rule is malformed.")
    days: set[Weekday] = set()
    for item in cast(list[object], weekdays):
        day = _WEEKDAY_NAMES.get(item)
        if day is None:
            raise InvalidEventRecurrenceError("Stored rule has an unknown weekday.")
        days.add(day)
    try:
        end = date.fromisoformat(until) if until else None
    except ValueError:
        raise InvalidEventRecurrenceError("Stored rule has a bad end date.") from None
    return EventRecurrence(
        frequency=frequency, interval=interval, weekdays=frozenset(days), count=count, until=end
    )
