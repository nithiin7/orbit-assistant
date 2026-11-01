"""Habit and routine models: categories, habits and schedules, the log, progress, the Today
view, history, analytics, calendar entries, reminder times, routines, and sessions."""

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.calendar import CalendarDate, LinkedNoteResponse
from orbit_api.schemas.common import TimeZoneName, multi_line, single_line
from orbit_api.schemas.tasks import TaskResponse
from orbit_api.services.habits.models import (
    MAX_REMINDERS,
    MAX_STEPS,
    CalendarEntry,
    CategoryPerformance,
    Habit,
    HabitAnalytics,
    HabitCategory,
    HabitChanges,
    HabitColor,
    HabitDay,
    HabitDetail,
    HabitDraft,
    HabitHistory,
    HabitIcon,
    HabitKind,
    HabitLog,
    HabitPerformance,
    HabitProgress,
    HabitReminder,
    HabitStatus,
    HeatmapDay,
    LogDraft,
    LogStatus,
    ReminderTime,
    Routine,
    RoutineChanges,
    RoutineDetail,
    RoutineDraft,
    RoutineSession,
    RoutineStep,
    SessionStatus,
    SessionStep,
    StepDraft,
    StepStatus,
    TodayView,
    TrendPoint,
)
from orbit_api.services.habits.progress import DayState, Period, PeriodState, PeriodUnit
from orbit_api.services.habits.schedule import (
    MAX_EVERY,
    HabitSchedule,
    InvalidScheduleError,
    ScheduleType,
)
from orbit_api.services.reminders.recurrence import WEEKDAYS, Weekday
from orbit_api.utils.changes import UNSET

PAGE_MAX_SIZE = 100

HabitName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(single_line),
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(multi_line)
]
CategoryName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
    AfterValidator(single_line),
]
Unit = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=20), AfterValidator(single_line)
]
LogNote = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=1000), AfterValidator(multi_line)
]
SessionNotes = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=5000), AfterValidator(multi_line)
]
Target = Annotated[float, Field(gt=0, le=1_000_000)]
Minutes = Annotated[int, Field(ge=1, le=1440)]


def _whole_minute(value: time) -> time:
    if value.tzinfo is not None or value.second or value.microsecond:
        raise ValueError("must be a whole minute without a time zone, such as 07:30")
    return value


TimeOfDay = Annotated[time, AfterValidator(_whole_minute)]
StatusFilter = Literal["active", "paused", "archived", "all"]


def _statuses(value: StatusFilter) -> tuple[HabitStatus, ...] | None:
    return None if value == "all" else (value,)


def _ordered(days: list[Weekday]) -> list[Weekday]:
    return [day for day in WEEKDAYS if day in days]


# Categories


class HabitCategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: HabitColor
    icon: HabitIcon
    position: int

    @classmethod
    def of(cls, category: HabitCategory) -> "HabitCategoryResponse":
        return cls(
            id=category.id,
            name=category.name,
            color=category.color,
            icon=category.icon,
            position=category.position,
        )


class HabitCategoryListResponse(BaseModel):
    categories: list[HabitCategoryResponse]


class CreateHabitCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName
    color: HabitColor = "slate"
    icon: HabitIcon = "sparkles"


class UpdateHabitCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName | None = None
    color: HabitColor | None = None
    icon: HabitIcon | None = None


# Schedules and reminder times


