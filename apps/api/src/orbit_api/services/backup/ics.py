"""The calendar as an iCalendar (RFC 5545) file.

- Events keep their wall-clock times in their IANA time zone (`DTSTART;TZID=Europe/London:…`),
  so a recurring 09:00 meeting stays at 09:00 across daylight-saving changes in any calendar
  app. Each zone used gets a `VTIMEZONE` with its real UTC offset transitions, read from the
  time zone database, for the years the calendar spans. UTC events use `Z` times.
- All-day events are dates (`VALUE=DATE`), ending the day after their last day, as RFC 5545
  defines.
- Series carry their rule as an `RRULE`. Orbit's month-end rule (the 31st falls on the last day
  of shorter months) is written as `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`, and February 29 as
  `BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1`, so other apps expand the same dates. An end date
  becomes `UNTIL` at the end of that local day, in UTC.
- Skipped occurrences are `EXDATE`s; changed ones are their own `VEVENT` with the series' `UID`
  and a `RECURRENCE-ID` of the original start. Cancelled events are `STATUS:CANCELLED`.
- Alerts are `VALARM`s; categories are `CATEGORIES`.

Works on the JSON-ready rows a backup writes, so it needs no database access.
"""

from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from orbit_api.services.calendar.recurrence import EventRecurrence, rule_from_json
from orbit_api.services.reminders.recurrence import WEEKDAYS

PRODID: Final = "-//Orbit//Orbit calendar export//EN"
_BYDAY: Final = {
    "mon": "MO",
    "tue": "TU",
    "wed": "WE",
    "thu": "TH",
    "fri": "FR",
    "sat": "SA",
    "sun": "SU",
}
_MAX_SPAN_YEARS: Final = 60

Row = Mapping[str, Any]


def _escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def _fold(line: str) -> str:
    """Lines longer than 75 octets continue on the next line after a space (RFC 5545 §3.1),
    never splitting a UTF-8 character."""
    data = line.encode()
    if len(data) <= 75:
        return line
    parts: list[str] = []
    current = ""
    size = 0
    limit = 75
    for char in line:
        width = len(char.encode())
        if size + width > limit:
            parts.append(current)
            current, size, limit = "", 0, 74
        current += char
        size += width
    parts.append(current)
    return "\r\n ".join(parts)


def _local(value: datetime) -> str:
    return value.strftime("%Y%m%dT%H%M%S")


def _utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _day(value: date) -> str:
    return value.strftime("%Y%m%d")


def _parse(value: object) -> datetime:
    return datetime.fromisoformat(cast(str, value))


def _time_property(name: str, value: datetime, zone: str, all_day: bool) -> str:
    if all_day:
        return f"{name};VALUE=DATE:{_day(value.date())}"
    if zone == "UTC":
        return f"{name}:{_local(value)}Z"
    return f"{name};TZID={zone}:{_local(value)}"


def rrule(rule: EventRecurrence, start: datetime, zone: str, all_day: bool) -> str:
    parts = [f"FREQ={rule.frequency.upper()}"]
    if rule.interval != 1:
        parts.append(f"INTERVAL={rule.interval}")
    if rule.weekdays:
        parts.append("BYDAY=" + ",".join(_BYDAY[d] for d in WEEKDAYS if d in rule.weekdays))
    if rule.frequency == "monthly" and start.day > 28:
        parts.append("BYMONTHDAY=" + ",".join(str(d) for d in range(28, start.day + 1)))
        parts.append("BYSETPOS=-1")
    if rule.frequency == "yearly" and start.month == 2 and start.day == 29:
        parts.extend(("BYMONTH=2", "BYMONTHDAY=28,29", "BYSETPOS=-1"))
    if rule.count is not None:
        parts.append(f"COUNT={rule.count}")
    if rule.until is not None:
        if all_day:
            parts.append(f"UNTIL={_day(rule.until)}")
        else:
            end_of_day = datetime.combine(rule.until, start.time()).replace(
                hour=23, minute=59, second=59
            )
            tz = ZoneInfo(zone)
            parts.append(f"UNTIL={_utc(end_of_day.replace(tzinfo=tz))}")
    return "RRULE:" + ";".join(parts)


def _offset(delta: timedelta | None) -> str:
    seconds = int((delta or timedelta()).total_seconds())
    sign = "+" if seconds >= 0 else "-"
    seconds = abs(seconds)
    return f"{sign}{seconds // 3600:02d}{seconds % 3600 // 60:02d}"


def vtimezone(name: str, first_year: int, last_year: int) -> list[str]:
    """A `VTIMEZONE` listing the zone's real offset changes from `first_year` to `last_year`."""
    zone = ZoneInfo(name)
    start = datetime(first_year, 1, 1, tzinfo=UTC)
    end = datetime(last_year + 1, 1, 1, tzinfo=UTC)
    first = start.astimezone(zone)
    lines = ["BEGIN:VTIMEZONE", f"TZID={name}"]

    def observance(at: datetime, before: timedelta | None) -> list[str]:
        local = at.astimezone(zone)
        kind = "DAYLIGHT" if local.dst() else "STANDARD"
        wall = (at + (before or timedelta())).replace(tzinfo=None)
        result = [
            f"BEGIN:{kind}",
            f"DTSTART:{_local(wall)}",
            f"TZOFFSETFROM:{_offset(before)}",
            f"TZOFFSETTO:{_offset(local.utcoffset())}",
        ]
        if local.tzname():
            result.append(f"TZNAME:{_escape(local.tzname() or '')}")
        result.append(f"END:{kind}")
        return result

    lines.extend(observance(start, first.utcoffset()))
    moment, offset = start, first.utcoffset()
    while moment < end:
        following = moment + timedelta(days=1)
        new_offset = following.astimezone(zone).utcoffset()
        if new_offset != offset:
            low, high = moment, following
            while high - low > timedelta(minutes=1):
                middle = low + (high - low) / 2
                if middle.astimezone(zone).utcoffset() == offset:
                    low = middle
                else:
                    high = middle
            change = high.replace(second=0, microsecond=0)
            lines.extend(observance(change, offset))
            offset = new_offset
        moment = following
    lines.append("END:VTIMEZONE")
    return lines


