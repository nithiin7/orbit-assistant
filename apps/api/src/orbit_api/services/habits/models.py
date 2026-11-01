"""Habit and routine types."""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Final, Literal, get_args

from orbit_api.services.calendar.models import LinkedNote
from orbit_api.services.habits.progress import DayState, LogEntry, Period, PeriodUnit
from orbit_api.services.habits.schedule import HabitSchedule, Pause, ScheduleVersion, Timeline
from orbit_api.services.reminders.recurrence import Weekday
from orbit_api.services.tasks.models import Task
from orbit_api.utils.changes import UNSET, Change

HabitKind = Literal["boolean", "numeric", "duration"]
HabitStatus = Literal["active", "paused", "archived"]
HabitColor = Literal["blue", "green", "amber", "rose", "violet", "teal", "orange", "slate"]
HABIT_COLORS: Final[tuple[HabitColor, ...]] = get_args(HabitColor)
# Icon names the web app knows how to draw; anything else is refused.
HabitIcon = Literal[
    "sparkles",
    "book",
    "dumbbell",
    "droplet",
    "brain",
    "moon",
    "sun",
    "heart",
    "leaf",
    "pen",
    "music",
    "coffee",
    "bike",
    "footprints",
    "wallet",
    "graduation",
    "briefcase",
    "smile",
]
HABIT_ICONS: Final[tuple[HabitIcon, ...]] = get_args(HabitIcon)
LogStatus = Literal["completed", "partial", "skipped"]
RoutineStatus = HabitStatus
SessionStatus = Literal["active", "completed", "abandoned"]
StepStatus = Literal["pending", "completed", "skipped"]

DEFAULT_CATEGORIES: Final[tuple[tuple[str, HabitColor, HabitIcon], ...]] = (
    ("Health", "rose", "heart"),
    ("Fitness", "orange", "dumbbell"),
    ("Learning", "violet", "graduation"),
    ("Productivity", "blue", "briefcase"),
    ("Personal", "teal", "smile"),
    ("Finance", "green", "wallet"),
    ("Lifestyle", "amber", "leaf"),
    ("Other", "slate", "sparkles"),
)
MAX_CATEGORIES: Final = 50
MAX_REMINDERS: Final = 5
MAX_STEPS: Final = 30
# How far ahead a reminder looks for the habit's or routine's next due day.
REMINDER_HORIZON_DAYS: Final = 400


@dataclass(frozen=True, slots=True)
class HabitCategory:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    color: HabitColor
    icon: HabitIcon
    position: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Habit:
    id: uuid.UUID
    workspace_id: uuid.UUID
    category_id: uuid.UUID | None
    name: str
    description: str
    icon: HabitIcon
    color: HabitColor
    kind: HabitKind
    # Numeric habits: the unit of `target` ("litres"). Duration targets are minutes.
    unit: str
    # The amount that completes a day: `None` for boolean habits (1).
    target: float | None
    # An optional time of day, for the calendar.
    time_of_day: time | None
    start_date: date
    end_date: date | None
    timezone: str
    status: HabitStatus
    versions: tuple[ScheduleVersion, ...]
    pauses: tuple[Pause, ...]
    created_at: datetime
    updated_at: datetime

    @property
    def daily_target(self) -> float:
        return 1.0 if self.target is None else self.target

    @property
    def schedule(self) -> HabitSchedule:
        return self.versions[-1].schedule

    @property
    def timeline(self) -> Timeline:
        return Timeline(self.start_date, self.end_date, self.versions, self.pauses)


@dataclass(frozen=True, slots=True)
class HabitLog:
    """The record of one habit on one local date."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    habit_id: uuid.UUID
    day: date
    value: float
    # The target when it was logged, so later target changes don't rewrite history.
    target: float
    skipped: bool
    note: str
    logged_at: datetime
    created_at: datetime
    updated_at: datetime

    @property
    def entry(self) -> LogEntry:
        return LogEntry(self.day, self.value, self.target, self.skipped)

    @property
    def status(self) -> LogStatus:
        entry = self.entry
        return "skipped" if entry.skipped else "completed" if entry.completed else "partial"


@dataclass(frozen=True, slots=True)
class HabitReminder:
    """A reminder time for a habit or a routine (exactly one). It manages one reminder
    (`reminders.habit_reminder_id`), kept pointed at the next due day it applies to."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    habit_id: uuid.UUID | None
    routine_id: uuid.UUID | None
    time_of_day: time
    # Only on these weekdays; empty means every due day.
    weekdays: frozenset[Weekday]


@dataclass(frozen=True, slots=True)
class ReminderTime:
    time_of_day: time
    weekdays: frozenset[Weekday] = frozenset()


