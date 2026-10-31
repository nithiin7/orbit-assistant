"""Calendar models: categories, events and occurrences, ranges, the agenda, and preferences."""

import uuid
from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import SearchText, TimeZoneName, multi_line, single_line
from orbit_api.schemas.tasks import TaskResponse
from orbit_api.services.calendar.models import (
    MAX_ALERT_MINUTES,
    MAX_ALERTS,
    AgendaItem,
    CalendarEvent,
    CalendarPreferences,
    CalendarRange,
    CalendarView,
    Category,
    CategoryColor,
    DateWindow,
    EditScope,
    EventChanges,
    EventDetail,
    EventDraft,
    EventOccurrence,
    EventQuery,
    EventStatus,
    LinkedNote,
    OccurrenceChanges,
)
from orbit_api.services.calendar.occurrences import occurrence_key
from orbit_api.services.calendar.recurrence import (
    MAX_COUNT,
    MAX_INTERVAL,
    EventFrequency,
    EventRecurrence,
    InvalidEventRecurrenceError,
)
from orbit_api.services.reminders.recurrence import WEEKDAYS, Weekday
from orbit_api.utils.changes import UNSET

EARLIEST_YEAR = 2000
LATEST_YEAR = 2200
MAX_RANGE_DAYS = 92
MAX_LINKS = 20
PAGE_MAX_SIZE = 100

Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(single_line),
]
Description = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=5000),
    AfterValidator(multi_line),
]
Location = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=200),
    AfterValidator(single_line),
]
CategoryName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
    AfterValidator(single_line),
]
AlertMinutes = Annotated[int, Field(ge=0, le=MAX_ALERT_MINUTES)]


def _local_minute(value: datetime) -> datetime:
    if value.tzinfo is not None:
        raise ValueError("must be a local date and time without an offset; set `timezone`")
    if value.second or value.microsecond:
        raise ValueError("must be a whole minute, such as 2026-11-02T09:30")
    if not EARLIEST_YEAR <= value.year <= LATEST_YEAR:
        raise ValueError(f"must be between {EARLIEST_YEAR} and {LATEST_YEAR}")
    return value


def _reasonable_date(value: date) -> date:
    if not EARLIEST_YEAR <= value.year <= LATEST_YEAR:
        raise ValueError(f"must be between {EARLIEST_YEAR} and {LATEST_YEAR}")
    return value


# A wall-clock date and time in the event's time zone, such as `2026-11-02T09:30`.
LocalDateTime = Annotated[datetime, AfterValidator(_local_minute)]
CalendarDate = Annotated[date, AfterValidator(_reasonable_date)]


class RecurrenceRuleModel(BaseModel):
    """How a series repeats: every `interval` days, weeks, months, or years. Ends after `count`
    occurrences, on `until` (inclusive), or never."""

    model_config = ConfigDict(extra="forbid")

    frequency: EventFrequency
    interval: int = Field(default=1, ge=1, le=MAX_INTERVAL)
    weekdays: list[Weekday] = Field(
        default_factory=list[Weekday],
        description="Weekly rules only: the days it repeats on, including the start's weekday.",
    )
    count: int | None = Field(default=None, ge=1, le=MAX_COUNT)
    until: CalendarDate | None = None

    def to_rule(self) -> EventRecurrence:
        try:
            return EventRecurrence(
                frequency=self.frequency,
                interval=self.interval,
                weekdays=frozenset(self.weekdays),
                count=self.count,
                until=self.until,
            )
        except InvalidEventRecurrenceError as exc:
            raise ValueError(str(exc)) from None

    @model_validator(mode="after")
    def _check(self) -> Self:
        self.to_rule()
        return self

    @classmethod
    def of(cls, rule: EventRecurrence | None) -> "RecurrenceRuleModel | None":
        if rule is None:
            return None
        return cls(
            frequency=rule.frequency,
            interval=rule.interval,
            weekdays=[day for day in WEEKDAYS if day in rule.weekdays],
            count=rule.count,
            until=rule.until,
        )


class CalendarCategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: CategoryColor
    is_visible: bool = Field(description="Hidden categories' events are left out of views.")
    position: int

    @classmethod
    def of(cls, category: Category) -> "CalendarCategoryResponse":
        return cls(
            id=category.id,
            name=category.name,
            color=category.color,
            is_visible=category.is_visible,
            position=category.position,
        )


