"""People models."""

import uuid
from datetime import datetime, time
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
from orbit_api.services.people.models import (
    DEFAULT_REMINDER_TIME,
    MAX_DATES,
    MAX_DAYS_BEFORE,
    MAX_EMAIL_LENGTH,
    MAX_LABEL_LENGTH,
    MAX_NAME_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_PHONE_LENGTH,
    MAX_YEAR,
    MIN_YEAR,
    DateKind,
    Person,
    PersonChanges,
    PersonDate,
    PersonDraft,
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