@dataclass(frozen=True, slots=True)
class HabitProgress:
    """A habit as of a day: that day's state and entry, its streaks, and its rates."""

    habit: Habit
    day: date
    state: DayState
    log: HabitLog | None
    # The period containing `day`: its week for weekly targets, else the day (if due).
    period: Period | None
    # Fixed-day schedules: this week's due days met and due. Weekly targets: the period's.
    week_done: int
    week_due: int
    current_streak: int
    longest_streak: int
    streak_unit: PeriodUnit
    total_completions: int
    completion_rate: float | None
    # Over the last 7 and 30 days.
    weekly_rate: float | None
    monthly_rate: float | None


@dataclass(frozen=True, slots=True)
class HabitDetail:
    progress: HabitProgress
    reminders: list[HabitReminder]
    tasks: list[Task]
    notes: list[LinkedNote]


@dataclass(frozen=True, slots=True)
class HabitDay:
    day: date
    state: DayState
    log: HabitLog | None


@dataclass(frozen=True, slots=True)
class HabitHistory:
    habit: Habit
    days: list[HabitDay]
    periods: list[Period]


@dataclass(frozen=True, slots=True)
class HabitDraft:
    name: str
    kind: HabitKind
    schedule: HabitSchedule
    start_date: date
    # `None` uses the creator's time zone preference, or UTC.
    timezone: str | None
    description: str = ""
    category_id: uuid.UUID | None = None
    icon: HabitIcon = "sparkles"
    color: HabitColor = "blue"
    unit: str = ""
    target: float | None = None
    time_of_day: time | None = None
    end_date: date | None = None
    reminders: tuple[ReminderTime, ...] = ()


@dataclass(frozen=True, slots=True)
class HabitChanges:
    """A partial update. A new `schedule` takes effect from `schedule_from` (today by default);
    days before it keep their schedule. `status` pauses, resumes, archives, or restores."""

    name: Change[str] = UNSET
    description: Change[str] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET
    icon: Change[HabitIcon] = UNSET
    color: Change[HabitColor] = UNSET
    unit: Change[str] = UNSET
    target: Change[float | None] = UNSET
    time_of_day: Change[time | None] = UNSET
    start_date: Change[date] = UNSET
    end_date: Change[date | None] = UNSET
    timezone: Change[str] = UNSET
    status: Change[HabitStatus] = UNSET
    schedule: Change[HabitSchedule] = UNSET
    schedule_from: date | None = None


@dataclass(frozen=True, slots=True)
class LogDraft:
    """What to record for a day. `value` is ignored when skipping; boolean habits use 1."""

    status: Literal["completed", "progress", "skipped"]
    value: float | None = None
    note: str = ""


@dataclass(frozen=True, slots=True)
class RoutineStep:
    id: uuid.UUID
    position: int
    name: str
    description: str
    duration_minutes: int | None
    habit_id: uuid.UUID | None
    task_id: uuid.UUID | None
    note_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class StepDraft:
    """A step in a routine edit. `id` keeps an existing step; `None` adds one."""

    name: str
    id: uuid.UUID | None = None
    description: str = ""
    duration_minutes: int | None = None
    habit_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    note_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class Routine:
    id: uuid.UUID
    workspace_id: uuid.UUID
    category_id: uuid.UUID | None
    name: str
    description: str
    icon: HabitIcon
    color: HabitColor
    time_of_day: time | None
    # The weekdays it applies to; empty means every day.
    weekdays: frozenset[Weekday]
    timezone: str
    status: RoutineStatus
    steps: tuple[RoutineStep, ...]
    created_at: datetime
    updated_at: datetime

    @property
    def estimated_minutes(self) -> int:
        return sum(step.duration_minutes or 0 for step in self.steps)


@dataclass(frozen=True, slots=True)
class RoutineDraft:
    name: str
    timezone: str | None
    description: str = ""
    category_id: uuid.UUID | None = None
    icon: HabitIcon = "sun"
    color: HabitColor = "amber"
    time_of_day: time | None = None
    weekdays: frozenset[Weekday] = frozenset()
    steps: tuple[StepDraft, ...] = ()
    reminders: tuple[ReminderTime, ...] = ()


@dataclass(frozen=True, slots=True)
class RoutineChanges:
    name: Change[str] = UNSET
    description: Change[str] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET
    icon: Change[HabitIcon] = UNSET
    color: Change[HabitColor] = UNSET
    time_of_day: Change[time | None] = UNSET
    weekdays: Change[frozenset[Weekday]] = UNSET
    timezone: Change[str] = UNSET
    status: Change[RoutineStatus] = UNSET
    # The whole ordered list: steps left out are removed.
    steps: Change[tuple[StepDraft, ...]] = UNSET


