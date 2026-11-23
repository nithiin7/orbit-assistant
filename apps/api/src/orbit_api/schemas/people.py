"""People models."""

import uuid
from datetime import date, datetime, time
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import TimeZoneName, multi_line, single_line
from orbit_api.schemas.finance import Amount
from orbit_api.services.finance.money import Currency
from orbit_api.services.people.models import (
    DEFAULT_REMINDER_TIME,
    MAX_DATES,
    MAX_DAYS_BEFORE,
    MAX_DESCRIPTION_LENGTH,
    MAX_EMAIL_LENGTH,
    MAX_LABEL_LENGTH,
    MAX_NAME_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_PHONE_LENGTH,
    MAX_YEAR,
    MIN_YEAR,
    Balance,
    DateKind,
    Ledger,
    LedgerChanges,
    LedgerDraft,
    LedgerEntry,
    LedgerKind,
    LinkedTransaction,
    Person,
    PersonChanges,
    PersonDate,
    PersonDraft,
    RecordInFinance,
    Relationship,
)
from orbit_api.utils.changes import UNSET

PersonName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH),
    AfterValidator(single_line),
]
Phone = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_PHONE_LENGTH),
    AfterValidator(single_line),
]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_EMAIL_LENGTH),
    AfterValidator(single_line),
]
PersonNote = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_NOTE_LENGTH),
    AfterValidator(multi_line),
]
DateLabel = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_LABEL_LENGTH),
    AfterValidator(single_line),
]


class PersonDateBody(BaseModel):
    """A date that comes round every year. Without a year, ages and years together aren't
    known; 29 February falls on 28 February in other years."""

    model_config = ConfigDict(extra="forbid")

    kind: DateKind
    label: DateLabel = Field(
        default="", description="The date's name; required for `other`, empty otherwise."
    )
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    year: int | None = Field(default=None, ge=MIN_YEAR, le=MAX_YEAR)
    remind_days_before: int | None = Field(
        default=None,
        ge=0,
        le=MAX_DAYS_BEFORE,
        description="Days before the date to remind (0 is on the day); null for no reminder.",
    )

    @model_validator(mode="after")
    def _check_label(self) -> Self:
        if self.kind == "other" and not self.label:
            raise ValueError("a date of kind other needs a label")
        if self.kind != "other" and self.label:
            raise ValueError("only dates of kind other have a label")
        return self

    @classmethod
    def of(cls, entry: PersonDate) -> "PersonDateBody":
        return cls(
            kind=entry.kind,
            label=entry.label,
            month=entry.month,
            day=entry.day,
            year=entry.year,
            remind_days_before=entry.remind_days_before,
        )

    def to_date(self) -> PersonDate:
        return PersonDate(
            kind=self.kind,
            label=self.label,
            month=self.month,
            day=self.day,
            year=self.year,
            remind_days_before=self.remind_days_before,
        )


class PersonResponse(BaseModel):
    id: uuid.UUID
    name: str
    relationship: Relationship
    phone: str = Field(description="Empty when not given.")
    email: str = Field(description="Empty when not given.")
    note: str = Field(description="Empty when not given.")
    favorite: bool
    dates: list[PersonDateBody] = Field(description="In the order the user listed them.")
    reminder_time: time = Field(description="When date reminders fire, in `timezone`.")
    timezone: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, person: Person) -> "PersonResponse":
        return cls(
            id=person.id,
            name=person.name,
            relationship=person.relationship,
            phone=person.phone,
            email=person.email,
            note=person.note,
            favorite=person.favorite,
            dates=[PersonDateBody.of(entry) for entry in person.dates],
            reminder_time=person.reminder_time,
            timezone=person.timezone,
            created_at=person.created_at,
            updated_at=person.updated_at,
        )


class PeopleResponse(BaseModel):
    people: list[PersonResponse] = Field(description="Everyone, by name.")


class CreatePersonRequest(BaseModel):
    """Add a person. A name is enough; dates with `remind_days_before` get reminders."""

    model_config = ConfigDict(extra="forbid")

    name: PersonName
    relationship: Relationship = "friend"
    phone: Phone = ""
    email: Email = ""
    note: PersonNote = ""
    favorite: bool = False
    dates: list[PersonDateBody] = Field(default_factory=list[PersonDateBody], max_length=MAX_DATES)
    reminder_time: time | None = Field(default=None, description="09:00 by default.")
    timezone: TimeZoneName | None = Field(
        default=None, description="For reminders; the user's time zone by default."
    )

    def to_draft(self, default_timezone: str | None) -> PersonDraft:
        return PersonDraft(
            name=self.name,
            relationship=self.relationship,
            phone=self.phone,
            email=self.email,
            note=self.note,
            favorite=self.favorite,
            dates=tuple(entry.to_date() for entry in self.dates),
            reminder_time=self.reminder_time or DEFAULT_REMINDER_TIME,
            timezone=self.timezone or default_timezone or "UTC",
        )


