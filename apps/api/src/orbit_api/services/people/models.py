"""People types: the people in your life and the yearly dates to remember about them."""

import uuid
from dataclasses import dataclass
from datetime import datetime, time
from typing import Literal

from orbit_api.utils.changes import UNSET, Change

Relationship = Literal["family", "partner", "friend", "colleague", "other"]
DateKind = Literal["birthday", "anniversary", "other"]

MAX_NAME_LENGTH = 120
MAX_PHONE_LENGTH = 40
MAX_EMAIL_LENGTH = 254
MAX_NOTE_LENGTH = 2000
MAX_LABEL_LENGTH = 60
MAX_DATES = 10
MAX_DAYS_BEFORE = 30
MIN_YEAR = 1900
MAX_YEAR = 2100

DEFAULT_REMINDER_TIME = time(9, 0)


@dataclass(frozen=True, slots=True)
class PersonDate:
    """A date that comes round every year. Without a `year`, ages and years together aren't
    known. 29 February falls on 28 February in other years."""

    kind: DateKind
    month: int
    day: int
    # The date's name for `other`; empty for birthdays and anniversaries.
    label: str = ""
    year: int | None = None
    # Days before the date to remind; `None` means no reminder.
    remind_days_before: int | None = None


@dataclass(frozen=True, slots=True)
class Person:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    relationship: Relationship
    phone: str
    email: str
    note: str
    favorite: bool
    # In the order the user listed them; at most one birthday.
    dates: tuple[PersonDate, ...]
    # When date reminders fire, as a local time in `timezone`.
    reminder_time: time
    timezone: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PersonDraft:
    name: str
    timezone: str
    relationship: Relationship = "friend"
    phone: str = ""
    email: str = ""
    note: str = ""
    favorite: bool = False
    dates: tuple[PersonDate, ...] = ()
    reminder_time: time = DEFAULT_REMINDER_TIME


@dataclass(frozen=True, slots=True)
class PersonChanges:
    """A partial update. `UNSET` leaves a field as it is; `dates` replaces all of them."""

    name: Change[str] = UNSET
    relationship: Change[Relationship] = UNSET
    phone: Change[str] = UNSET
    email: Change[str] = UNSET
    note: Change[str] = UNSET
    favorite: Change[bool] = UNSET
    dates: Change[tuple[PersonDate, ...]] = UNSET
    reminder_time: Change[time] = UNSET
    timezone: Change[str] = UNSET


class PersonNotFoundError(Exception):
    """The person does not exist in this workspace."""


class PersonDateError(Exception):
    """A date doesn't exist (such as 31 April), or a person was given two birthdays."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