class HabitScheduleModel(BaseModel):
    """`daily` every `every` days; `weekdays` on `weekdays`; `monthly` on `month_days` (a day a
    month lacks falls on its last day); `weekly_target` any `times_per_week` days of each
    Monday-to-Sunday week."""

    model_config = ConfigDict(extra="forbid")

    type: ScheduleType
    every: int = Field(default=1, ge=1, le=MAX_EVERY)
    weekdays: list[Weekday] = Field(default_factory=list[Weekday])
    month_days: list[Annotated[int, Field(ge=1, le=31)]] = Field(default_factory=list[int])
    times_per_week: int = Field(default=0, ge=0, le=7)

    @model_validator(mode="after")
    def _check(self) -> Self:
        try:
            self.to_schedule()
        except InvalidScheduleError as exc:
            raise ValueError(str(exc)) from None
        return self

    def to_schedule(self) -> HabitSchedule:
        return HabitSchedule(
            type=self.type,
            every=self.every,
            weekdays=frozenset(self.weekdays),
            month_days=frozenset(self.month_days),
            times_per_week=self.times_per_week,
        )

    @classmethod
    def of(cls, schedule: HabitSchedule) -> "HabitScheduleModel":
        return cls(
            type=schedule.type,
            every=schedule.every,
            weekdays=_ordered(list(schedule.weekdays)),
            month_days=sorted(schedule.month_days),
            times_per_week=schedule.times_per_week,
        )


class HabitReminderTimeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time: TimeOfDay = Field(description="Local time in the habit's or routine's time zone.")
    weekdays: list[Weekday] = Field(
        default_factory=list[Weekday],
        description="Only on these weekdays; empty means every day it's due.",
    )

    def to_time(self) -> ReminderTime:
        return ReminderTime(time_of_day=self.time, weekdays=frozenset(self.weekdays))


class HabitReminderTimeResponse(HabitReminderTimeModel):
    id: uuid.UUID

    @classmethod
    def of(cls, reminder: HabitReminder) -> "HabitReminderTimeResponse":
        return cls(
            id=reminder.id,
            time=reminder.time_of_day,
            weekdays=_ordered(list(reminder.weekdays)),
        )


Reminders = Annotated[list[HabitReminderTimeModel], Field(max_length=MAX_REMINDERS)]


class SetHabitRemindersRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reminders: Reminders


# Habits


class HabitScheduleVersionResponse(BaseModel):
    effective_from: date
    schedule: HabitScheduleModel


class HabitPauseResponse(BaseModel):
    start: date
    end: date | None = Field(description="The day tracking resumed; `null` while paused.")


class HabitResponse(BaseModel):
    id: uuid.UUID
    category_id: uuid.UUID | None
    name: str
    description: str
    icon: HabitIcon
    color: HabitColor
    kind: HabitKind
    unit: str
    target: float | None = Field(description="`null` for yes-or-no habits. Minutes for duration.")
    time_of_day: time | None
    start_date: date
    end_date: date | None
    timezone: str
    status: HabitStatus
    schedule: HabitScheduleModel
    schedule_history: list[HabitScheduleVersionResponse]
    pauses: list[HabitPauseResponse]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, habit: Habit) -> "HabitResponse":
        return cls(
            id=habit.id,
            category_id=habit.category_id,
            name=habit.name,
            description=habit.description,
            icon=habit.icon,
            color=habit.color,
            kind=habit.kind,
            unit=habit.unit,
            target=habit.target,
            time_of_day=habit.time_of_day,
            start_date=habit.start_date,
            end_date=habit.end_date,
            timezone=habit.timezone,
            status=habit.status,
            schedule=HabitScheduleModel.of(habit.schedule),
            schedule_history=[
                HabitScheduleVersionResponse(
                    effective_from=v.effective_from, schedule=HabitScheduleModel.of(v.schedule)
                )
                for v in habit.versions
            ],
            pauses=[HabitPauseResponse(start=p.start, end=p.end) for p in habit.pauses],
            created_at=habit.created_at,
            updated_at=habit.updated_at,
        )


class HabitLogResponse(BaseModel):
    day: date
    value: float
    target: float = Field(description="The target when the day was logged.")
    status: LogStatus
    note: str
    logged_at: datetime

    @classmethod
    def of(cls, log: HabitLog | None) -> "HabitLogResponse | None":
        if log is None:
            return None
        return cls(
            day=log.day,
            value=log.value,
            target=log.target,
            status=log.status,
            note=log.note,
            logged_at=log.logged_at,
        )


