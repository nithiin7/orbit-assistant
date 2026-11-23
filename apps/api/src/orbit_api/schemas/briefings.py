"""Daily briefing models: the stable contract for the web app, the agent, and later phases.

The response mirrors the snapshot types in `services/briefings/models.py` field for field, read
from them by attribute, so the contract is declared here and changes to it are deliberate.
"""

import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator

from orbit_api.schemas.common import TimeZoneName
from orbit_api.services.briefings.models import (
    MAX_HORIZON_DAYS,
    MIN_HORIZON_DAYS,
    SOURCES,
    Briefing,
    BriefingHistoryPage,
    BriefingSettings,
    BriefingStatus,
    DocumentDateKind,
    NoteReason,
    RecordType,
    ReminderBucket,
    RoutineState,
    Severity,
    Source,
    SourceStatus,
    WorkoutState,
)
from orbit_api.services.budgets.models import BudgetScope, UtilizationStatus
from orbit_api.services.commitments.models import CommitmentKind, PaymentStatus
from orbit_api.services.finance.money import Currency
from orbit_api.services.fitness.models import GoalCategory as FitnessGoalCategory
from orbit_api.services.fitness.models import GoalPace
from orbit_api.services.habits.models import HabitKind
from orbit_api.services.habits.progress import DayState, PeriodUnit
from orbit_api.services.notes.models import NoteType
from orbit_api.services.tasks.models import TaskPriority

HISTORY_MAX_PAGE = 100


class _Snapshot(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BriefingParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timezone: TimeZoneName | None = Field(
        default=None, description="Where today is. Defaults to the user's preference, else UTC."
    )


class BriefingDateParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timezone: TimeZoneName | None = Field(
        default=None,
        description="Which time zone's briefing for the date. Omit for the date's most recently "
        "prepared one.",
    )


class BriefingRegenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timezone: TimeZoneName | None = Field(
        default=None, description="Where today is. Defaults to the user's preference, else UTC."
    )


class BriefingHistoryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=30, ge=1, le=HISTORY_MAX_PAGE)
    offset: int = Field(default=0, ge=0)


class BriefingSourceRef(_Snapshot):
    module: Source
    type: RecordType
    id: uuid.UUID
    occurrence: str | None = Field(
        description="One occurrence of a repeating record: an event's original start (UTC, "
        "ISO 8601), or a payment's due date."
    )
    key: str = Field(description="Stable across regenerations and unique within a briefing.")


class BriefingDayWindow(_Snapshot):
    date: date
    timezone: str
    start: datetime = Field(description="The day's first instant, in UTC.")
    end: datetime = Field(description="The next day's first instant, in UTC (exclusive).")


class BriefingTaskItem(_Snapshot):
    ref: BriefingSourceRef
    title: str
    priority: TaskPriority
    due_date: date | None
    completed_at: datetime | None
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    severity: Severity
    reminder_at: datetime | None = Field(
        description="The task's reminder today, which isn't listed again under reminders."
    )


class BriefingTaskList(_Snapshot):
    items: list[BriefingTaskItem]
    total: int = Field(description="Every matching task; `items` holds at most 10.")


class BriefingTasks(_Snapshot):
    overdue: BriefingTaskList
    due_today: BriefingTaskList
    high_priority: BriefingTaskList = Field(
        description="Open high-priority tasks due later or without a due date."
    )
    completed: BriefingTaskList = Field(description="Completed since the start of yesterday.")


class BriefingEventItem(_Snapshot):
    ref: BriefingSourceRef
    title: str
    location: str
    all_day: bool
    start_at: datetime
    end_at: datetime
    local_start: datetime = Field(description="Wall-clock start in the event's time zone.")
    local_end: datetime
    event_timezone: str
    recurring: bool
    severity: Severity


class BriefingTimeBlock(_Snapshot):
    ref: BriefingSourceRef
    title: str
    start_at: datetime
    end_at: datetime
    completed: bool


class BriefingConflict(_Snapshot):
    first: str = Field(description="An event's `ref.key`.")
    second: str
    start_at: datetime
    end_at: datetime


class BriefingSchedule(_Snapshot):
    events: list[BriefingEventItem] = Field(
        description="Today's confirmed occurrences: all-day first, then by start."
    )
    time_blocks: list[BriefingTimeBlock]
    conflicts: list[BriefingConflict]
    upcoming: list[BriefingEventItem] = Field(
        description="Timed occurrences after today, within the horizon."
    )


class BriefingReminderItem(_Snapshot):
    ref: BriefingSourceRef
    title: str
    at: datetime
    bucket: ReminderBucket
    severity: Severity
    task_id: uuid.UUID | None


