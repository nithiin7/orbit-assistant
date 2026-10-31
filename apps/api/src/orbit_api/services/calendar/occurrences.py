"""Turning events and their exceptions into the occurrences a date range contains. Pure.

Each occurrence is materialized from its series' rule and, if one exists, the exception stored
under its original start. An exception can move an occurrence anywhere, including into a range
its original start is far from, so moved occurrences are found from the exceptions as well as
from the rule. Either way an occurrence is produced once, keyed by its original start.
"""

from collections.abc import Iterable, Mapping
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from orbit_api.services.calendar.models import (
    CalendarEvent,
    EventException,
    EventOccurrence,
)
from orbit_api.services.calendar.recurrence import is_occurrence, starts_between
from orbit_api.services.reminders.recurrence import local_to_utc

# Expansion looks this far beyond a window on each side, so occurrences whose local date differs
# from their UTC date (up to 14 hours) and DST-shifted ones are never missed. Results are then
# filtered exactly.
_MARGIN = timedelta(days=1)


def to_utc(local: datetime, zone: ZoneInfo) -> datetime:
    """A naive local datetime as a UTC instant, with Orbit's DST rules (see `local_to_utc`)."""
    return local_to_utc(local.date(), local.time(), zone)


def to_local(instant: datetime, zone: ZoneInfo) -> datetime:
    """A UTC instant as a naive local datetime on `zone`'s wall clock."""
    return instant.astimezone(zone).replace(tzinfo=None)


def materialize(
    event: CalendarEvent, original_start: datetime, exception: EventException | None
) -> EventOccurrence | None:
    """The occurrence at `original_start`, or `None` if it was skipped."""
    if exception is not None and exception.kind == "skipped":
        return None
    zone = ZoneInfo(event.timezone)
    duration = event.end - event.start
    start = original_start
    end = original_start + duration
    title, description, location = event.title, event.description, event.location
    category_id, status = event.category_id, event.status
    modified = False
    if exception is not None:
        modified = True
        start = exception.start if exception.start is not None else start
        end = exception.end if exception.end is not None else end
        title = exception.title if exception.title is not None else title
        description = exception.description if exception.description is not None else description
        location = exception.location if exception.location is not None else location
        category_id = exception.category_id if exception.category_id is not None else category_id
        # A cancelled series cancels every occurrence; otherwise an occurrence may be cancelled.
        if event.status == "confirmed" and exception.status is not None:
            status = exception.status
    return EventOccurrence(
        event=event,
        original_start=original_start,
        title=title,
        description=description,
        location=location,
        category_id=category_id,
        status=status,
        start=start,
        end=end,
        start_at=to_utc(start, zone),
        end_at=to_utc(end, zone),
        modified=modified,
    )


def overlaps(occurrence: EventOccurrence, start: datetime, end: datetime) -> bool:
    """Whether the occurrence touches `[start, end)`. A zero-length occurrence counts where it
    starts."""
    if occurrence.start_at >= end:
        return False
    return occurrence.end_at > start or occurrence.start_at >= start


def expand(
    event: CalendarEvent,
    exceptions: Mapping[datetime, EventException],
    start: datetime,
    end: datetime,
) -> list[EventOccurrence]:
    """The event's occurrences that overlap `[start, end)` (UTC instants), in order."""
    zone = ZoneInfo(event.timezone)
    rule = event.recurrence
    if rule is None:
        originals: Iterable[datetime] = [event.start]
    else:
        duration = event.end - event.start
        originals = starts_between(
            rule,
            event.start,
            to_local(start, zone) - duration - _MARGIN,
            to_local(end, zone) + _MARGIN,
        )

    found: dict[datetime, EventOccurrence] = {}
    for original in originals:
        occurrence = materialize(event, original, exceptions.get(original))
        if occurrence is not None and overlaps(occurrence, start, end):
            found[original] = occurrence
    # Occurrences an exception moved into the window from outside it.
    for original, exception in exceptions.items():
        if original in found or exception.kind != "modified" or exception.start is None:
            continue
        if rule is None or not is_occurrence(rule, event.start, original):
            continue  # An exception the rule no longer produces is ignored.
        occurrence = materialize(event, original, exception)
        if occurrence is not None and overlaps(occurrence, start, end):
            found[original] = occurrence
    return sorted(found.values(), key=occurrence_order)


def occurrence_order(occurrence: EventOccurrence) -> tuple[datetime, bool, str, str]:
    """All-day first within an instant, then title, then a stable key."""
    return (
        occurrence.start_at,
        not occurrence.event.all_day,
        occurrence.title.casefold(),
        occurrence_key(occurrence),
    )


def occurrence_key(occurrence: EventOccurrence) -> str:
    """A stable, unique identity: the event and the occurrence's original local start."""
    return f"{occurrence.event.id}:{occurrence.original_start.isoformat(timespec='minutes')}"


def local_dates(occurrence: EventOccurrence) -> tuple[date, date]:
    """An all-day occurrence's first day and the day after its last (exclusive)."""
    last = (
        occurrence.end - timedelta(microseconds=1)
        if occurrence.end > occurrence.start
        else occurrence.start
    )
    return occurrence.start.date(), last.date() + timedelta(days=1)


def window_instants(start: date, end: date, timezone: str) -> tuple[datetime, datetime]:
    """The UTC instants bounding local dates `[start, end)` in `timezone`."""
    zone = ZoneInfo(timezone)
    return (
        local_to_utc(start, datetime.min.time(), zone),
        local_to_utc(end, datetime.min.time(), zone),
    )


def in_date_window(occurrence: EventOccurrence, start: date, end: date) -> bool:
    """Whether an all-day occurrence covers any of the dates `[start, end)`. All-day events are
    days on the calendar, not instants: they show on their dates in any viewer's time zone."""
    first, after_last = local_dates(occurrence)
    return first < end and after_last > start


def widen(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    return start - _MARGIN, end + _MARGIN
