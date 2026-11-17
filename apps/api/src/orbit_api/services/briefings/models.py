"""Daily briefing types: a normalized, structured snapshot of one person's day.

A briefing repeats no module's rules and owns no source data. Each item is a small, typed
summary of a record, with a `SourceRef` back to it, taken from that module's own service. The
snapshot keeps only what is needed to show the day as it was when the briefing was prepared:
titles, times, states, and figures the modules computed. Descriptions, note content, and health
measurements are never copied.

Lists are bounded (`ITEM_LIMIT`) and their order is deterministic: every sort ends on a stable
key, so the same data always gives the same briefing.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Final, Literal

from orbit_api.services.budgets.models import BudgetScope, UtilizationStatus
from orbit_api.services.commitments.models import CommitmentKind, PaymentStatus
from orbit_api.services.finance.money import Currency
from orbit_api.services.fitness.models import GoalCategory as FitnessGoalCategory
from orbit_api.services.fitness.models import GoalPace
from orbit_api.services.habits.models import HabitKind
from orbit_api.services.habits.progress import DayState, PeriodUnit
from orbit_api.services.notes.models import NoteType
from orbit_api.services.tasks.models import TaskPriority

# Bumped when the snapshot's shape changes incompatibly, so stored briefings can be read back
# (or regenerated) knowingly.
FORMAT_VERSION: Final = 1

# How many items a list holds; its `total` is always complete where the module can count.
ITEM_LIMIT: Final = 10
# Pinned notes are shown only as a short reminder of what the person keeps close.
PINNED_NOTE_LIMIT: Final = 3

# Each module a briefing reads from. A source loads (or fails) on its own.
Source = Literal[
    "tasks",
    "calendar",
    "reminders",
    "payments",
    "budgets",
    "goals",
    "habits",
    "routines",
    "health",
    "notes",
    "documents",
    "shopping",
    "investments",
]
SOURCES: Final[tuple[Source, ...]] = (
    "tasks",
    "calendar",
    "payments",
    "budgets",
    "goals",
    "investments",
    "habits",
    "routines",
    "health",
    "documents",
    "shopping",
    "notes",
    # Last: reminders already shown by a task, event, payment, or habit are left out.
    "reminders",
)
# `off`: the person left the module out of their briefing (see `BriefingSettings`).
SourceStatus = Literal["ok", "empty", "unavailable", "off"]

# How much an item needs attention. Never a judgment the data doesn't support: `critical` is
# money already late or over budget; `warning` is something late, due today, or close to a
# limit; everything else is `info`.
Severity = Literal["critical", "warning", "info"]
SEVERITY_RANK: Final[dict[Severity, int]] = {"critical": 0, "warning": 1, "info": 2}

# `complete`: every source loaded. `partial`: at least one didn't (see `sources`).
BriefingStatus = Literal["complete", "partial"]

# The kind of record a `SourceRef` points at, which is how the web app links to it.
RecordType = Literal[
    "task",
    "event",
    "reminder",
    "commitment",
    "budget",
    "savings_goal",
    "habit",
    "routine",
    "workout",
    "fitness_goal",
    "note",
    "document",
    "shopping_list",
    "sip",
    "deposit",
]


@dataclass(frozen=True, slots=True)
class SourceRef:
    """The record an item summarizes. `occurrence` names one occurrence of a repeating record:
    an event's original start (ISO 8601, UTC) or a payment's due date."""

    module: Source
    type: RecordType
    id: uuid.UUID
    occurrence: str | None = None

    @property
    def key(self) -> str:
        """Stable across regenerations, and unique within a briefing."""
        base = f"{self.type}:{self.id}"
        return f"{base}:{self.occurrence}" if self.occurrence else base


@dataclass(frozen=True, slots=True)
class DayWindow:
    """The briefing's day: local `date` in `timezone`, as UTC instants `[start, end)`. With a
    daylight-saving change the day is 23 or 25 hours long."""

    date: date
    timezone: str
    start: datetime
    end: datetime


# Tasks


TaskBucket = Literal["overdue", "due_today", "high_priority", "upcoming", "completed"]


@dataclass(frozen=True, slots=True)
class BriefingTask:
    ref: SourceRef
    title: str
    priority: TaskPriority
    due_date: date | None
    completed_at: datetime | None
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    severity: Severity
    # The next reminder about this task today, when one exists; that reminder isn't listed
    # again under reminders.
    reminder_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class TaskList:
    items: tuple[BriefingTask, ...]
    total: int


@dataclass(frozen=True, slots=True)
class TaskSection:
    # Open tasks due before today, the most overdue first.
    overdue: TaskList
    # Open tasks due today, highest priority first.
    due_today: TaskList
    # Open high-priority tasks not already listed above: due later, or without a due date.
    # A task without a due date is never treated as urgent.
    high_priority: TaskList
    # Completed since the start of yesterday, most recent first.
    completed: TaskList


# Schedule


@dataclass(frozen=True, slots=True)
class BriefingEvent:
    ref: SourceRef
    title: str
    location: str
    all_day: bool
    # Timed: instants in UTC. All-day: midnight UTC of the first day and of the day after the
    # last, since an all-day event is a span of dates, not instants.
    start_at: datetime
    end_at: datetime
    # The event's own dates and times, in the event's time zone.
    local_start: datetime
    local_end: datetime
    event_timezone: str
    recurring: bool
    severity: Severity


@dataclass(frozen=True, slots=True)
class TimeBlock:
    """A task scheduled into a time on the calendar today."""

    ref: SourceRef
    title: str
    start_at: datetime
    end_at: datetime
    completed: bool


@dataclass(frozen=True, slots=True)
class Conflict:
    """Two timed, confirmed events that overlap. All-day events never conflict."""

    first: str
    second: str
    # The overlap.
    start_at: datetime
    end_at: datetime


@dataclass(frozen=True, slots=True)
class ScheduleSection:
    # Today's confirmed occurrences: all-day first, then by start.
    events: tuple[BriefingEvent, ...]
    time_blocks: tuple[TimeBlock, ...]
    # Pairs of `events` keys, in event order.
    conflicts: tuple[Conflict, ...]
    # Timed occurrences after today, within the horizon, soonest first.
    upcoming: tuple[BriefingEvent, ...]


# Reminders


ReminderBucket = Literal["overdue", "due_today", "upcoming"]


@dataclass(frozen=True, slots=True)
class BriefingReminder:
    ref: SourceRef
    title: str
    # The earliest active occurrence; before now when overdue.
    at: datetime
    bucket: ReminderBucket
    severity: Severity
    # The task it's about, if any (open and not shown under tasks).
    task_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class ReminderSection:
    items: tuple[BriefingReminder, ...]
    # Reminders left out because the task, event, payment, or habit they're about is already
    # in the briefing.
    represented_elsewhere: int


# Finance


@dataclass(frozen=True, slots=True)
class BriefingPayment:
    ref: SourceRef
    kind: CommitmentKind
    name: str
    counterparty: str
    # Minor units, as the commitments module computed it; `estimated` for a varying bill.
    amount: int
    estimated: bool
    currency: Currency
    due_date: date
    status: PaymentStatus
    severity: Severity


@dataclass(frozen=True, slots=True)
class PaymentSection:
    # Overdue first, then by due date.
    items: tuple[BriefingPayment, ...]
    overdue: int
    due_today: int
    upcoming: int


@dataclass(frozen=True, slots=True)
class BriefingBudget:
    ref: SourceRef
    name: str
    scope: BudgetScope
    currency: Currency
    period_start: date
    period_end: date
    # Minor units, from the budgets module; `remaining` is negative when overspent.
    available: int
    spent: int
    remaining: int
    # Hundredths of a percent; `None` when nothing is available.
    utilization_bps: int | None
    status: UtilizationStatus
    severity: Severity


@dataclass(frozen=True, slots=True)
class BudgetSection:
    # Active budgets, the most used first.
    items: tuple[BriefingBudget, ...]
    exceeded: int
    # At 75% or more but not over.
    approaching: int


@dataclass(frozen=True, slots=True)
class BriefingSavingsGoal:
    ref: SourceRef
    name: str
    currency: Currency
    target_amount: int
    saved: int
    progress_bps: int
    target_date: date
    severity: Severity


@dataclass(frozen=True, slots=True)
class DeadlineSection:
    # Open tasks due after today, within the horizon.
    tasks: TaskList
    # Active savings goals not yet reached whose target date is within the goal horizon (or
    # has passed), soonest first.
    savings_goals: tuple[BriefingSavingsGoal, ...]


# Habits and routines


@dataclass(frozen=True, slots=True)
class BriefingHabit:
    ref: SourceRef
    name: str
    kind: HabitKind
    # The habits module's state for today; never inferred here.
    state: DayState
    done: bool
    current_streak: int
    streak_unit: PeriodUnit
    # Weekly-target habits: this week's completed days and the days needed.
    week_done: int
    week_due: int


RoutineState = Literal["completed", "in_progress", "not_started"]


@dataclass(frozen=True, slots=True)
class BriefingRoutine:
    ref: SourceRef
    name: str
    # Local time of day, "HH:MM", when it has one.
    time_of_day: str | None
    state: RoutineState
    steps: int
    estimated_minutes: int


@dataclass(frozen=True, slots=True)
class HabitSection:
    # Habits due today (or done on an extra day), in the habits module's order. Unscheduled,
    # paused, and inactive habits are never listed, so they can't read as missed.
    habits: tuple[BriefingHabit, ...]
    remaining: int
    done: int


@dataclass(frozen=True, slots=True)
class RoutineSection:
    # Active routines that apply to today's weekday: timed first, then by name.
    routines: tuple[BriefingRoutine, ...]


# Health and fitness: the person's own; no measurements, weights, or nutrition.


WorkoutState = Literal["scheduled", "in_progress", "completed"]


@dataclass(frozen=True, slots=True)
class BriefingWorkout:
    ref: SourceRef
    name: str
    state: WorkoutState
    start_at: datetime | None
    end_at: datetime | None


@dataclass(frozen=True, slots=True)
class BriefingFitnessGoal:
    ref: SourceRef
    name: str
    category: FitnessGoalCategory
    pace: GoalPace
    reached: bool
    target_date: date | None
    severity: Severity


@dataclass(frozen=True, slots=True)
class HealthSection:
    # Scheduled and in-progress first by time, then completed.
    workouts: tuple[BriefingWorkout, ...]
    goals: tuple[BriefingFitnessGoal, ...]


# Notes


NoteReason = Literal["linked", "pinned"]


@dataclass(frozen=True, slots=True)
class BriefingNote:
    ref: SourceRef
    # Locked notes show their title only, as everywhere else.
    title: str
    note_type: NoteType
    reason: NoteReason
    # For linked notes: the keys of the briefing items the note is linked to.
    linked_to: tuple[str, ...]
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class NoteSection:
    items: tuple[BriefingNote, ...]


# Documents: only titles and the tracked dates; never their details or files.


DocumentDateKind = Literal["expiry", "renewal"]


@dataclass(frozen=True, slots=True)
class BriefingDocument:
    ref: SourceRef
    title: str
    kind: DocumentDateKind
    date: date
    # Expired (or a renewal date passed), as of the briefing's date.
    lapsed: bool
    severity: Severity


@dataclass(frozen=True, slots=True)
class DocumentSection:
    # Lapsed first (most recent first), then the soonest.
    items: tuple[BriefingDocument, ...]
    expired: int
    # Expiring within `DOCUMENT_HORIZON_DAYS`.
    expiring: int


# Shopping: lists with something still to buy, not the items themselves.


@dataclass(frozen=True, slots=True)
class BriefingShoppingList:
    ref: SourceRef
    name: str
    needed: int


@dataclass(frozen=True, slots=True)
class ShoppingSection:
    # Lists with items to buy, the default list first, then the fullest.
    lists: tuple[BriefingShoppingList, ...]
    needed: int


# Investments: SIP installments and deposit maturities coming up, from the investments module.


@dataclass(frozen=True, slots=True)
class BriefingSip:
    ref: SourceRef
    holding_name: str
    # Minor units, as the plan states it.
    amount: int
    currency: Currency
    due_date: date
    # Orbit records it itself on the due date.
    auto_debit: bool
    severity: Severity


@dataclass(frozen=True, slots=True)
class BriefingDeposit:
    ref: SourceRef
    name: str
    institution: str
    maturity_date: date
    # Minor units, as the investments module projects it.
    projected_maturity_amount: int
    currency: Currency
    # Past its maturity date but still open.
    matured: bool
    severity: Severity


@dataclass(frozen=True, slots=True)
class InvestmentSection:
    sips: tuple[BriefingSip, ...]
    deposits: tuple[BriefingDeposit, ...]


# The briefing


@dataclass(frozen=True, slots=True)
class SourceState:
    module: Source
    status: SourceStatus
    # Items the source contributed to the briefing.
    items: int
    # When the source was read.
    loaded_at: datetime


@dataclass(frozen=True, slots=True)
class AttentionItem:
    """One item that needs attention, pointing at its place in a section by `key`."""

    key: str
    module: Source
    title: str
    severity: Severity


@dataclass(frozen=True, slots=True)
class BriefingSummary:
    """Deterministic counts over the briefing; the context a future narrative starts from."""

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
    # The most pressing items, `critical` first, at most `ITEM_LIMIT`.
    attention: tuple[AttentionItem, ...]


@dataclass(frozen=True, slots=True)
class BriefingContent:
    """The snapshot. A section is `None` exactly when its source is unavailable."""

    window: DayWindow
    # How far ahead "upcoming" looks, in days.
    horizon_days: int
    summary: BriefingSummary
    sources: tuple[SourceState, ...]
    schedule: ScheduleSection | None = None
    tasks: TaskSection | None = None
    deadlines: DeadlineSection | None = None
    reminders: ReminderSection | None = None
    payments: PaymentSection | None = None
    budgets: BudgetSection | None = None
    habits: HabitSection | None = None
    routines: RoutineSection | None = None
    health: HealthSection | None = None
    notes: NoteSection | None = None
    unavailable: tuple[Source, ...] = field(default=())
    # Added after the first briefings were stored; older snapshots read them as `None`.
    documents: DocumentSection | None = None
    shopping: ShoppingSection | None = None
    investments: InvestmentSection | None = None


# Settings


MIN_HORIZON_DAYS: Final = 1
MAX_HORIZON_DAYS: Final = 14
DEFAULT_HORIZON_DAYS: Final = 7


@dataclass(frozen=True, slots=True)
class BriefingSettings:
    """One person's briefing in one workspace: how far ahead it looks, which modules it leaves
    out, and when (local time, in their time zone) the worker prepares it; `None` prepares it
    only when opened."""

    horizon_days: int = DEFAULT_HORIZON_DAYS
    hidden: frozenset[Source] = frozenset()
    prepare_at: time | None = None


class InvalidBriefingSettingsError(ValueError):
    """A horizon outside `MIN_HORIZON_DAYS`..`MAX_HORIZON_DAYS`."""


# The narrative


@dataclass(frozen=True, slots=True)
class NarrativePriority:
    """One thing to focus on, pointing at the briefing item it's about by `key`."""

    key: str
    title: str
    reason: str