class HabitPeriodResponse(BaseModel):
    unit: PeriodUnit
    start: date
    end: date
    state: PeriodState
    done: int
    required: int

    @classmethod
    def of(cls, period: Period | None) -> "HabitPeriodResponse | None":
        if period is None:
            return None
        return cls(
            unit=period.unit,
            start=period.start,
            end=period.end,
            state=period.state,
            done=period.done,
            required=period.required,
        )


class HabitProgressResponse(BaseModel):
    habit: HabitResponse
    day: date
    state: DayState
    log: HabitLogResponse | None
    period: HabitPeriodResponse | None = Field(
        description="The day (if due), or its week for weekly targets."
    )
    week_done: int
    week_due: int
    current_streak: int
    longest_streak: int
    streak_unit: PeriodUnit
    total_completions: int
    completion_rate: float | None = Field(description="0 to 1; `null` when nothing was due.")
    weekly_rate: float | None = Field(description="Over the last 7 days.")
    monthly_rate: float | None = Field(description="Over the last 30 days.")

    @classmethod
    def of(cls, item: HabitProgress) -> "HabitProgressResponse":
        return cls(
            habit=HabitResponse.of(item.habit),
            day=item.day,
            state=item.state,
            log=HabitLogResponse.of(item.log),
            period=HabitPeriodResponse.of(item.period),
            week_done=item.week_done,
            week_due=item.week_due,
            current_streak=item.current_streak,
            longest_streak=item.longest_streak,
            streak_unit=item.streak_unit,
            total_completions=item.total_completions,
            completion_rate=item.completion_rate,
            weekly_rate=item.weekly_rate,
            monthly_rate=item.monthly_rate,
        )


class HabitListResponse(BaseModel):
    habits: list[HabitProgressResponse]


class HabitListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StatusFilter = "active"

    def statuses(self) -> tuple[HabitStatus, ...] | None:
        return _statuses(self.status)


class HabitDetailResponse(HabitProgressResponse):
    reminders: list[HabitReminderTimeResponse]
    tasks: list[TaskResponse]
    notes: list[LinkedNoteResponse]

    @classmethod
    def of_detail(cls, detail: HabitDetail) -> "HabitDetailResponse":
        return cls(
            **HabitProgressResponse.of(detail.progress).model_dump(),
            reminders=[HabitReminderTimeResponse.of(r) for r in detail.reminders],
            tasks=[TaskResponse.of(t) for t in detail.tasks],
            notes=[LinkedNoteResponse.of(n) for n in detail.notes],
        )


class CreateHabitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: HabitName
    description: Description = ""
    category_id: uuid.UUID | None = None
    icon: HabitIcon = "sparkles"
    color: HabitColor = "blue"
    kind: HabitKind = "boolean"
    unit: Unit = Field(default="", description="Numeric habits only, such as `litres`.")
    target: Target | None = Field(
        default=None, description="Required for numeric and duration (minutes) habits."
    )
    schedule: HabitScheduleModel
    time_of_day: TimeOfDay | None = None
    start_date: CalendarDate
    end_date: CalendarDate | None = None
    timezone: TimeZoneName | None = Field(
        default=None, description="Defaults to the user's preference, else UTC."
    )
    reminders: Reminders = Field(default_factory=list[HabitReminderTimeModel])

    def to_draft(self) -> HabitDraft:
        return HabitDraft(
            name=self.name,
            kind=self.kind,
            schedule=self.schedule.to_schedule(),
            start_date=self.start_date,
            timezone=self.timezone,
            description=self.description,
            category_id=self.category_id,
            icon=self.icon,
            color=self.color,
            unit=self.unit,
            target=None if self.kind == "boolean" else self.target,
            time_of_day=self.time_of_day,
            end_date=self.end_date,
            reminders=tuple(r.to_time() for r in self.reminders),
        )