def _alarm(minutes: int) -> list[str]:
    return [
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Reminder",
        f"TRIGGER:-PT{minutes}M",
        "END:VALARM",
    ]


def calendar_ics(tables: Mapping[str, Iterable[Row]], *, name: str, now: datetime) -> str:
    events = list(tables.get("calendar_events", ()))
    exceptions = list(tables.get("calendar_event_exceptions", ()))
    alerts: dict[str, list[int]] = {}
    for alert in tables.get("calendar_event_alerts", ()):
        alerts.setdefault(cast(str, alert["event_id"]), []).append(int(alert["minutes_before"]))
    categories = {
        cast(str, row["id"]): cast(str, row["name"])
        for row in tables.get("calendar_categories", ())
    }
    by_event: dict[str, list[Row]] = {}
    for row in exceptions:
        by_event.setdefault(cast(str, row["event_id"]), []).append(row)

    zones: set[str] = set()
    years: list[int] = [now.year]
    body: list[str] = []
    stamp = _utc(now)
    for event in sorted(events, key=lambda row: cast(str, row["start_local"])):
        zone = cast(str, event["timezone"])
        try:
            ZoneInfo(zone)
        except (ZoneInfoNotFoundError, ValueError):
            zone = "UTC"
        all_day = bool(event["all_day"])
        start, end = _parse(event["start_local"]), _parse(event["end_local"])
        years.append(start.year)
        if not all_day and zone != "UTC":
            zones.add(zone)
        uid = f"{event['id']}@orbit"
        rule = rule_from_json(event.get("recurrence"))
        lines = [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{stamp}",
            f"CREATED:{_utc(_parse(event['created_at']))}",
            f"LAST-MODIFIED:{_utc(_parse(event['updated_at']))}",
            _time_property("DTSTART", start, zone, all_day),
            _time_property("DTEND", end, zone, all_day),
            f"SUMMARY:{_escape(cast(str, event['title']))}",
        ]
        if event.get("description"):
            lines.append(f"DESCRIPTION:{_escape(cast(str, event['description']))}")
        if event.get("location"):
            lines.append(f"LOCATION:{_escape(cast(str, event['location']))}")
        category = categories.get(cast(str, event.get("category_id") or ""))
        if category:
            lines.append(f"CATEGORIES:{_escape(category)}")
        lines.append("STATUS:CANCELLED" if event["status"] == "cancelled" else "STATUS:CONFIRMED")
        overrides: list[list[str]] = []
        if rule is not None:
            lines.append(rrule(rule, start, zone, all_day))
            duration = end - start
            for exception in by_event.get(cast(str, event["id"]), []):
                original = _parse(exception["original_start"])
                if exception["kind"] == "skipped":
                    lines.append(_time_property("EXDATE", original, zone, all_day))
                    continue
                o_start = (
                    _parse(exception["start_local"]) if exception.get("start_local") else original
                )
                o_end = (
                    _parse(exception["end_local"])
                    if exception.get("end_local")
                    else o_start + duration
                )
                override = [
                    "BEGIN:VEVENT",
                    f"UID:{uid}",
                    f"DTSTAMP:{stamp}",
                    _time_property("RECURRENCE-ID", original, zone, all_day),
                    _time_property("DTSTART", o_start, zone, all_day),
                    _time_property("DTEND", o_end, zone, all_day),
                    f"SUMMARY:{_escape(cast(str, exception.get('title') or event['title']))}",
                ]
                description = exception.get("description") or event.get("description")
                if description:
                    override.append(f"DESCRIPTION:{_escape(cast(str, description))}")
                location = exception.get("location") or event.get("location")
                if location:
                    override.append(f"LOCATION:{_escape(cast(str, location))}")
                status = exception.get("status") or event["status"]
                override.append("STATUS:CANCELLED" if status == "cancelled" else "STATUS:CONFIRMED")
                override.extend(
                    line
                    for minutes in alerts.get(cast(str, event["id"]), [])
                    for line in _alarm(minutes)
                )
                override.append("END:VEVENT")
                overrides.append(override)
        for minutes in alerts.get(cast(str, event["id"]), []):
            lines.extend(_alarm(minutes))
        lines.append("END:VEVENT")
        body.extend(lines)
        for override in overrides:
            body.extend(override)

    first_year = min(years)
    last_year = min(max(max(years) + 1, now.year + 5), first_year + _MAX_SPAN_YEARS)
    output = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{_escape(name)}",
    ]
    for zone in sorted(zones):
        output.extend(vtimezone(zone, first_year, last_year))
    output.extend(body)
    output.append("END:VCALENDAR")
    return "".join(_fold(line) + "\r\n" for line in output)
