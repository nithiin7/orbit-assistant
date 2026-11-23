"""Yearly dates: when a person's date next comes round, and what their reminder should say.

Pure functions, tested in `tests/test_people_dates.py`.
"""

import calendar
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from orbit_api.services.people.models import Person, PersonDate, PersonDateError
from orbit_api.services.reminders.managed import ReminderTarget
from orbit_api.services.reminders.recurrence import Schedule, local_to_utc

_TITLE_MAX = 200


def check_dates(dates: Sequence[PersonDate]) -> None:
    """Raise `PersonDateError` for a day the month doesn't have (29 February is allowed without
    a year, or in a leap year) or for a second birthday."""
    for entry in dates:
        # A leap year, so 29 February counts as a real day when no year is given.
        year = entry.year if entry.year is not None else 2000
        if entry.day > calendar.monthrange(year, entry.month)[1]:
            raise PersonDateError(
                f"{_month(entry.month)} {year_text(entry)}has no day {entry.day}."
            )
    if sum(1 for entry in dates if entry.kind == "birthday") > 1:
        raise PersonDateError("A person can have only one birthday.")


def year_text(entry: PersonDate) -> str:
    return f"{entry.year} " if entry.year is not None else ""


def occurrence(entry: PersonDate, year: int) -> date:
    """The date in `year`. 29 February falls on 28 February outside leap years."""
    day = min(entry.day, calendar.monthrange(year, entry.month)[1])
    return date(year, entry.month, day)


def next_occurrence(entry: PersonDate, today: date) -> date:
    """The next time the date comes round: today, or later."""
    this_year = occurrence(entry, today.year)
    return this_year if this_year >= today else occurrence(entry, today.year + 1)


def years_on(entry: PersonDate, day: date) -> int | None:
    """How old the person turns, or how many years it has been, on `day`; `None` without a
    year."""
    return day.year - entry.year if entry.year is not None else None


@dataclass(frozen=True, slots=True)
class Alert:
    entry: PersonDate
    # The date being announced, and when the reminder fires (in UTC).
    on: date
    at: datetime


def next_alert(person: Person, now: datetime) -> Alert | None:
    """The soonest reminder still ahead of `now`, across the person's dates that have one."""
    zone = ZoneInfo(person.timezone)
    today = now.astimezone(zone).date()
    best: Alert | None = None
    for entry in person.dates:
        if entry.remind_days_before is None:
            continue
        # A reminder up to 30 days early can fall in the previous calendar year, so look at
        # this year's date and the next two.
        for year in (today.year, today.year + 1, today.year + 2):
            on = occurrence(entry, year)
            # Nothing to celebrate before the date first happened.
            if entry.year is not None and year <= entry.year:
                continue
            at = local_to_utc(
                on - timedelta(days=entry.remind_days_before), person.reminder_time, zone
            )
            if at > now:
                if best is None or at < best.at:
                    best = Alert(entry=entry, on=on, at=at)
                break
    return best


def reminder_target(person: Person, now: datetime) -> ReminderTarget | None:
    """What the person's managed reminder should announce next, or `None` for nothing."""
    alert = next_alert(person, now)
    if alert is None:
        return None
    days_before = alert.entry.remind_days_before or 0
    return ReminderTarget(
        schedule=Schedule(
            start_date=alert.on - timedelta(days=days_before),
            time_of_day=person.reminder_time,
            timezone=person.timezone,
        ),
        title=_title(person.name, alert.entry, alert.on, days_before),
        # Dates only: contact details and notes stay out of reminders.
        description=f"{date_label(alert.entry)} on {alert.on.day} {_month(alert.on.month)}"
        f" {alert.on.year}. Open People to see more.",
    )


def date_label(entry: PersonDate) -> str:
    match entry.kind:
        case "birthday":
            return "Birthday"
        case "anniversary":
            return "Anniversary"
        case "other":
            return entry.label


def _when(days_before: int) -> str:
    if days_before == 0:
        return "today"
    if days_before == 1:
        return "tomorrow"
    return f"in {days_before} days"


def _title(name: str, entry: PersonDate, on: date, days_before: int) -> str:
    when = _when(days_before)
    years = years_on(entry, on)
    match entry.kind:
        case "birthday":
            text = f"{name} turns {years} {when}" if years else f"{name}'s birthday is {when}"
        case "anniversary":
            text = f"{name}'s anniversary is {when}"
            if years:
                text += f" ({years} {'year' if years == 1 else 'years'})"
        case "other":
            text = f"{name}: {entry.label} {when}"
    if len(text) <= _TITLE_MAX:
        return text
    return text[: _TITLE_MAX - 1].rstrip() + "…"


def _month(month: int) -> str:
    return calendar.month_name[month]