class BriefingReminders(_Snapshot):
    items: list[BriefingReminderItem]
    represented_elsewhere: int = Field(
        description="Reminders left out because their task, event, payment, or habit is shown."
    )


class BriefingPaymentItem(_Snapshot):
    ref: BriefingSourceRef
    kind: CommitmentKind
    name: str
    counterparty: str
    amount: int = Field(description="Minor units.")
    estimated: bool
    currency: Currency
    due_date: date
    status: PaymentStatus
    severity: Severity


class BriefingPayments(_Snapshot):
    items: list[BriefingPaymentItem]
    overdue: int
    due_today: int
    upcoming: int


class BriefingBudgetItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    scope: BudgetScope
    currency: Currency
    period_start: date
    period_end: date
    available: int = Field(description="Minor units.")
    spent: int
    remaining: int
    utilization_bps: int | None = Field(description="Hundredths of a percent: 8750 is 87.5%.")
    status: UtilizationStatus
    severity: Severity


class BriefingBudgets(_Snapshot):
    items: list[BriefingBudgetItem]
    exceeded: int
    approaching: int


class BriefingSavingsGoalItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    currency: Currency
    target_amount: int
    saved: int
    progress_bps: int
    target_date: date
    severity: Severity


class BriefingDeadlines(_Snapshot):
    tasks: BriefingTaskList = Field(description="Open tasks due after today, within the horizon.")
    savings_goals: list[BriefingSavingsGoalItem]


class BriefingHabitItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    kind: HabitKind
    state: DayState
    done: bool
    current_streak: int
    streak_unit: PeriodUnit
    week_done: int
    week_due: int


class BriefingHabits(_Snapshot):
    habits: list[BriefingHabitItem]
    remaining: int
    done: int


class BriefingRoutineItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    time_of_day: str | None = Field(description="Local time, HH:MM.")
    state: RoutineState
    steps: int
    estimated_minutes: int


class BriefingRoutines(_Snapshot):
    routines: list[BriefingRoutineItem]


class BriefingWorkoutItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    state: WorkoutState
    start_at: datetime | None
    end_at: datetime | None


class BriefingFitnessGoalItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    category: FitnessGoalCategory
    pace: GoalPace
    reached: bool
    target_date: date | None
    severity: Severity


class BriefingHealth(_Snapshot):
    workouts: list[BriefingWorkoutItem]
    goals: list[BriefingFitnessGoalItem]


class BriefingNoteItem(_Snapshot):
    ref: BriefingSourceRef
    title: str
    note_type: NoteType
    reason: NoteReason
    linked_to: list[str] = Field(description="`ref.key`s of the items the note is linked to.")
    updated_at: datetime


class BriefingNotes(_Snapshot):
    items: list[BriefingNoteItem]


class BriefingDocumentItem(_Snapshot):
    ref: BriefingSourceRef
    title: str
    kind: DocumentDateKind
    date: date
    lapsed: bool = Field(description="Expired, or its renewal date has passed.")
    severity: Severity


class BriefingDocuments(_Snapshot):
    items: list[BriefingDocumentItem] = Field(
        description="Expired first (most recent first), then expiring within 30 days and "
        "renewals within the horizon, soonest first."
    )
    expired: int
    expiring: int


class BriefingShoppingListItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    needed: int


class BriefingShopping(_Snapshot):
    lists: list[BriefingShoppingListItem] = Field(description="Lists with items still to buy.")
    needed: int


class BriefingPersonDateItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    kind: str = Field(description="`birthday`, `anniversary`, or `other` (named by `label`).")
    label: str
    on: date
    days_away: int
    years: int | None = Field(description="How old they turn, or years together, if known.")


class BriefingPeople(_Snapshot):
    items: list[BriefingPersonDateItem] = Field(description="Soonest first; names and dates only.")
    today: int
    total: int


class BriefingSipItem(_Snapshot):
    ref: BriefingSourceRef
    holding_name: str
    amount: int = Field(description="Minor units.")
    currency: Currency
    due_date: date
    auto_debit: bool
    severity: Severity


class BriefingDepositItem(_Snapshot):
    ref: BriefingSourceRef
    name: str
    institution: str
    maturity_date: date
    projected_maturity_amount: int = Field(description="Minor units.")
    currency: Currency
    matured: bool = Field(description="Past its maturity date but still open.")
    severity: Severity


class BriefingInvestments(_Snapshot):
    sips: list[BriefingSipItem] = Field(description="Installments due within the horizon.")
    deposits: list[BriefingDepositItem] = Field(
        description="Open deposits maturing within the horizon, or already matured."
    )


