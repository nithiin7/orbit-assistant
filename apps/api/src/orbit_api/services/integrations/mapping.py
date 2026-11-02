"""Pure translation between external events and Orbit's calendar: recurrence rules, field
limits, snapshots, and the fingerprints that detect changes made in Orbit.

RFC 5545 rules are translated only when Orbit's recurrence model can represent them exactly
(daily; weekly on weekdays including the start's; monthly on the start's day; yearly on the
start's date; an interval; a count or an end date). Anything else (ordinal weekdays, `BYSETPOS`,
`RDATE`, several rules) returns `None`, and the connector imports the provider's expanded
occurrences instead. A rule is never approximated.
"""

import hashlib
import json
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Final, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from orbit_api.services.calendar.models import CalendarEvent, EventException
from orbit_api.services.calendar.occurrences import to_local
from orbit_api.services.calendar.recurrence import (
    MAX_COUNT,
    MAX_INTERVAL,
    EventFrequency,
    EventRecurrence,
    InvalidEventRecurrenceError,
    rule_from_json,
    rule_to_json,
)
from orbit_api.services.integrations.connectors import OutgoingEvent, RemoteEvent
from orbit_api.services.reminders.recurrence import WEEKDAYS, Weekday

MAX_TITLE: Final = 200
MAX_DESCRIPTION: Final = 5000
MAX_LOCATION: Final = 200
UNTITLED: Final = "(No title)"
MAX_EVENT_LENGTH: Final = timedelta(days=366)

_FREQUENCIES: Final[dict[str, EventFrequency]] = {
    "DAILY": "daily",
    "WEEKLY": "weekly",
    "MONTHLY": "monthly",
    "YEARLY": "yearly",
}
_BYDAY: Final[dict[str, Weekday]] = {
    "MO": "mon",
    "TU": "tue",
    "WE": "wed",
    "TH": "thu",
    "FR": "fri",
    "SA": "sat",
    "SU": "sun",
}
_SUPPORTED_PARTS: Final = frozenset(
    {"FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"}
)


def valid_timezone(name: str | None) -> str | None:
    if not name:
        return None
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None
    return name


def local_from_instant(instant: datetime, timezone: str) -> datetime:
    """A UTC (or offset) instant as a naive wall-clock time in `timezone`, to the minute."""
    local = to_local(instant.astimezone(UTC), ZoneInfo(timezone))
    return local.replace(second=0, microsecond=0)


def parse_rrule(
    lines: Sequence[str], start: datetime, timezone: str
) -> tuple[EventRecurrence, tuple[datetime, ...]] | None:
    """Orbit's rule and the skipped starts (EXDATE) for RFC 5545 recurrence lines, or `None`
    when Orbit can't represent them exactly. `start` is the series' naive local start."""
    rules = [line for line in lines if line.upper().startswith("RRULE:")]
    if len(rules) != 1 or any(line.upper().startswith(("RDATE", "EXRULE")) for line in lines):
        return None
    parts: dict[str, str] = {}
    for item in rules[0][6:].split(";"):
        key, _, value = item.partition("=")
        if not value:
            return None
        parts[key.upper()] = value.upper()
    if not set(parts) <= _SUPPORTED_PARTS:
        return None
    frequency = _FREQUENCIES.get(parts.get("FREQ", ""))
    if frequency is None:
        return None
    try:
        interval = int(parts.get("INTERVAL", "1"))
        count = int(parts["COUNT"]) if "COUNT" in parts else None
    except ValueError:
        return None
    if not 1 <= interval <= MAX_INTERVAL or (count is not None and not 1 <= count <= MAX_COUNT):
        return None
    weekdays: frozenset[Weekday] = frozenset()
    if "BYDAY" in parts:
        if frequency != "weekly":
            return None
        days = parts["BYDAY"].split(",")
        if any(day not in _BYDAY for day in days):
            return None  # Ordinals such as 2TU.
        weekdays = frozenset(_BYDAY[day] for day in days)
    elif frequency == "weekly":
        weekdays = frozenset({WEEKDAYS[start.weekday()]})
    if frequency == "weekly" and WEEKDAYS[start.weekday()] not in weekdays:
        return None
    if "BYMONTHDAY" in parts and (
        frequency not in ("monthly", "yearly") or parts["BYMONTHDAY"] != str(start.day)
    ):
        return None
    if "BYMONTH" in parts and (frequency != "yearly" or parts["BYMONTH"] != str(start.month)):
        return None
    until = _until(parts["UNTIL"], timezone) if "UNTIL" in parts else None
    if "UNTIL" in parts and until is None:
        return None
    try:
        rule = EventRecurrence(
            frequency=frequency, interval=interval, weekdays=weekdays, count=count, until=until
        )
    except InvalidEventRecurrenceError:
        return None
    if rule.until is not None and rule.until < start.date():
        return None
    return rule, _exdates(lines, timezone, start)


