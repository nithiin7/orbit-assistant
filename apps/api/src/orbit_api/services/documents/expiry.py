"""Expiry statuses and the reminder a document's dates call for. Pure functions of a document
and the time, so they're tested without a database.

A document tracks up to three dates: expiry, renewal, and review. For each date and each of its
reminder days (days before; 0 is the day itself), an alert falls at the reminder time on that
day in the document's time zone. The document's one managed reminder always points at the
earliest alert still ahead, so changing a date re-points it rather than adding another, and
alerts whose time has passed are never sent late.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from orbit_api.services.documents.models import EXPIRING_SOON_DAYS, Document, ExpiryStatus
from orbit_api.services.reminders.managed import ReminderTarget
from orbit_api.services.reminders.recurrence import Schedule, local_to_utc

TrackedDate = Literal["expiry", "renewal", "review"]
_REMINDER_TITLE_MAX = 200


def expiry_status(expiry: date | None, today: date) -> ExpiryStatus:
    if expiry is None:
        return "none"
    if expiry < today:
        return "expired"
    if expiry <= today + timedelta(days=EXPIRING_SOON_DAYS):
        return "expiring"
    return "valid"


def today_in(timezone: str, now: datetime) -> date:
    return now.astimezone(ZoneInfo(timezone)).date()


@dataclass(frozen=True, slots=True)
class Alert:
    at: datetime
    kind: TrackedDate
    day: date
    days_before: int


def alerts(document: Document) -> Iterator[Alert]:
    """Every alert the document's dates and reminder days produce, in no particular order."""
    settings = document.reminders
    zone = ZoneInfo(settings.timezone)
    details = document.details
    dates: tuple[tuple[TrackedDate, date | None], ...] = (
        ("expiry", details.expiry_date),
        ("renewal", details.renewal_date),
        ("review", details.review_date),
    )
    for kind, day in dates:
        if day is None:
            continue
        for days_before in settings.days:
            alert_day = day - timedelta(days=days_before)
            yield Alert(local_to_utc(alert_day, settings.time_of_day, zone), kind, day, days_before)


def next_alert(document: Document, now: datetime) -> Alert | None:
    """The earliest alert after `now`; none for archived or trashed documents."""
    if document.state != "active":
        return None
    upcoming = [alert for alert in alerts(document) if alert.at > now]
    return min(upcoming, key=lambda alert: (alert.at, alert.kind), default=None)


def reminder_target(document: Document, now: datetime) -> ReminderTarget | None:
    alert = next_alert(document, now)
    if alert is None:
        return None
    settings = document.reminders
    alert_day = alert.day - timedelta(days=alert.days_before)
    return ReminderTarget(
        schedule=Schedule(
            start_date=alert_day, time_of_day=settings.time_of_day, timezone=settings.timezone
        ),
        title=_title(document.title, alert),
        # Dates only: reference numbers and other details stay out of reminders.
        description=f"{_label(alert.kind)}: {alert.day.isoformat()}. Open it in Documents.",
    )


def _label(kind: TrackedDate) -> str:
    return {"expiry": "Expiry date", "renewal": "Renewal date", "review": "Review date"}[kind]


def _when(days_before: int) -> str:
    if days_before == 0:
        return "today"
    if days_before == 1:
        return "tomorrow"
    return f"in {days_before} days"


def _title(title: str, alert: Alert) -> str:
    when = _when(alert.days_before)
    match alert.kind:
        case "expiry":
            suffix = f" expires {when}"
        case "renewal":
            suffix = f" is due for renewal {when}"
        case "review":
            suffix = f" is due for review {when}"
    room = _REMINDER_TITLE_MAX - len(suffix)
    name = title if len(title) <= room else title[: room - 1].rstrip() + "…"
    return name + suffix
