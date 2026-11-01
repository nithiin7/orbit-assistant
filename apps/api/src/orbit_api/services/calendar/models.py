"""Calendar types: categories, events and their exceptions, occurrences, and preferences."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Final, Literal, get_args

from orbit_api.services.calendar.recurrence import EventRecurrence
from orbit_api.services.tasks.models import Task
from orbit_api.utils.changes import UNSET, Change

EventStatus = Literal["confirmed", "cancelled"]
# A small, fixed palette. The web app maps each name to theme-aware colors, so stored values are
# never CSS.
CategoryColor = Literal["blue", "green", "amber", "rose", "violet", "teal", "orange", "slate"]
CATEGORY_COLORS: Final[tuple[CategoryColor, ...]] = get_args(CategoryColor)
CalendarView = Literal["month", "week", "day", "agenda"]
CALENDAR_VIEWS: Final[tuple[CalendarView, ...]] = get_args(CalendarView)
# `this`: one occurrence; `following`: it and every later one (splitting the series); `series`:
# every occurrence.
EditScope = Literal["this", "following", "series"]

# Created for a workspace the first time it uses the calendar.
DEFAULT_CATEGORIES: Final[tuple[tuple[str, CategoryColor], ...]] = (
    ("Personal", "blue"),
    ("Work", "violet"),
    ("Meeting", "teal"),
    ("Appointment", "amber"),
    ("Birthday", "rose"),
    ("Travel", "green"),
    ("Other", "slate"),
)
MAX_CATEGORIES: Final = 50
MAX_ALERTS: Final = 5
# Four weeks.
MAX_ALERT_MINUTES: Final = 40_320
# All-day events are announced relative to this local time on their first day.
ALL_DAY_ALERT_TIME: Final = time(9, 0)


@dataclass(frozen=True, slots=True)
class Category:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    color: CategoryColor
    # Hidden categories' events are left out of calendar views (not of search).
    is_visible: bool
    position: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class CalendarEvent:
    """An event, or a recurring series of them. Times are naive local wall-clock times in
    `timezone`; all-day events run from midnight on their first day to midnight after their
    last."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    description: str
    location: str
    category_id: uuid.UUID | None
    all_day: bool
    timezone: str
    start: datetime
    end: datetime
    recurrence: EventRecurrence | None
    status: EventStatus
    # The series this one was split from by "this and following" edits, for grouping.
    series_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


ExceptionKind = Literal["skipped", "modified"]


