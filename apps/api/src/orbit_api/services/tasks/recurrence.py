"""When a repeating task comes due next.

A repeating task is one open task at a time. Completing it creates the next occurrence, so missed
occurrences never pile up:

- The next due date is the first one in the series after both the task's due date and today:
  finishing early doesn't bring the next one forward, and finishing late skips what was missed.
- Dates follow the series' anchor, its first due date, so a monthly task on the 31st falls on the
  last day of shorter months and returns to the 31st afterwards.
"""

from datetime import date, datetime, time
from typing import Any, Final, cast, get_args

from orbit_api.services.calendar.recurrence import EventRecurrence, build_rrule
from orbit_api.services.reminders.recurrence import WEEKDAYS
from orbit_api.services.tasks.models import (
    MAX_TASK_REPEAT_INTERVAL,
    InvalidTaskRecurrenceError,
    TaskRecurrence,
    TaskRepeat,
    TaskRepeatFrequency,
)

RECURRENCE_VERSION: Final = 1

_FREQUENCY_NAMES: Final[dict[object, TaskRepeatFrequency]] = {
    name: name for name in get_args(TaskRepeatFrequency)
}


def next_due_date(recurrence: TaskRecurrence, due_date: date, today: date) -> date:
    """The series' first date after both `due_date` and `today`."""
    anchor = recurrence.anchor
    repeat = recurrence.repeat
    rule = EventRecurrence(
        frequency=repeat.frequency,
        interval=repeat.interval,
        weekdays=(
            frozenset({WEEKDAYS[anchor.weekday()]}) if repeat.frequency == "weekly" else frozenset()
        ),
    )
    start = datetime.combine(anchor, time.min)
    following = build_rrule(rule, start).after(datetime.combine(max(due_date, today), time.min))
    if following is None:
        raise InvalidTaskRecurrenceError("This task has no later date to repeat on.")
    return following.date()


def recurrence_to_json(recurrence: TaskRecurrence | None) -> dict[str, Any] | None:
    """The stored form of a recurrence."""
    if recurrence is None:
        return None
    return {
        "version": RECURRENCE_VERSION,
        "frequency": recurrence.repeat.frequency,
        "interval": recurrence.repeat.interval,
        "anchor": recurrence.anchor.isoformat(),
    }


def recurrence_from_json(value: object) -> TaskRecurrence | None:
    """Read a stored recurrence, validating it rather than trusting the database."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise InvalidTaskRecurrenceError("Stored recurrence is not an object.")
    stored = cast(dict[str, object], value)
    if stored.get("version") != RECURRENCE_VERSION:
        raise InvalidTaskRecurrenceError("Unsupported recurrence version.")
    frequency = _FREQUENCY_NAMES.get(stored.get("frequency"))
    interval = stored.get("interval")
    anchor = stored.get("anchor")
    if (
        frequency is None
        or not isinstance(interval, int)
        or not 1 <= interval <= MAX_TASK_REPEAT_INTERVAL
        or not isinstance(anchor, str)
    ):
        raise InvalidTaskRecurrenceError("Stored recurrence is malformed.")
    try:
        start = date.fromisoformat(anchor)
    except ValueError:
        raise InvalidTaskRecurrenceError("Stored recurrence has a bad anchor.") from None
    return TaskRecurrence(TaskRepeat(frequency=frequency, interval=interval), anchor=start)