def _until(value: str, timezone: str) -> date | None:
    """RFC 5545 `UNTIL`: a date, a UTC date-time (`Z`), or a floating local date-time."""
    try:
        if len(value) == 8:
            return datetime.strptime(value, "%Y%m%d").date()
        if value.endswith("Z"):
            instant = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            return local_from_instant(instant, timezone).date()
        return datetime.strptime(value, "%Y%m%dT%H%M%S").date()
    except ValueError:
        return None


def _exdates(lines: Sequence[str], timezone: str, start: datetime) -> tuple[datetime, ...]:
    skipped: list[datetime] = []
    for line in lines:
        if not line.upper().startswith("EXDATE"):
            continue
        head, _, values = line.partition(":")
        zone = timezone
        for param in head.split(";")[1:]:
            key, _, value = param.partition("=")
            if key.upper() == "TZID" and valid_timezone(value):
                zone = value
        for raw in values.split(","):
            raw = raw.strip()
            try:
                if len(raw) == 8:
                    skipped.append(datetime.combine(datetime.strptime(raw, "%Y%m%d"), start.time()))
                elif raw.endswith("Z"):
                    instant = datetime.strptime(raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
                    skipped.append(local_from_instant(instant, timezone))
                else:
                    local = datetime.strptime(raw, "%Y%m%dT%H%M%S")
                    if zone != timezone:
                        aware = local.replace(tzinfo=ZoneInfo(zone))
                        local = local_from_instant(aware, timezone)
                    skipped.append(local)
            except ValueError:
                continue
    return tuple(sorted(set(skipped)))


def rrule_lines(rule: EventRecurrence) -> list[str]:
    """RFC 5545 lines for Orbit's rule (used when sending a series to a provider)."""
    reverse = {v: k for k, v in _BYDAY.items()}
    parts = [f"FREQ={rule.frequency.upper()}"]
    if rule.interval != 1:
        parts.append(f"INTERVAL={rule.interval}")
    if rule.weekdays:
        parts.append("BYDAY=" + ",".join(reverse[d] for d in WEEKDAYS if d in rule.weekdays))
    if rule.count is not None:
        parts.append(f"COUNT={rule.count}")
    if rule.until is not None:
        parts.append(f"UNTIL={rule.until:%Y%m%d}T235959Z")
    return ["RRULE:" + ";".join(parts)]


def clean_text(value: str, limit: int) -> str:
    # Control characters other than newlines and tabs have no place in calendar text.
    cleaned = "".join(c for c in value if c in "\n\t" or c >= " ")
    return cleaned.strip()[:limit]


def normalized(event: RemoteEvent) -> RemoteEvent:
    """The event within Orbit's limits: a title, bounded text, minute precision, and an end
    that isn't before the start. Raises `ValueError` for an event Orbit can't hold."""
    title = clean_text(event.title, MAX_TITLE) or UNTITLED
    start = event.start.replace(second=0, microsecond=0)
    end = max(event.end.replace(second=0, microsecond=0), start)
    if event.all_day:
        start = datetime.combine(start.date(), time())
        end = datetime.combine(end.date(), time())
        if end <= start:
            end = start + timedelta(days=1)
    if end - start > MAX_EVENT_LENGTH:
        raise ValueError("The event is longer than Orbit supports.")
    return RemoteEvent(
        external_id=event.external_id,
        version=event.version,
        title=title,
        description=clean_text(event.description, MAX_DESCRIPTION),
        location=clean_text(event.location, MAX_LOCATION),
        all_day=event.all_day,
        timezone=event.timezone,
        start=start,
        end=end,
        recurrence=event.recurrence,
        skipped=event.skipped,
        parent_id=event.parent_id,
        original_start=event.original_start,
        expanded=event.expanded,
        cancelled=event.cancelled,
        url=event.url,
    )


def start_instant(event: RemoteEvent) -> datetime:
    return event.start.replace(tzinfo=ZoneInfo(event.timezone)).astimezone(UTC)


# Snapshots: the provider's version as stored on a link, for "keep external".


def to_snapshot(event: RemoteEvent) -> dict[str, object]:
    return {
        "external_id": event.external_id,
        "version": event.version,
        "title": event.title,
        "description": event.description,
        "location": event.location,
        "all_day": event.all_day,
        "timezone": event.timezone,
        "start": event.start.isoformat(),
        "end": event.end.isoformat(),
        "recurrence": rule_to_json(event.recurrence),
        "skipped": [s.isoformat() for s in event.skipped],
        "parent_id": event.parent_id,
        "original_start": event.original_start.isoformat() if event.original_start else None,
        "expanded": event.expanded,
        "cancelled": event.cancelled,
        "url": event.url,
    }


def from_snapshot(value: dict[str, object]) -> RemoteEvent:
    def text(key: str) -> str:
        item = value.get(key)
        return item if isinstance(item, str) else ""

    def moment(key: str) -> datetime | None:
        item = value.get(key)
        return datetime.fromisoformat(item) if isinstance(item, str) else None

    start = moment("start")
    end = moment("end")
    if start is None or end is None:
        raise ValueError("The stored snapshot is incomplete.")
    skipped = value.get("skipped")
    return RemoteEvent(
        external_id=text("external_id"),
        version=text("version"),
        title=text("title"),
        description=text("description"),
        location=text("location"),
        all_day=value.get("all_day") is True,
        timezone=text("timezone") or "UTC",
        start=start,
        end=end,
        recurrence=rule_from_json(value.get("recurrence")),
        skipped=tuple(
            datetime.fromisoformat(s)
            for s in cast(list[object], skipped if isinstance(skipped, list) else [])
            if isinstance(s, str)
        ),
        parent_id=text("parent_id") or None,
        original_start=moment("original_start"),
        expanded=value.get("expanded") is True,
        cancelled=value.get("cancelled") is True,
        url=text("url") or None,
    )


# Fingerprints of Orbit's side, to tell whether it changed since the last synchronization.


def _digest(fields: dict[str, object]) -> str:
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


def event_hash(event: CalendarEvent) -> str:
    return _digest(
        {
            "title": event.title,
            "description": event.description,
            "location": event.location,
            "all_day": event.all_day,
            "timezone": event.timezone,
            "start": event.start.isoformat(),
            "end": event.end.isoformat(),
            "recurrence": rule_to_json(event.recurrence),
            "status": event.status,
        }
    )


def exception_hash(exception: EventException | None) -> str:
    if exception is None:
        return _digest({"kind": "none"})
    return _digest(
        {
            "kind": exception.kind,
            "title": exception.title,
            "description": exception.description,
            "location": exception.location,
            "start": exception.start.isoformat() if exception.start else None,
            "end": exception.end.isoformat() if exception.end else None,
        }
    )


def outgoing(event: CalendarEvent) -> OutgoingEvent:
    return OutgoingEvent(
        title=event.title,
        description=event.description,
        location=event.location,
        all_day=event.all_day,
        timezone=event.timezone,
        start=event.start,
        end=event.end,
    )


def timing_of(event: RemoteEvent) -> tuple[object, ...]:
    return (event.all_day, event.timezone, event.start, event.end, rule_to_json(event.recurrence))