@dataclass(frozen=True, slots=True)
class EventException:
    """One occurrence of a series, skipped or changed. Override fields that are `None` follow
    the series, so renaming the series renames every occurrence that wasn't renamed itself."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    event_id: uuid.UUID
    # The occurrence's original local start: its identity.
    original_start: datetime
    kind: ExceptionKind
    title: str | None = None
    description: str | None = None
    location: str | None = None
    category_id: uuid.UUID | None = None
    start: datetime | None = None
    end: datetime | None = None
    status: EventStatus | None = None


@dataclass(frozen=True, slots=True)
class EventOccurrence:
    """One occurrence of an event as a view shows it, with any exception applied."""

    event: CalendarEvent
    original_start: datetime
    title: str
    description: str
    location: str
    category_id: uuid.UUID | None
    status: EventStatus
    # Local wall-clock times in the event's time zone.
    start: datetime
    end: datetime
    # The same instants in UTC.
    start_at: datetime
    end_at: datetime
    # Changed by a single-occurrence edit.
    modified: bool


@dataclass(frozen=True, slots=True)
class EventAlert:
    id: uuid.UUID
    event_id: uuid.UUID
    minutes_before: int


@dataclass(frozen=True, slots=True)
class LinkedNote:
    id: uuid.UUID
    title: str
    note_type: str
    trashed: bool
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class EventDetail:
    event: CalendarEvent
    alerts: tuple[int, ...]
    notes: list[LinkedNote]
    tasks: list[Task]
    # The next occurrence that hasn't ended, or `None`.
    next_occurrence: EventOccurrence | None


@dataclass(frozen=True, slots=True)
class EventDraft:
    title: str
    start: datetime
    end: datetime
    # `None` uses the creator's time zone preference, or UTC.
    timezone: str | None = None
    all_day: bool = False
    description: str = ""
    location: str = ""
    category_id: uuid.UUID | None = None
    recurrence: EventRecurrence | None = None
    status: EventStatus = "confirmed"
    alerts: tuple[int, ...] = ()
    note_ids: tuple[uuid.UUID, ...] = ()
    task_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True, slots=True)
class EventChanges:
    """A partial update of a whole series (or a single event). `UNSET` leaves a field as it
    is."""

    title: Change[str] = UNSET
    description: Change[str] = UNSET
    location: Change[str] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET
    all_day: Change[bool] = UNSET
    timezone: Change[str] = UNSET
    start: Change[datetime] = UNSET
    end: Change[datetime] = UNSET
    recurrence: Change[EventRecurrence | None] = UNSET
    status: Change[EventStatus] = UNSET
    alerts: Change[tuple[int, ...]] = UNSET

    def touches_timing(self) -> bool:
        return any(
            value is not UNSET
            for value in (self.all_day, self.timezone, self.start, self.end, self.recurrence)
        )


@dataclass(frozen=True, slots=True)
class EventQuery:
    # Case-insensitive substring of the title, description, or location.
    search: str | None = None
    category_id: uuid.UUID | None = None
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True, slots=True)
class EventPage:
    events: list[CalendarEvent]
    total: int


@dataclass(frozen=True, slots=True)
class CalendarRange:
    """What a view shows for a date range: event occurrences and tasks."""

    occurrences: list[EventOccurrence]
    # Tasks with a scheduled time that overlaps the range.
    scheduled_tasks: list[Task]
    # Unscheduled tasks due on a date in the range.
    due_tasks: list[Task]


@dataclass(frozen=True, slots=True)
class AgendaItem:
    """An occurrence or a scheduled task, in agenda order."""

    start_at: datetime
    sort_key: str
    occurrence: EventOccurrence | None = None
    task: Task | None = None


@dataclass(frozen=True, slots=True)
class AgendaPage:
    items: list[AgendaItem]
    # Pass back as `cursor` for the next page; `None` when there is no more within the horizon.
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class CalendarPreferences:
    default_view: CalendarView = "month"
    # 0 is Sunday … 6 is Saturday; `None` follows the browser's locale.
    week_start: int | None = None
    working_hours_start: time = time(9, 0)
    working_hours_end: time = time(17, 0)
    show_completed_tasks: bool = True
    show_unscheduled_tasks: bool = True
    show_due_tasks: bool = True
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class OccurrenceChanges:
    """Changes to occurrences of a series. `UNSET` leaves a field as it is."""

    title: Change[str] = UNSET
    description: Change[str] = UNSET
    location: Change[str] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET
    start: Change[datetime] = UNSET
    end: Change[datetime] = UNSET
    status: Change[EventStatus] = UNSET


@dataclass(frozen=True, slots=True)
class DateWindow:
    """A range of local dates (`end` exclusive) in a viewer's time zone."""

    start: date
    end: date
    timezone: str
    include_tasks: bool = True
    include_completed_tasks: bool = True


class EventNotFoundError(Exception):
    """The event does not exist in this workspace."""


class OccurrenceNotFoundError(Exception):
    """The series has no occurrence with that original start."""


class CategoryNotFoundError(Exception):
    """The category does not exist in this workspace."""


class CategoryNameTakenError(Exception):
    """Another category in the workspace already has that name."""


class TooManyCategoriesError(Exception):
    """The workspace already has the maximum number of categories."""


class EventNoteNotFoundError(Exception):
    """The note to link does not exist in the event's workspace."""


class EventTaskNotFoundError(Exception):
    """The task to link or schedule does not exist in the event's workspace."""


class InvalidEventTimesError(ValueError):
    """The end is before the start, or an all-day event doesn't span whole days."""


class InvalidCursorError(ValueError):
    """An agenda cursor this API didn't issue."""