class UpdatePersonRequest(BaseModel):
    """Change some of a person's fields. Omitted fields keep their values; `dates` replaces all
    of them."""

    model_config = ConfigDict(extra="forbid")

    name: PersonName | None = None
    relationship: Relationship | None = None
    phone: Phone | None = None
    email: Email | None = None
    note: PersonNote | None = None
    favorite: bool | None = None
    dates: list[PersonDateBody] | None = Field(default=None, max_length=MAX_DATES)
    reminder_time: time | None = None
    timezone: TimeZoneName | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> PersonChanges:
        return PersonChanges(
            name=self.name if self.name is not None else UNSET,
            relationship=self.relationship if self.relationship is not None else UNSET,
            phone=self.phone if self.phone is not None else UNSET,
            email=self.email if self.email is not None else UNSET,
            note=self.note if self.note is not None else UNSET,
            favorite=self.favorite if self.favorite is not None else UNSET,
            dates=tuple(entry.to_date() for entry in self.dates)
            if self.dates is not None
            else UNSET,
            reminder_time=self.reminder_time if self.reminder_time is not None else UNSET,
            timezone=self.timezone if self.timezone is not None else UNSET,
        )


# Money owed

LedgerDescription = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_DESCRIPTION_LENGTH),
    AfterValidator(single_line),
]


class PersonLinkedTransactionResponse(BaseModel):
    """The Finance transaction behind an entry; null once that transaction is deleted."""

    id: uuid.UUID
    type: str
    description: str
    amount: int
    occurred_on: date
    account_id: uuid.UUID
    category_id: uuid.UUID | None

    @classmethod
    def of(cls, linked: LinkedTransaction) -> "PersonLinkedTransactionResponse":
        return cls(
            id=linked.id,
            type=linked.type,
            description=linked.description,
            amount=linked.amount,
            occurred_on=linked.occurred_on,
            account_id=linked.account_id,
            category_id=linked.category_id,
        )


class PersonLedgerEntryResponse(BaseModel):
    id: uuid.UUID
    person_id: uuid.UUID
    kind: LedgerKind = Field(
        description="`they_owe` (you paid or lent), `i_owe` (they did), or a repayment: "
        "`they_paid` or `i_paid`."
    )
    amount: int = Field(description="Minor units, always positive; `kind` says which way.")
    currency: Currency
    occurred_on: date
    description: str
    transaction: PersonLinkedTransactionResponse | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, entry: LedgerEntry) -> "PersonLedgerEntryResponse":
        return cls(
            id=entry.id,
            person_id=entry.person_id,
            kind=entry.kind,
            amount=entry.amount,
            currency=entry.currency,
            occurred_on=entry.occurred_on,
            description=entry.description,
            transaction=PersonLinkedTransactionResponse.of(entry.transaction)
            if entry.transaction
            else None,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )


class PersonBalanceResponse(BaseModel):
    person_id: uuid.UUID
    currency: Currency
    amount: int = Field(
        description="Minor units: positive while they owe you, negative while you owe them."
    )

    @classmethod
    def of(cls, balance: Balance) -> "PersonBalanceResponse":
        return cls(person_id=balance.person_id, currency=balance.currency, amount=balance.amount)


class PersonLedgerResponse(BaseModel):
    entries: list[PersonLedgerEntryResponse] = Field(description="Newest first.")
    balances: list[PersonBalanceResponse] = Field(
        description="Each person's non-zero balance per currency; currencies are never mixed."
    )

    @classmethod
    def of(cls, ledger: Ledger) -> "PersonLedgerResponse":
        return cls(
            entries=[PersonLedgerEntryResponse.of(entry) for entry in ledger.entries],
            balances=[PersonBalanceResponse.of(balance) for balance in ledger.balances],
        )


class PersonLedgerRecordRequest(BaseModel):
    """Record a repayment in Finance too, in the same commit."""

    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID = Field(description="Where the money arrived or left from.")
    category_id: uuid.UUID = Field(
        description="An expense category: the shared expense's, so your spending comes down "
        "to your share."
    )


class CreatePersonLedgerEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: LedgerKind
    amount: Amount
    currency: Currency
    occurred_on: date
    description: LedgerDescription
    transaction_id: uuid.UUID | None = Field(
        default=None,
        description="For `they_owe`: the expense of yours this share was split from.",
    )
    record_in_finance: PersonLedgerRecordRequest | None = Field(
        default=None,
        description="For repayments: also record a refund (`they_paid`) or an expense "
        "(`i_paid`) in Finance.",
    )

    def to_draft(self) -> LedgerDraft:
        record = self.record_in_finance
        return LedgerDraft(
            kind=self.kind,
            amount=self.amount,
            currency=self.currency,
            occurred_on=self.occurred_on,
            description=self.description,
            transaction_id=self.transaction_id,
            record=RecordInFinance(account_id=record.account_id, category_id=record.category_id)
            if record
            else None,
        )


class UpdatePersonLedgerEntryRequest(BaseModel):
    """Change an entry's amount, date, or description. Its kind and links stay."""

    model_config = ConfigDict(extra="forbid")

    amount: Amount | None = None
    occurred_on: date | None = None
    description: LedgerDescription | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> LedgerChanges:
        return LedgerChanges(
            amount=self.amount if self.amount is not None else UNSET,
            occurred_on=self.occurred_on if self.occurred_on is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
        )
