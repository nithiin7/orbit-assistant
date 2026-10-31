"""Reminder models."""

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

from orbit_api.schemas.common import TimeZoneName, multi_line
from orbit_api.schemas.tasks import Title
from orbit_api.services.reminders.models import (
    CommitmentLink,
    CommitmentLinkKind,
    DeliveryOutcome,
    ReminderChanges,
    ReminderDraft,
    ReminderQuery,
    ReminderStatus,
    ReminderTask,
    ReminderView,
)
from orbit_api.services.reminders.recurrence import WEEKDAYS, Frequency, Recurrence, Weekday
from orbit_api.services.tasks.models import TaskStatus
from orbit_api.utils.changes import UNSET

DESCRIPTION_MAX_LENGTH = 2000
PAGE_MAX_SIZE = 200
UPCOMING_MAX_SIZE = 50
# Far enough ahead for any real reminder, and well clear of `date.max` for date arithmetic.
EARLIEST_YEAR = 2000
LATEST_YEAR = 2200


def _reasonable_date(value: date) -> date:
    if not EARLIEST_YEAR <= value.year <= LATEST_YEAR:
        raise ValueError(f"must be between {EARLIEST_YEAR} and {LATEST_YEAR}")
    return value


def _whole_minute(value: time) -> time:
    if value.tzinfo is not None:
        raise ValueError("must be a local time without a time zone; set `timezone` instead")
    if value.second or value.microsecond:
        raise ValueError("must be a whole minute, such as 09:30")
    return value


# Shorter than a task's description, since every notification carries a copy.
Description = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=DESCRIPTION_MAX_LENGTH),
    AfterValidator(multi_line),
]
StartDate = Annotated[date, AfterValidator(_reasonable_date)]
TimeOfDay = Annotated[time, AfterValidator(_whole_minute)]


class RecurrenceModel(BaseModel):
    """How a reminder repeats. Monthly reminders on a day a month lacks (29 to 31) fire on that
    month's last day."""

    model_config = ConfigDict(extra="forbid")

    frequency: Frequency
    weekdays: list[Weekday] = Field(
        default_factory=list[Weekday],
        max_length=7,
        description="Weekly only, and required for it: the days it repeats on.",
    )

    @model_validator(mode="after")
    def _check_weekdays(self) -> Self:
        if self.frequency == "weekly" and not self.weekdays:
            raise ValueError("weekly recurrence needs at least one weekday")
        if self.frequency != "weekly" and self.weekdays:
            raise ValueError("only weekly recurrence takes weekdays")
        if len(set(self.weekdays)) != len(self.weekdays):
            raise ValueError("weekdays must not repeat")
        return self

    def to_recurrence(self) -> Recurrence:
        return Recurrence(frequency=self.frequency, weekdays=frozenset(self.weekdays))

    @classmethod
    def of(cls, recurrence: Recurrence | None) -> "RecurrenceModel | None":
        if recurrence is None:
            return None
        # Weekday order, so equal recurrences serialize identically.
        weekdays: list[Weekday] = [day for day in WEEKDAYS if day in recurrence.weekdays]
        return cls(frequency=recurrence.frequency, weekdays=weekdays)


class ReminderTaskResponse(BaseModel):
    id: uuid.UUID
    title: str
    status: TaskStatus

    @classmethod
    def of(cls, task: ReminderTask) -> "ReminderTaskResponse":
        return cls(id=task.id, title=task.title, status=task.status)


class ReminderCommitmentResponse(BaseModel):
    kind: CommitmentLinkKind = Field(
        description="`loan`, `recurring_payment` for a subscription or bill, or `deposit` for a "
        "fixed or recurring deposit's maturity."
    )
    id: uuid.UUID

    @classmethod
    def of(cls, link: CommitmentLink | None) -> "ReminderCommitmentResponse | None":
        return cls(kind=link.kind, id=link.id) if link else None


class ReminderResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    task: ReminderTaskResponse | None = Field(
        description="The task this reminder is about, or `null` for a standalone reminder."
    )
    commitment: ReminderCommitmentResponse | None = Field(
        default=None,
        description="The loan, subscription, or bill that manages this reminder. Such "
        "reminders follow its next payment and can't be edited or deleted here (409).",
    )
    title: str
    description: str = Field(description="Empty when the reminder has no description.")
    enabled: bool
    start_date: date = Field(
        description="The date of a one-time reminder, or the first date of a recurring one."
    )
    time_of_day: time = Field(description="Local wall-clock time in `timezone`.")
    timezone: str = Field(description="An IANA time zone name.")
    recurrence: RecurrenceModel | None = Field(description="`null` for a one-time reminder.")
    status: ReminderStatus = Field(
        description="`scheduled`: the next occurrence is ahead. `overdue`: one is due but not "
        "delivered yet, or the last delivery failed. `completed`: nothing left to fire, or the "
        "task is completed. `disabled`: switched off."
    )
    next_occurrence_at: datetime | None = Field(
        description="When it next fires (UTC), possibly already due; `null` if it won't."
    )
    last_occurrence_at: datetime | None = Field(
        description="The scheduled time of the most recent occurrence that was processed."
    )
    last_outcome: DeliveryOutcome | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: ReminderView) -> "ReminderResponse":
        reminder = view.reminder
        schedule = reminder.schedule
        return cls(
            id=reminder.id,
            workspace_id=reminder.workspace_id,
            task=ReminderTaskResponse.of(view.task) if view.task else None,
            commitment=ReminderCommitmentResponse.of(reminder.commitment),
            title=reminder.title,
            description=reminder.description,
            enabled=reminder.enabled,
            start_date=schedule.start_date,
            time_of_day=schedule.time_of_day,
            timezone=schedule.timezone,
            recurrence=RecurrenceModel.of(schedule.recurrence),
            status=view.status,
            next_occurrence_at=view.next_occurrence_at,
            last_occurrence_at=reminder.last_occurrence_at,
            last_outcome=reminder.last_outcome,
            created_at=reminder.created_at,
            updated_at=reminder.updated_at,
        )


class ReminderListResponse(BaseModel):
    reminders: list[ReminderResponse]
    total: int = Field(description="Reminders matching the filters, across all pages.")


class UpcomingRemindersResponse(BaseModel):
    reminders: list[ReminderResponse]


class ReminderListParams(BaseModel):
    """Filters and paging for listing reminders, which come soonest first."""

    model_config = ConfigDict(extra="forbid")

    status: ReminderStatus | None = Field(default=None, description="Omit for every status.")
    task_id: uuid.UUID | None = Field(default=None, description="Only reminders about this task.")
    limit: int = Field(default=50, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    def to_query(self) -> ReminderQuery:
        return ReminderQuery(
            status=self.status, task_id=self.task_id, limit=self.limit, offset=self.offset
        )


class UpcomingRemindersParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=5, ge=1, le=UPCOMING_MAX_SIZE)


class CreateReminderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    description: Description = ""
    task_id: uuid.UUID | None = Field(
        default=None, description="A task in the same workspace, or omit for a standalone one."
    )
    enabled: bool = True
    start_date: StartDate
    time_of_day: TimeOfDay
    timezone: TimeZoneName | None = Field(
        default=None,
        description="Defaults to the user's time zone preference, or UTC without one.",
    )
    recurrence: RecurrenceModel | None = None

    def to_draft(self) -> ReminderDraft:
        return ReminderDraft(
            title=self.title,
            description=self.description,
            task_id=self.task_id,
            enabled=self.enabled,
            start_date=self.start_date,
            time_of_day=self.time_of_day,
            timezone=self.timezone,
            recurrence=self.recurrence.to_recurrence() if self.recurrence else None,
        )


class UpdateReminderRequest(BaseModel):
    """Change some of a reminder's fields. Omitted fields keep their values; `task_id: null`
    detaches the task and `recurrence: null` makes the reminder one-time. Changing the schedule
    or `enabled` replaces the pending occurrence."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    description: Description | None = None
    task_id: uuid.UUID | None = None
    enabled: bool | None = None
    start_date: StartDate | None = None
    time_of_day: TimeOfDay | None = None
    timezone: TimeZoneName | None = None
    recurrence: RecurrenceModel | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in ("title", "description", "enabled", "start_date", "time_of_day", "timezone"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> ReminderChanges:
        provided = self.model_fields_set
        return ReminderChanges(
            title=self.title if self.title is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            task_id=self.task_id if "task_id" in provided else UNSET,
            enabled=self.enabled if self.enabled is not None else UNSET,
            start_date=self.start_date if self.start_date is not None else UNSET,
            time_of_day=self.time_of_day if self.time_of_day is not None else UNSET,
            timezone=self.timezone if self.timezone is not None else UNSET,
            recurrence=(
                (self.recurrence.to_recurrence() if self.recurrence else None)
                if "recurrence" in provided
                else UNSET
            ),
        )