@dataclass(frozen=True, slots=True)
class SessionStep:
    """A step as it was when the session started: a copy, so editing the routine later leaves
    the session's history as it was."""

    id: uuid.UUID
    position: int
    name: str
    duration_minutes: int | None
    habit_id: uuid.UUID | None
    task_id: uuid.UUID | None
    status: StepStatus
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class RoutineSession:
    id: uuid.UUID
    workspace_id: uuid.UUID
    routine_id: uuid.UUID
    day: date
    routine_name: str
    status: SessionStatus
    started_at: datetime
    finished_at: datetime | None
    notes: str
    note_id: uuid.UUID | None
    steps: tuple[SessionStep, ...] = field(default=())


@dataclass(frozen=True, slots=True)
class RoutineDetail:
    routine: Routine
    reminders: list[HabitReminder]
    active_session: RoutineSession | None
    last_session: RoutineSession | None
    sessions_completed: int


@dataclass(frozen=True, slots=True)
class CalendarEntry:
    """A habit or routine on the calendar on one day: a schedule, not an appointment."""

    kind: Literal["habit", "routine"]
    id: uuid.UUID
    title: str
    color: HabitColor
    icon: HabitIcon
    day: date
    start_at: datetime
    end_at: datetime
    # Habits: the day's state. Routines: `completed` once a session finished that day.
    state: DayState | None


@dataclass(frozen=True, slots=True)
class TrendPoint:
    start: date
    end: date
    met: int
    missed: int

    @property
    def rate(self) -> float | None:
        return None if self.met + self.missed == 0 else self.met / (self.met + self.missed)


@dataclass(frozen=True, slots=True)
class HeatmapDay:
    day: date
    # Fixed-day occurrences due that day, and how many of them were completed.
    due: int
    completed: int
    # Completions not tied to a due day: weekly-target days and extra days.
    extra: int


@dataclass(frozen=True, slots=True)
class HabitPerformance:
    habit: Habit
    met: int
    missed: int
    completions: int
    current_streak: int
    longest_streak: int
    streak_unit: PeriodUnit
    # The rate in the range's second half minus its first, when both have data.
    trend: float | None

    @property
    def rate(self) -> float | None:
        return None if self.met + self.missed == 0 else self.met / (self.met + self.missed)


@dataclass(frozen=True, slots=True)
class CategoryPerformance:
    category: HabitCategory | None
    met: int
    missed: int


@dataclass(frozen=True, slots=True)
class HabitAnalytics:
    start: date
    end: date
    heatmap: list[HeatmapDay]
    weekly: list[TrendPoint]
    monthly: list[TrendPoint]
    habits: list[HabitPerformance]
    categories: list[CategoryPerformance]


class HabitNotFoundError(Exception):
    """The habit does not exist in this workspace."""


class RoutineNotFoundError(Exception):
    """The routine does not exist in this workspace."""


class SessionNotFoundError(Exception):
    """The session, or its step, does not exist."""


class HabitCategoryNotFoundError(Exception):
    """The category does not exist in this workspace."""


class HabitCategoryNameTakenError(Exception):
    """Another category in the workspace has that name."""


class TooManyHabitCategoriesError(Exception):
    """The workspace has `MAX_CATEGORIES` categories."""


class LinkedItemNotFoundError(Exception):
    """A linked habit, task, or note doesn't exist in this workspace."""

    def __init__(self, kind: Literal["habit", "task", "note"]) -> None:
        super().__init__(kind)
        self.kind = kind


class InvalidHabitError(ValueError):
    """The habit's fields don't fit together, such as a numeric habit without a target."""


class InvalidLogError(ValueError):
    """The day can't be logged: before the habit started, in the future, or a bad value."""


class ActiveSessionExistsError(Exception):
    """The routine already has a session in progress."""

    def __init__(self, session_id: uuid.UUID) -> None:
        super().__init__(str(session_id))
        self.session_id = session_id


class SessionFinishedError(Exception):
    """The session is already completed or abandoned."""


@dataclass(frozen=True, slots=True)
class UpcomingDay:
    day: date
    # Habits with fixed days due then.
    habit_ids: list[uuid.UUID]


@dataclass(frozen=True, slots=True)
class TodayView:
    day: date
    # Every habit that isn't archived, as of `day`.
    habits: list[HabitProgress]
    # Monday to Sunday of `day`'s week.
    week: list[HeatmapDay]
    # The seven days after `day`.
    upcoming: list[UpcomingDay]