class BriefingSourceState(_Snapshot):
    module: Source
    status: SourceStatus
    items: int
    loaded_at: datetime


class BriefingAttentionItem(_Snapshot):
    key: str
    module: Source
    title: str
    severity: Severity


class BriefingSummaryResponse(_Snapshot):
    events: int
    conflicts: int
    tasks_overdue: int
    tasks_due_today: int
    reminders_due: int
    payments_overdue: int
    payments_due: int
    budgets_exceeded: int
    budgets_approaching: int
    habits_remaining: int
    habits_done: int
    workouts: int
    attention: list[BriefingAttentionItem] = Field(
        description="The most pressing items, critical first, at most 10."
    )


class BriefingContentResponse(_Snapshot):
    window: BriefingDayWindow
    horizon_days: int
    summary: BriefingSummaryResponse
    sources: list[BriefingSourceState]
    schedule: BriefingSchedule | None = Field(description="`null` when the source is unavailable.")
    tasks: BriefingTasks | None
    deadlines: BriefingDeadlines | None
    reminders: BriefingReminders | None
    payments: BriefingPayments | None
    budgets: BriefingBudgets | None
    habits: BriefingHabits | None
    routines: BriefingRoutines | None
    health: BriefingHealth | None
    notes: BriefingNotes | None
    documents: BriefingDocuments | None = Field(
        description="`null` when unavailable, left out, or in briefings prepared before it was "
        "added."
    )
    shopping: BriefingShopping | None
    investments: BriefingInvestments | None
    people: BriefingPeople | None = Field(
        description="`null` when unavailable, left out, or in briefings prepared before it was "
        "added."
    )
    unavailable: list[Source]


class BriefingNarrativePriority(_Snapshot):
    key: str = Field(description="The `ref.key` of the briefing item it's about.")
    title: str
    reason: str


class BriefingNarrativeResponse(_Snapshot):
    headline: str
    summary: str
    priorities: list[BriefingNarrativePriority]
    modules: list[Source] = Field(
        description="The modules the provider was given; AI permissions left out the rest."
    )
    provider_name: str
    model: str
    processing: str = Field(description="`local` or `cloud`.")
    generated_at: datetime


class BriefingResponse(_Snapshot):
    id: uuid.UUID
    date: date
    timezone: str
    status: BriefingStatus = Field(description="`partial` when a source couldn't be read.")
    revision: int
    generated_at: datetime
    created_at: datetime
    content: BriefingContentResponse
    narrative: BriefingNarrativeResponse | None = Field(
        description="The AI-written summary, if one was asked for; cleared on regeneration."
    )

    @classmethod
    def of(cls, briefing: Briefing) -> "BriefingResponse":
        return cls.model_validate(briefing)


class BriefingListingResponse(_Snapshot):
    id: uuid.UUID
    date: date
    timezone: str
    status: BriefingStatus
    revision: int
    generated_at: datetime
    summary: BriefingSummaryResponse


class BriefingHistoryResponse(_Snapshot):
    items: list[BriefingListingResponse]
    total: int

    @classmethod
    def of(cls, page: BriefingHistoryPage) -> "BriefingHistoryResponse":
        return cls.model_validate(page)


class BriefingSettingsBody(BaseModel):
    """How a person's briefing is prepared. Applies from the next briefing prepared."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    horizon_days: int = Field(
        ge=MIN_HORIZON_DAYS,
        le=MAX_HORIZON_DAYS,
        description="How many days ahead upcoming events, deadlines, and payments look.",
    )
    hidden: list[Source] = Field(
        max_length=len(SOURCES), description="Modules left out of the briefing entirely."
    )
    prepare_at: time | None = Field(
        description="Local time (your time zone preference) to prepare the briefing each day; "
        "`null` prepares it only when opened."
    )

    @field_validator("prepare_at")
    @classmethod
    def _whole_minutes(cls, value: time | None) -> time | None:
        if value is not None and (value.second or value.microsecond or value.tzinfo):
            raise ValueError("must be a local time in whole minutes, such as 07:00")
        return value

    def to_settings(self) -> BriefingSettings:
        return BriefingSettings(
            horizon_days=self.horizon_days,
            hidden=frozenset(self.hidden),
            prepare_at=self.prepare_at,
        )

    @classmethod
    def of(cls, settings: BriefingSettings) -> "BriefingSettingsBody":
        return cls(
            horizon_days=settings.horizon_days,
            hidden=[source for source in SOURCES if source in settings.hidden],
            prepare_at=settings.prepare_at,
        )
