"""People types: the people in your life and the yearly dates to remember about them."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Final, Literal

from orbit_api.services.finance.money import Currency
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


# Money between you and a person. `they_owe`: you paid or lent; `i_owe`: they did; `they_paid`
# and `i_paid`: repayments.
LedgerKind = Literal["they_owe", "i_owe", "they_paid", "i_paid"]

MAX_DESCRIPTION_LENGTH = 200

# How each kind moves the balance, which is positive while they owe you.
LEDGER_SIGNS: Final[dict[LedgerKind, int]] = {
    "they_owe": 1,
    "i_paid": 1,
    "i_owe": -1,
    "they_paid": -1,
}


@dataclass(frozen=True, slots=True)
class LinkedTransaction:
    """The Finance transaction behind an entry, as much as People shows of it."""

    id: uuid.UUID
    type: str
    description: str
    amount: int
    occurred_on: date
    account_id: uuid.UUID
    category_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    id: uuid.UUID
    workspace_id: uuid.UUID
    person_id: uuid.UUID
    kind: LedgerKind
    # Positive integer minor units of `currency`.
    amount: int
    currency: Currency
    occurred_on: date
    description: str
    transaction: LinkedTransaction | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class RecordInFinance:
    """Record a repayment in Finance too: a refund in `category_id` when they paid you back (so
    your spending comes down to your share), or an expense when you paid them back."""

    account_id: uuid.UUID
    category_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class LedgerDraft:
    kind: LedgerKind
    amount: int
    currency: Currency
    occurred_on: date
    description: str
    # An expense of yours that this share (`they_owe`) was split from.
    transaction_id: uuid.UUID | None = None
    record: RecordInFinance | None = None


@dataclass(frozen=True, slots=True)
class LedgerChanges:
    amount: Change[int] = UNSET
    occurred_on: Change[date] = UNSET
    description: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class Balance:
    """Where things stand with a person in one currency: positive while they owe you."""

    person_id: uuid.UUID
    currency: Currency
    amount: int


@dataclass(frozen=True, slots=True)
class Ledger:
    # Newest first.
    entries: list[LedgerEntry]
    # Non-zero balances only, by person and currency.
    balances: list[Balance]


class LedgerEntryNotFoundError(Exception):
    """The entry does not exist for this person in this workspace."""


class LedgerError(Exception):
    """An entry that doesn't fit: a link or record that doesn't match its kind, a currency that
    doesn't match the transaction or account, or shares above the expense."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