class UpdateHabitRequest(BaseModel):
    """Only the fields sent change. A new `schedule` applies from `schedule_from` (today by
    default); earlier days keep the schedule they had."""

    model_config = ConfigDict(extra="forbid")

    name: HabitName | None = None
    description: Description | None = None
    category_id: uuid.UUID | None = None
    icon: HabitIcon | None = None
    color: HabitColor | None = None
    unit: Unit | None = None
    target: Target | None = None
    schedule: HabitScheduleModel | None = None
    schedule_from: CalendarDate | None = None
    time_of_day: TimeOfDay | None = None
    start_date: CalendarDate | None = None
    end_date: CalendarDate | None = None
    timezone: TimeZoneName | None = None
    status: HabitStatus | None = Field(
        default=None, description="`paused` or `archived` stops tracking from today."
    )

    @model_validator(mode="after")
    def _check_nulls(self) -> Self:
        for name in (
            "name",
            "description",
            "icon",
            "color",
            "unit",
            "target",
            "schedule",
            "start_date",
            "timezone",
            "status",
        ):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be null")
        return self

    def to_changes(self) -> HabitChanges:
        sent = self.model_fields_set
        return HabitChanges(
            name=self.name if self.name is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            category_id=self.category_id if "category_id" in sent else UNSET,
            icon=self.icon if self.icon is not None else UNSET,
            color=self.color if self.color is not None else UNSET,
            unit=self.unit if self.unit is not None else UNSET,
            target=self.target if self.target is not None else UNSET,
            time_of_day=self.time_of_day if "time_of_day" in sent else UNSET,
            start_date=self.start_date if self.start_date is not None else UNSET,
            end_date=self.end_date if "end_date" in sent else UNSET,
            timezone=self.timezone if self.timezone is not None else UNSET,
            status=self.status if self.status is not None else UNSET,
            schedule=self.schedule.to_schedule() if self.schedule is not None else UNSET,
            schedule_from=self.schedule_from,
        )