class CalendarCategoryListResponse(BaseModel):
    categories: list[CalendarCategoryResponse]


class CreateCalendarCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName
    color: CategoryColor = "blue"


class UpdateCalendarCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName | None = None
    color: CategoryColor | None = None
    is_visible: bool | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class EventResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    description: str
    location: str
    category_id: uuid.UUID | None
    all_day: bool
    timezone: str = Field(description="The IANA time zone `start` and `end` are in.")
    start: datetime = Field(description="Local wall-clock time, without an offset.")
    end: datetime = Field(
        description="Local wall-clock time. For all-day events, midnight after the last day."
    )
    recurrence: RecurrenceRuleModel | None
    status: EventStatus
    series_id: uuid.UUID | None = Field(
        description="The series a 'this and following' edit split this event from."
    )
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, event: CalendarEvent) -> "EventResponse":
        return cls(
            id=event.id,
            workspace_id=event.workspace_id,
            title=event.title,
            description=event.description,
            location=event.location,
            category_id=event.category_id,
            all_day=event.all_day,
            timezone=event.timezone,
            start=event.start,
            end=event.end,
            recurrence=RecurrenceRuleModel.of(event.recurrence),
            status=event.status,
            series_id=event.series_id,
            created_at=event.created_at,
            updated_at=event.updated_at,
        )


class OccurrenceResponse(BaseModel):
    id: str = Field(description="Stable: the event's ID and the original start.")
    event_id: uuid.UUID
    original_start: datetime = Field(
        description="The occurrence's original local start: its identity within the series."
    )
    title: str
    description: str
    location: str
    category_id: uuid.UUID | None
    status: EventStatus
    all_day: bool
    timezone: str
    start: datetime = Field(description="Local wall-clock time in `timezone`.")
    end: datetime
    start_at: datetime = Field(description="The start as a UTC instant.")
    end_at: datetime
    recurring: bool
    modified: bool = Field(description="Changed by a single-occurrence edit.")

    @classmethod
    def of(cls, occurrence: EventOccurrence) -> "OccurrenceResponse":
        event = occurrence.event
        return cls(
            id=occurrence_key(occurrence),
            event_id=event.id,
            original_start=occurrence.original_start,
            title=occurrence.title,
            description=occurrence.description,
            location=occurrence.location,
            category_id=occurrence.category_id,
            status=occurrence.status,
            all_day=event.all_day,
            timezone=event.timezone,
            start=occurrence.start,
            end=occurrence.end,
            start_at=occurrence.start_at,
            end_at=occurrence.end_at,
            recurring=event.recurrence is not None,
            modified=occurrence.modified,
        )


class LinkedNoteResponse(BaseModel):
    id: uuid.UUID
    title: str
    note_type: str
    trashed: bool
    updated_at: datetime

    @classmethod
    def of(cls, note: LinkedNote) -> "LinkedNoteResponse":
        return cls(
            id=note.id,
            title=note.title,
            note_type=note.note_type,
            trashed=note.trashed,
            updated_at=note.updated_at,
        )


class EventDetailResponse(EventResponse):
    alerts: list[int] = Field(description="Minutes before each occurrence to notify.")
    notes: list[LinkedNoteResponse]
    tasks: list[TaskResponse]
    next_occurrence: OccurrenceResponse | None = Field(
        description="The next occurrence that hasn't ended, within about a year."
    )

    @classmethod
    def of_detail(cls, detail: EventDetail) -> "EventDetailResponse":
        base = EventResponse.of(detail.event)
        return cls(
            **base.model_dump(),
            alerts=list(detail.alerts),
            notes=[LinkedNoteResponse.of(note) for note in detail.notes],
            tasks=[TaskResponse.of(task) for task in detail.tasks],
            next_occurrence=(
                OccurrenceResponse.of(detail.next_occurrence) if detail.next_occurrence else None
            ),
        )


class EventListResponse(BaseModel):
    events: list[EventResponse]
    total: int


class EventListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: SearchText = Field(default=None, description="Text to find in titles, notes, or places.")
    category_id: uuid.UUID | None = None
    limit: int = Field(default=50, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    def to_query(self) -> EventQuery:
        return EventQuery(
            search=self.q, category_id=self.category_id, limit=self.limit, offset=self.offset
        )


def _alerts(values: list[int]) -> list[int]:
    if len(set(values)) > MAX_ALERTS:
        raise ValueError(f"an event can have at most {MAX_ALERTS} alerts")
    return sorted(set(values))


Alerts = Annotated[list[AlertMinutes], AfterValidator(_alerts)]


class CreateEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    start: LocalDateTime
    end: LocalDateTime
    timezone: TimeZoneName | None = Field(
        default=None, description="Defaults to the user's time zone preference, else UTC."
    )
    all_day: bool = Field(
        default=False, description="All-day events run from midnight to midnight (`end`)."
    )
    description: Description = ""
    location: Location = ""
    category_id: uuid.UUID | None = None
    recurrence: RecurrenceRuleModel | None = None
    status: EventStatus = "confirmed"
    alerts: Alerts = Field(default_factory=list[int])
    note_ids: list[uuid.UUID] = Field(default_factory=list[uuid.UUID], max_length=MAX_LINKS)
    task_ids: list[uuid.UUID] = Field(default_factory=list[uuid.UUID], max_length=MAX_LINKS)

    def to_draft(self) -> EventDraft:
        return EventDraft(
            title=self.title,
            start=self.start,
            end=self.end,
            timezone=self.timezone,
            all_day=self.all_day,
            description=self.description,
            location=self.location,
            category_id=self.category_id,
            recurrence=self.recurrence.to_rule() if self.recurrence else None,
            status=self.status,
            alerts=tuple(self.alerts),
            note_ids=tuple(self.note_ids),
            task_ids=tuple(self.task_ids),
        )


class UpdateEventRequest(BaseModel):
    """Change the whole event or series. Omitted fields keep their values; `category_id: null`
    clears the category and `recurrence: null` makes the series a single event."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    description: Description | None = None
    location: Location | None = None
    category_id: uuid.UUID | None = None
    all_day: bool | None = None
    timezone: TimeZoneName | None = None
    start: LocalDateTime | None = None
    end: LocalDateTime | None = None
    recurrence: RecurrenceRuleModel | None = None
    status: EventStatus | None = None
    alerts: Alerts | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set - {"category_id", "recurrence"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> EventChanges:
        provided = self.model_fields_set
        return EventChanges(
            title=self.title if self.title is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            location=self.location if self.location is not None else UNSET,
            category_id=self.category_id if "category_id" in provided else UNSET,
            all_day=self.all_day if self.all_day is not None else UNSET,
            timezone=self.timezone if self.timezone is not None else UNSET,
            start=self.start if self.start is not None else UNSET,
            end=self.end if self.end is not None else UNSET,
            recurrence=(
                (self.recurrence.to_rule() if self.recurrence else None)
                if "recurrence" in provided
                else UNSET
            ),
            status=self.status if self.status is not None else UNSET,
            alerts=tuple(self.alerts) if self.alerts is not None else UNSET,
        )


class UpdateOccurrenceRequest(BaseModel):
    """Change one occurrence (`this`), it and every later one (`following`), or the whole series
    (`series`). Moving or resizing an occurrence with `series` moves or resizes them all."""

    model_config = ConfigDict(extra="forbid")

    scope: EditScope = "this"
    title: Title | None = None
    description: Description | None = None
    location: Location | None = None
    category_id: uuid.UUID | None = None
    start: LocalDateTime | None = None
    end: LocalDateTime | None = None
    status: EventStatus | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set - {"scope"}:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set - {"scope", "category_id"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> OccurrenceChanges:
        provided = self.model_fields_set
        return OccurrenceChanges(
            title=self.title if self.title is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            location=self.location if self.location is not None else UNSET,
            category_id=self.category_id if "category_id" in provided else UNSET,
            start=self.start if self.start is not None else UNSET,
            end=self.end if self.end is not None else UNSET,
            status=self.status if self.status is not None else UNSET,
        )


class DeleteOccurrenceParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: EditScope = "this"


class CreateEventNoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title | None = Field(
        default=None, description="Defaults to the event's title and the occurrence's date."
    )
    occurrence_start: LocalDateTime | None = Field(
        default=None, description="The occurrence the notes are for, to date the title."
    )


class CalendarRangeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate = Field(description="The first local date.")
    end: CalendarDate = Field(description="The day after the last local date (exclusive).")
    timezone: TimeZoneName | None = Field(
        default=None,
        description="The viewer's time zone, which decides where days begin. Defaults to the "
        "user's preference, else UTC.",
    )
    include_tasks: bool = True
    include_completed_tasks: bool = True

    @model_validator(mode="after")
    def _check_range(self) -> Self:
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.end - self.start > timedelta(days=MAX_RANGE_DAYS):
            raise ValueError(f"a range can span at most {MAX_RANGE_DAYS} days")
        return self

    def to_window(self, default_timezone: str | None) -> DateWindow:
        return DateWindow(
            start=self.start,
            end=self.end,
            timezone=self.timezone or default_timezone or "UTC",
            include_tasks=self.include_tasks,
            include_completed_tasks=self.include_completed_tasks,
        )


class CalendarRangeResponse(BaseModel):
    occurrences: list[OccurrenceResponse]
    scheduled_tasks: list[TaskResponse] = Field(
        description="Tasks whose scheduled time overlaps the range."
    )
    due_tasks: list[TaskResponse] = Field(
        description="Tasks without a scheduled time, due on a date in the range."
    )

    @classmethod
    def of(cls, result: CalendarRange) -> "CalendarRangeResponse":
        return cls(
            occurrences=[OccurrenceResponse.of(item) for item in result.occurrences],
            scheduled_tasks=[TaskResponse.of(task) for task in result.scheduled_tasks],
            due_tasks=[TaskResponse.of(task) for task in result.due_tasks],
        )


class AgendaParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: AwareDatetime | None = Field(
        default=None, description="Show what hasn't ended by this instant. Defaults to now."
    )
    limit: int = Field(default=20, ge=1, le=PAGE_MAX_SIZE)
    cursor: str | None = Field(
        default=None, max_length=300, description="`next_cursor` from the previous page."
    )
    include_tasks: bool = True


class AgendaItemResponse(BaseModel):
    kind: Literal["event", "task"]
    start_at: datetime
    occurrence: OccurrenceResponse | None
    task: TaskResponse | None

    @classmethod
    def of(cls, item: AgendaItem) -> "AgendaItemResponse":
        return cls(
            kind="event" if item.occurrence else "task",
            start_at=item.start_at,
            occurrence=OccurrenceResponse.of(item.occurrence) if item.occurrence else None,
            task=TaskResponse.of(item.task) if item.task else None,
        )


class AgendaResponse(BaseModel):
    items: list[AgendaItemResponse]
    next_cursor: str | None = Field(description="Pass as `cursor` for more; `null` at the end.")


def _whole_minute(value: time) -> time:
    if value.tzinfo is not None or value.second or value.microsecond:
        raise ValueError("must be a whole minute without a time zone, such as 09:00")
    return value


class CalendarPreferencesModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_view: CalendarView = "month"
    week_start: int | None = Field(
        default=None, ge=0, le=6, description="0 is Sunday; `null` follows the browser's locale."
    )
    working_hours_start: Annotated[time, AfterValidator(_whole_minute)] = time(9, 0)
    working_hours_end: Annotated[time, AfterValidator(_whole_minute)] = time(17, 0)
    show_completed_tasks: bool = True
    show_unscheduled_tasks: bool = True
    show_due_tasks: bool = True

    @model_validator(mode="after")
    def _check_hours(self) -> Self:
        if self.working_hours_end <= self.working_hours_start:
            raise ValueError("working hours must end after they start")
        return self

    def to_preferences(self) -> CalendarPreferences:
        return CalendarPreferences(
            default_view=self.default_view,
            week_start=self.week_start,
            working_hours_start=self.working_hours_start,
            working_hours_end=self.working_hours_end,
            show_completed_tasks=self.show_completed_tasks,
            show_unscheduled_tasks=self.show_unscheduled_tasks,
            show_due_tasks=self.show_due_tasks,
        )


class CalendarPreferencesResponse(CalendarPreferencesModel):
    updated_at: datetime | None = Field(description="`null` until the user saves preferences.")

    @classmethod
    def of(cls, preferences: CalendarPreferences) -> "CalendarPreferencesResponse":
        return cls(
            default_view=preferences.default_view,
            week_start=preferences.week_start,
            working_hours_start=preferences.working_hours_start,
            working_hours_end=preferences.working_hours_end,
            show_completed_tasks=preferences.show_completed_tasks,
            show_unscheduled_tasks=preferences.show_unscheduled_tasks,
            show_due_tasks=preferences.show_due_tasks,
            updated_at=preferences.updated_at,
        )