@dataclass(frozen=True, slots=True)
class Narrative:
    """A short written summary of a stored snapshot, by the person's AI provider. It only
    restates the snapshot: the priorities point at items in it, checked by key."""

    headline: str
    summary: str
    priorities: tuple[NarrativePriority, ...]
    # The modules the provider was given; others were left out by AI permissions.
    modules: tuple[Source, ...]
    provider_name: str
    model: str
    processing: str
    generated_at: datetime


@dataclass(frozen=True, slots=True)
class Briefing:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    date: date
    timezone: str
    status: BriefingStatus
    # Starts at 1; each regeneration adds one.
    revision: int
    generated_at: datetime
    created_at: datetime
    content: BriefingContent
    # Cleared whenever the snapshot is regenerated.
    narrative: Narrative | None = None


@dataclass(frozen=True, slots=True)
class BriefingListing:
    """A briefing in history, without its content."""

    id: uuid.UUID
    date: date
    timezone: str
    status: BriefingStatus
    revision: int
    generated_at: datetime
    summary: BriefingSummary


@dataclass(frozen=True, slots=True)
class BriefingHistoryPage:
    items: list[BriefingListing]
    total: int


class BriefingNotFoundError(Exception):
    """No briefing was prepared for that date."""


class NothingToNarrateError(Exception):
    """AI may read none of the modules the briefing holds."""