class LogHabitRequest(BaseModel):
    """`completed` records the target (or `value`); `progress` records `value` toward it;
    `skipped` excuses the day, so it doesn't break a streak."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["completed", "progress", "skipped"] = "completed"
    value: float | None = Field(default=None, ge=0, le=1_000_000)
    note: LogNote = ""

    def to_draft(self) -> LogDraft:
        return LogDraft(status=self.status, value=self.value, note=self.note)


class HabitDayResponse(BaseModel):
    day: date
    state: DayState
    log: HabitLogResponse | None

    @classmethod
    def of(cls, item: HabitDay) -> "HabitDayResponse":
        return cls(day=item.day, state=item.state, log=HabitLogResponse.of(item.log))


class HabitRangeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate
    end: CalendarDate = Field(description="The last date, inclusive; at most 366 days later.")


class HabitHistoryResponse(BaseModel):
    days: list[HabitDayResponse]
    periods: list[HabitPeriodResponse]

    @classmethod
    def of(cls, history: HabitHistory) -> "HabitHistoryResponse":
        return cls(
            days=[HabitDayResponse.of(d) for d in history.days],
            periods=[p for p in map(HabitPeriodResponse.of, history.periods) if p is not None],
        )


class HabitTodayParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: CalendarDate | None = Field(default=None, description="Defaults to today.")
    timezone: TimeZoneName | None = Field(
        default=None, description="Where today is. Defaults to the user's preference, else UTC."
    )


class HabitHeatmapDayResponse(BaseModel):
    day: date
    due: int = Field(description="Fixed-day occurrences due.")
    completed: int = Field(description="Of those, how many were completed.")
    extra: int = Field(description="Other completions: weekly-target and extra days.")

    @classmethod
    def of(cls, item: HeatmapDay) -> "HabitHeatmapDayResponse":
        return cls(day=item.day, due=item.due, completed=item.completed, extra=item.extra)


class HabitUpcomingDayResponse(BaseModel):
    day: date
    habit_ids: list[uuid.UUID]


class HabitTodayResponse(BaseModel):
    day: date
    habits: list[HabitProgressResponse]
    week: list[HabitHeatmapDayResponse]
    upcoming: list[HabitUpcomingDayResponse]

    @classmethod
    def of(cls, view: TodayView) -> "HabitTodayResponse":
        return cls(
            day=view.day,
            habits=[HabitProgressResponse.of(h) for h in view.habits],
            week=[HabitHeatmapDayResponse.of(d) for d in view.week],
            upcoming=[
                HabitUpcomingDayResponse(day=u.day, habit_ids=u.habit_ids) for u in view.upcoming
            ],
        )


class CreateHabitNoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(single_line)
    ] = Field(default="", description="Defaults to the habit's name and the date.")
    day: CalendarDate | None = Field(default=None, description="The day it reflects on.")


# Analytics and the calendar


class HabitAnalyticsParams(HabitRangeParams):
    timezone: TimeZoneName | None = None
    category_id: uuid.UUID | None = None


class HabitTrendPointResponse(BaseModel):
    start: date
    end: date
    met: int
    missed: int
    rate: float | None

    @classmethod
    def of(cls, point: TrendPoint) -> "HabitTrendPointResponse":
        return cls(
            start=point.start, end=point.end, met=point.met, missed=point.missed, rate=point.rate
        )


class HabitPerformanceResponse(BaseModel):
    habit_id: uuid.UUID
    name: str
    color: HabitColor
    icon: HabitIcon
    category_id: uuid.UUID | None
    status: HabitStatus
    met: int
    missed: int
    rate: float | None
    completions: int
    current_streak: int
    longest_streak: int
    streak_unit: PeriodUnit
    trend: float | None = Field(
        description="The rate in the range's second half minus its first; negative is declining."
    )

    @classmethod
    def of(cls, item: HabitPerformance) -> "HabitPerformanceResponse":
        habit = item.habit
        return cls(
            habit_id=habit.id,
            name=habit.name,
            color=habit.color,
            icon=habit.icon,
            category_id=habit.category_id,
            status=habit.status,
            met=item.met,
            missed=item.missed,
            rate=item.rate,
            completions=item.completions,
            current_streak=item.current_streak,
            longest_streak=item.longest_streak,
            streak_unit=item.streak_unit,
            trend=item.trend,
        )


class HabitCategoryPerformanceResponse(BaseModel):
    category_id: uuid.UUID | None
    name: str
    color: HabitColor
    met: int
    missed: int
    rate: float | None

    @classmethod
    def of(cls, item: CategoryPerformance) -> "HabitCategoryPerformanceResponse":
        total = item.met + item.missed
        category = item.category
        return cls(
            category_id=category.id if category else None,
            name=category.name if category else "Uncategorized",
            color=category.color if category else "slate",
            met=item.met,
            missed=item.missed,
            rate=item.met / total if total else None,
        )


class HabitAnalyticsResponse(BaseModel):
    start: date
    end: date
    heatmap: list[HabitHeatmapDayResponse]
    weekly: list[HabitTrendPointResponse]
    monthly: list[HabitTrendPointResponse]
    habits: list[HabitPerformanceResponse]
    categories: list[HabitCategoryPerformanceResponse]

    @classmethod
    def of(cls, result: HabitAnalytics) -> "HabitAnalyticsResponse":
        return cls(
            start=result.start,
            end=result.end,
            heatmap=[HabitHeatmapDayResponse.of(d) for d in result.heatmap],
            weekly=[HabitTrendPointResponse.of(p) for p in result.weekly],
            monthly=[HabitTrendPointResponse.of(p) for p in result.monthly],
            habits=[HabitPerformanceResponse.of(h) for h in result.habits],
            categories=[HabitCategoryPerformanceResponse.of(c) for c in result.categories],
        )


class HabitCalendarParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate = Field(description="The first local date.")
    end: CalendarDate = Field(description="The day after the last local date (exclusive).")
    timezone: TimeZoneName | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class HabitCalendarEntryResponse(BaseModel):
    kind: Literal["habit", "routine"]
    id: uuid.UUID
    title: str
    color: HabitColor
    icon: HabitIcon
    day: date
    start_at: datetime
    end_at: datetime
    state: DayState | None

    @classmethod
    def of(cls, entry: CalendarEntry) -> "HabitCalendarEntryResponse":
        return cls(
            kind=entry.kind,
            id=entry.id,
            title=entry.title,
            color=entry.color,
            icon=entry.icon,
            day=entry.day,
            start_at=entry.start_at,
            end_at=entry.end_at,
            state=entry.state,
        )


class HabitCalendarResponse(BaseModel):
    entries: list[HabitCalendarEntryResponse]


# Routines


class RoutineStepRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = Field(default=None, description="Keep an existing step; omit to add.")
    name: HabitName
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=1000), AfterValidator(multi_line)
    ] = ""
    duration_minutes: Minutes | None = None
    habit_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    note_id: uuid.UUID | None = None

    def to_draft(self) -> StepDraft:
        return StepDraft(
            id=self.id,
            name=self.name,
            description=self.description,
            duration_minutes=self.duration_minutes,
            habit_id=self.habit_id,
            task_id=self.task_id,
            note_id=self.note_id,
        )


class RoutineStepResponse(BaseModel):
    id: uuid.UUID
    position: int
    name: str
    description: str
    duration_minutes: int | None
    habit_id: uuid.UUID | None
    task_id: uuid.UUID | None
    note_id: uuid.UUID | None

    @classmethod
    def of(cls, step: RoutineStep) -> "RoutineStepResponse":
        return cls(
            id=step.id,
            position=step.position,
            name=step.name,
            description=step.description,
            duration_minutes=step.duration_minutes,
            habit_id=step.habit_id,
            task_id=step.task_id,
            note_id=step.note_id,
        )


Steps = Annotated[list[RoutineStepRequest], Field(max_length=MAX_STEPS)]


class RoutineSessionStepResponse(BaseModel):
    id: uuid.UUID
    position: int
    name: str
    duration_minutes: int | None
    habit_id: uuid.UUID | None
    task_id: uuid.UUID | None
    status: StepStatus
    completed_at: datetime | None

    @classmethod
    def of(cls, step: SessionStep) -> "RoutineSessionStepResponse":
        return cls(
            id=step.id,
            position=step.position,
            name=step.name,
            duration_minutes=step.duration_minutes,
            habit_id=step.habit_id,
            task_id=step.task_id,
            status=step.status,
            completed_at=step.completed_at,
        )


class RoutineSessionResponse(BaseModel):
    id: uuid.UUID
    routine_id: uuid.UUID
    day: date
    routine_name: str = Field(description="The routine's name when the session started.")
    status: SessionStatus
    started_at: datetime
    finished_at: datetime | None
    notes: str
    note_id: uuid.UUID | None
    steps: list[RoutineSessionStepResponse]

    @classmethod
    def of(cls, session: RoutineSession | None) -> "RoutineSessionResponse | None":
        if session is None:
            return None
        return cls(
            id=session.id,
            routine_id=session.routine_id,
            day=session.day,
            routine_name=session.routine_name,
            status=session.status,
            started_at=session.started_at,
            finished_at=session.finished_at,
            notes=session.notes,
            note_id=session.note_id,
            steps=[RoutineSessionStepResponse.of(s) for s in session.steps],
        )


class RoutineSessionListResponse(BaseModel):
    sessions: list[RoutineSessionResponse]
    total: int


class RoutineSessionListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=20, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)


class RoutineResponse(BaseModel):
    id: uuid.UUID
    category_id: uuid.UUID | None
    name: str
    description: str
    icon: HabitIcon
    color: HabitColor
    time_of_day: time | None
    weekdays: list[Weekday] = Field(description="Empty means every day.")
    timezone: str
    status: HabitStatus
    steps: list[RoutineStepResponse]
    estimated_minutes: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, routine: Routine) -> "RoutineResponse":
        return cls(
            id=routine.id,
            category_id=routine.category_id,
            name=routine.name,
            description=routine.description,
            icon=routine.icon,
            color=routine.color,
            time_of_day=routine.time_of_day,
            weekdays=_ordered(list(routine.weekdays)),
            timezone=routine.timezone,
            status=routine.status,
            steps=[RoutineStepResponse.of(s) for s in routine.steps],
            estimated_minutes=routine.estimated_minutes,
            created_at=routine.created_at,
            updated_at=routine.updated_at,
        )


class RoutineDetailResponse(RoutineResponse):
    reminders: list[HabitReminderTimeResponse]
    active_session: RoutineSessionResponse | None
    last_session: RoutineSessionResponse | None
    sessions_completed: int

    @classmethod
    def of_detail(cls, detail: RoutineDetail) -> "RoutineDetailResponse":
        return cls(
            **RoutineResponse.of(detail.routine).model_dump(),
            reminders=[HabitReminderTimeResponse.of(r) for r in detail.reminders],
            active_session=RoutineSessionResponse.of(detail.active_session),
            last_session=RoutineSessionResponse.of(detail.last_session),
            sessions_completed=detail.sessions_completed,
        )


class RoutineListResponse(BaseModel):
    routines: list[RoutineDetailResponse]


class RoutineListParams(HabitListParams):
    pass


class CreateRoutineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: HabitName
    description: Description = ""
    category_id: uuid.UUID | None = None
    icon: HabitIcon = "sun"
    color: HabitColor = "amber"
    time_of_day: TimeOfDay | None = None
    weekdays: list[Weekday] = Field(default_factory=list[Weekday])
    timezone: TimeZoneName | None = None
    steps: Steps = Field(default_factory=list[RoutineStepRequest])
    reminders: Reminders = Field(default_factory=list[HabitReminderTimeModel])

    def to_draft(self) -> RoutineDraft:
        return RoutineDraft(
            name=self.name,
            timezone=self.timezone,
            description=self.description,
            category_id=self.category_id,
            icon=self.icon,
            color=self.color,
            time_of_day=self.time_of_day,
            weekdays=frozenset(self.weekdays),
            steps=tuple(s.to_draft() for s in self.steps),
            reminders=tuple(r.to_time() for r in self.reminders),
        )


class UpdateRoutineRequest(BaseModel):
    """Only the fields sent change. `steps` is the whole ordered list: steps left out are
    removed; sessions already started keep their copies."""

    model_config = ConfigDict(extra="forbid")

    name: HabitName | None = None
    description: Description | None = None
    category_id: uuid.UUID | None = None
    icon: HabitIcon | None = None
    color: HabitColor | None = None
    time_of_day: TimeOfDay | None = None
    weekdays: list[Weekday] | None = None
    timezone: TimeZoneName | None = None
    status: HabitStatus | None = None
    steps: Steps | None = None

    def to_changes(self) -> RoutineChanges:
        sent = self.model_fields_set
        return RoutineChanges(
            name=self.name if self.name is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            category_id=self.category_id if "category_id" in sent else UNSET,
            icon=self.icon if self.icon is not None else UNSET,
            color=self.color if self.color is not None else UNSET,
            time_of_day=self.time_of_day if "time_of_day" in sent else UNSET,
            weekdays=frozenset(self.weekdays) if self.weekdays is not None else UNSET,
            timezone=self.timezone if self.timezone is not None else UNSET,
            status=self.status if self.status is not None else UNSET,
            steps=tuple(s.to_draft() for s in self.steps) if self.steps is not None else UNSET,
        )


class StartRoutineSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate | None = Field(default=None, description="Defaults to today.")


class UpdateSessionStepRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StepStatus


class UpdateRoutineSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["completed", "abandoned"] | None = Field(
        default=None, description="Finish or abandon an active session."
    )
    notes: SessionNotes | None = None
    note_id: uuid.UUID | None = Field(default=None, description="Link a note; `null` unlinks.")


class CreateSessionNoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(single_line)
    ] = ""
