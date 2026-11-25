"""Cross-module aggregation: what one person's day holds, read from each module's own service.

The aggregator owns no data and repeats no module's rules: tasks come from the task service,
occurrences from the calendar's recurrence expansion, payment statuses from commitments,
utilization from budgets, habit states and streaks from habits. It only selects, orders, and
normalizes what they answer into the snapshot types in `models.py`, never inventing a value
or inferring a state a module didn't report.

Each source loads on its own: one that fails is logged with its traceback, reported as
unavailable, and the session rolled back so a failed statement can't poison the next; the rest
of the briefing still loads. Sources run one after another because they share the request's
database session, and each is a handful of bounded queries.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from typing import Final, Protocol, get_args

from orbit_api.services.briefings.insights import EMPTY_SUMMARY, summarize
from orbit_api.services.briefings.models import (
    ITEM_LIMIT,
    PINNED_NOTE_LIMIT,
    SEVERITY_RANK,
    SOURCES,
    BriefingBudget,
    BriefingContent,
    BriefingDeposit,
    BriefingDocument,
    BriefingEvent,
    BriefingFitnessGoal,
    BriefingHabit,
    BriefingNote,
    BriefingPayment,
    BriefingPersonDate,
    BriefingReminder,
    BriefingRoutine,
    BriefingSavingsGoal,
    BriefingSettings,
    BriefingShoppingList,
    BriefingSip,
    BriefingTask,
    BriefingWorkout,
    BudgetSection,
    Conflict,
    DayWindow,
    DeadlineSection,
    DocumentDateKind,
    DocumentSection,
    HabitSection,
    HealthSection,
    InvestmentSection,
    NoteSection,
    PaymentSection,
    PeopleSection,
    ReminderBucket,
    ReminderSection,
    RoutineSection,
    RoutineState,
    ScheduleSection,
    Severity,
    ShoppingSection,
    Source,
    SourceRef,
    SourceState,
    TaskList,
    TaskSection,
    TimeBlock,
)
from orbit_api.services.budgets.models import BudgetView, UtilizationStatus
from orbit_api.services.calendar.models import CalendarRange, DateWindow, EventOccurrence
from orbit_api.services.calendar.occurrences import in_date_window, window_instants
from orbit_api.services.commitments.models import PaymentItem, PaymentQuery
from orbit_api.services.dashboard.today import habit_is_remaining
from orbit_api.services.documents.models import DateRange, Document, DocumentQuery
from orbit_api.services.fitness.models import (
    GoalProgress,
    Owner,
    ScheduledWorkout,
    SessionDetail,
    SessionSummary,
)
from orbit_api.services.fitness.overview import Fitness
from orbit_api.services.goals.models import GoalView
from orbit_api.services.habits.models import RoutineDetail, RoutineStatus, TodayView
from orbit_api.services.investments.models import SipPlanView
from orbit_api.services.investments.service import InvestmentBook
from orbit_api.services.notes.models import LinkedNoteMatch, NotePage, NoteQuery
from orbit_api.services.people.dates import next_occurrence, years_on
from orbit_api.services.people.models import Person
from orbit_api.services.reminders.models import ReminderView
from orbit_api.services.reminders.recurrence import Weekday
from orbit_api.services.shopping.models import ShoppingListOverview
from orbit_api.services.tasks.models import Task, TaskPage, TaskPriority, TaskQuery
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

logger = logging.getLogger(__name__)

# Savings goals are long-running; their target dates count as near within this many days.
GOAL_HORIZON_DAYS: Final = 30
# Documents expiring within this many days are listed, as on the dashboard; within the first
# `SOON_DAYS` they need attention.
DOCUMENT_HORIZON_DAYS: Final = 30
SOON_DAYS: Final = 7
# Reminders are read soonest first; this bounds how many are considered.
REMINDER_SCAN: Final = 100
# High-priority and completed tasks are read with some room for the ones filtered out.
TASK_SCAN: Final = ITEM_LIMIT * 3

WEEKDAYS: Final[tuple[Weekday, ...]] = get_args(Weekday)
_HABIT_UNSCHEDULED: Final = frozenset({"unscheduled", "paused", "inactive"})
_BUDGET_SEVERITY: Final[dict[UtilizationStatus, Severity]] = {
    "exceeded": "critical",
    "near": "warning",
    "approaching": "info",
    "on_track": "info",
}


class TaskSource(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage: ...


class CalendarSource(Protocol):
    async def range(self, workspace_id: uuid.UUID, window: DateWindow) -> CalendarRange: ...


class ReminderSource(Protocol):
    async def upcoming(self, workspace_id: uuid.UUID, limit: int) -> list[ReminderView]: ...


class PaymentSource(Protocol):
    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]: ...


class BudgetSource(Protocol):
    async def views(self, workspace_id: uuid.UUID, today: date) -> list[BudgetView]: ...


class SavingsGoalSource(Protocol):
    async def views(self, workspace_id: uuid.UUID, today: date) -> list[GoalView]: ...


class HabitSource(Protocol):
    async def today(
        self, workspace_id: uuid.UUID, day: date | None, timezone: str
    ) -> TodayView: ...


class RoutineSource(Protocol):
    async def find(
        self, workspace_id: uuid.UUID, statuses: Sequence[RoutineStatus] | None
    ) -> list[RoutineDetail]: ...


class HealthSource(Protocol):
    """One person's workouts and goals; every read is scoped by `Owner`."""

    async def scheduled(self, owner: Owner, day: date, timezone: str) -> list[ScheduledWorkout]: ...

    async def active(self, owner: Owner) -> SessionDetail | None: ...

    async def completed(self, owner: Owner, day: date) -> list[SessionSummary]: ...

    async def goals(self, owner: Owner, day: date) -> list[GoalProgress]: ...


class DocumentSource(Protocol):
    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]: ...


class ShoppingSource(Protocol):
    async def overview(self, workspace_id: uuid.UUID) -> list[ShoppingListOverview]: ...


class PeopleSource(Protocol):
    async def people(self, workspace_id: uuid.UUID) -> list[Person]: ...


class InvestmentSource(Protocol):
    async def book(self, workspace_id: uuid.UUID, as_of: date) -> InvestmentBook: ...

    async def sip_plans(
        self, workspace_id: uuid.UUID, today: date, holding_id: uuid.UUID | None = None
    ) -> list[SipPlanView]: ...


class NoteSource(Protocol):
    async def linked_to(
        self,
        workspace_id: uuid.UUID,
        task_ids: Sequence[uuid.UUID],
        event_ids: Sequence[uuid.UUID],
    ) -> list[LinkedNoteMatch]: ...

    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> NotePage: ...


class FitnessHealthSource:
    """The health source, read through the fitness module's own services."""

    def __init__(self, fitness: Fitness) -> None:
        self._fitness = fitness

    async def scheduled(self, owner: Owner, day: date, timezone: str) -> list[ScheduledWorkout]:
        return await self._fitness.integrations.scheduled(
            owner, day, day + timedelta(days=1), timezone
        )

    async def active(self, owner: Owner) -> SessionDetail | None:
        return await self._fitness.workouts.active(owner)

    async def completed(self, owner: Owner, day: date) -> list[SessionSummary]:
        return await self._fitness.workouts.find(owner, start=day, end=day, statuses=("completed",))

    async def goals(self, owner: Owner, day: date) -> list[GoalProgress]:
        return await self._fitness.tracking.goals(owner, day, ("active",))


def day_window(day: date, timezone: str) -> DayWindow:
    start, end = window_instants(day, day + timedelta(days=1), timezone)
    return DayWindow(date=day, timezone=timezone, start=start, end=end)


def _task_ref(task: Task) -> SourceRef:
    return SourceRef(module="tasks", type="task", id=task.id)


def _task(task: Task, severity: Severity) -> BriefingTask:
    return BriefingTask(
        ref=_task_ref(task),
        title=task.title,
        priority=task.priority,
        due_date=task.due_date,
        completed_at=task.completed_at,
        scheduled_start=task.scheduled_start,
        scheduled_end=task.scheduled_end,
        severity=severity,
    )


def _event(occurrence: EventOccurrence, severity: Severity = "info") -> BriefingEvent:
    event = occurrence.event
    return BriefingEvent(
        ref=SourceRef(
            module="calendar",
            type="event",
            id=event.id,
            occurrence=occurrence.original_start.isoformat(),
        ),
        title=occurrence.title,
        location=occurrence.location,
        all_day=event.all_day,
        start_at=occurrence.start_at,
        end_at=occurrence.end_at,
        local_start=occurrence.start,
        local_end=occurrence.end,
        event_timezone=event.timezone,
        recurring=event.recurrence is not None or event.series_id is not None,
        severity=severity,
    )


def _event_order(occurrence: EventOccurrence) -> tuple[bool, datetime, str, str]:
    return (
        not occurrence.event.all_day,
        occurrence.start_at,
        occurrence.title.casefold(),
        str(occurrence.event.id),
    )


def find_conflicts(events: Sequence[BriefingEvent]) -> list[Conflict]:
    """Overlapping pairs among timed events, in event order. Touching (one ends as the next
    starts) is not a conflict."""
    timed = sorted((e for e in events if not e.all_day), key=lambda e: (e.start_at, e.ref.key))
    conflicts: list[Conflict] = []
    for index, first in enumerate(timed):
        for second in timed[index + 1 :]:
            if second.start_at >= first.end_at:
                break
            conflicts.append(
                Conflict(
                    first=first.ref.key,
                    second=second.ref.key,
                    start_at=second.start_at,
                    end_at=min(first.end_at, second.end_at),
                )
            )
    return conflicts


@dataclass(slots=True)
class _Collected:
    """What the sources answered, before reminders are matched against it."""

    # How far "upcoming" looks for events, deadlines, payments, and reminders, in days.
    horizon_days: int
    # Sources the person left out; they aren't read at all.
    hidden: frozenset[Source]
    unavailable: list[Source] = field(default_factory=list[Source])
    loaded_at: dict[Source, datetime] = field(default_factory=dict[Source, datetime])
    schedule: ScheduleSection | None = None
    tasks: TaskSection | None = None
    deadlines: DeadlineSection | None = None
    reminders: ReminderSection | None = None
    payments: PaymentSection | None = None
    budgets: BudgetSection | None = None
    goals: tuple[BriefingSavingsGoal, ...] | None = None
    habits: HabitSection | None = None
    routines: RoutineSection | None = None
    health: HealthSection | None = None
    notes: NoteSection | None = None
    documents: DocumentSection | None = None
    shopping: ShoppingSection | None = None
    investments: InvestmentSection | None = None
    people: PeopleSection | None = None
    upcoming_tasks: TaskList | None = None

    def task_ids(self) -> set[uuid.UUID]:
        ids: set[uuid.UUID] = set()
        if self.tasks is not None:
            for bucket in (self.tasks.overdue, self.tasks.due_today, self.tasks.high_priority):
                ids.update(item.ref.id for item in bucket.items)
        if self.upcoming_tasks is not None:
            ids.update(item.ref.id for item in self.upcoming_tasks.items)
        if self.schedule is not None:
            ids.update(block.ref.id for block in self.schedule.time_blocks)
        return ids


class BriefingAggregator:
    def __init__(
        self,
        *,
        tasks: TaskSource,
        calendar: CalendarSource,
        reminders: ReminderSource,
        payments: PaymentSource,
        budgets: BudgetSource,
        goals: SavingsGoalSource,
        habits: HabitSource,
        routines: RoutineSource,
        health: HealthSource,
        notes: NoteSource,
        documents: DocumentSource,
        shopping: ShoppingSource,
        people: PeopleSource,
        investments: InvestmentSource,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._tasks = tasks
        self._calendar = calendar
        self._reminders = reminders
        self._payments = payments
        self._budgets = budgets
        self._goals = goals
        self._habits = habits
        self._routines = routines
        self._health = health
        self._notes = notes
        self._documents = documents
        self._shopping = shopping
        self._people = people
        self._investments = investments
        self._transaction = transaction
        self._clock = clock

    async def collect(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        timezone: str,
        settings: BriefingSettings | None = None,
    ) -> BriefingContent:
        """The day `day` in `timezone` for this person in this workspace, as `settings` ask
        (the defaults when `None`)."""
        settings = settings or BriefingSettings()
        window = day_window(day, timezone)
        now = self._clock()
        got = _Collected(horizon_days=settings.horizon_days, hidden=settings.hidden)

        async def load[T](name: Source, loader: Callable[[], Awaitable[T]]) -> T | None:
            if name in got.hidden:
                return None
            try:
                result = await loader()
            # A deliberate boundary: one module failing must not take the briefing down. The
            # error is logged with its traceback (no record content), the source is reported as
            # unavailable, and the session is rolled back so the next source starts clean.
            except Exception:
                logger.exception(
                    "Briefing source %r failed to load for workspace %s.", name, workspace_id
                )
                await self._transaction.rollback()
                got.unavailable.append(name)
                return None
            got.loaded_at[name] = self._clock()
            return result

        horizon = got.horizon_days
        horizon_end = day + timedelta(days=horizon)
        tasks = await load("tasks", lambda: self._task_sections(workspace_id, window, horizon_end))
        if tasks is not None:
            got.tasks, got.upcoming_tasks = tasks
        got.schedule = await load("calendar", lambda: self._schedule(workspace_id, window, horizon))
        got.payments = await load(
            "payments", lambda: self._payment_section(workspace_id, day, horizon)
        )
        got.budgets = await load("budgets", lambda: self._budget_section(workspace_id, day))
        got.goals = await load("goals", lambda: self._savings_goals(workspace_id, day))
        got.investments = await load(
            "investments", lambda: self._investment_section(workspace_id, day, horizon)
        )
        got.habits = await load("habits", lambda: self._habit_section(workspace_id, day, timezone))
        got.routines = await load("routines", lambda: self._routine_section(workspace_id, day))
        owner = Owner(workspace_id=workspace_id, user_id=user_id)
        got.health = await load("health", lambda: self._health_section(owner, window))
        got.documents = await load(
            "documents", lambda: self._document_section(workspace_id, day, horizon)
        )
        got.shopping = await load("shopping", lambda: self._shopping_section(workspace_id))
        got.people = await load("people", lambda: self._people_section(workspace_id, day, horizon))
        got.notes = await load("notes", lambda: self._note_section(workspace_id, got))
        reminders = await load(
            "reminders", lambda: self._reminder_section(workspace_id, window, got)
        )
        if reminders is not None:
            got.reminders, task_reminders = reminders
            _attach_reminders(got, task_reminders)
        if got.upcoming_tasks is not None or got.goals is not None:
            got.deadlines = DeadlineSection(
                tasks=got.upcoming_tasks or TaskList(items=(), total=0),
                savings_goals=got.goals or (),
            )
        return self._assemble(window, now, got)

    def _assemble(self, window: DayWindow, now: datetime, got: _Collected) -> BriefingContent:
        counts = _source_counts(got)
        unavailable: tuple[Source, ...] = tuple(s for s in SOURCES if s in got.unavailable)
        sources = tuple(
            SourceState(
                module=source,
                status="off"
                if source in got.hidden
                else "unavailable"
                if source in got.unavailable
                else ("ok" if counts[source] else "empty"),
                items=counts[source],
                loaded_at=got.loaded_at.get(source, now),
            )
            for source in SOURCES
        )
        content = BriefingContent(
            window=window,
            horizon_days=got.horizon_days,
            # Filled in below, from the finished sections.
            summary=EMPTY_SUMMARY,
            sources=sources,
            schedule=got.schedule,
            tasks=got.tasks,
            deadlines=got.deadlines,
            reminders=got.reminders,
            payments=got.payments,
            budgets=got.budgets,
            habits=got.habits,
            routines=got.routines,
            health=got.health,
            notes=got.notes,
            unavailable=unavailable,
            documents=got.documents,
            shopping=got.shopping,
            people=got.people,
            investments=got.investments,
        )
        return replace(content, summary=summarize(content))

    # Tasks

    async def _task_sections(
        self, workspace_id: uuid.UUID, window: DayWindow, horizon_end: date
    ) -> tuple[TaskSection, TaskList]:
        day = window.date
        overdue = await self._tasks.find(
            workspace_id,
            TaskQuery(
                status="open", due_to=day - timedelta(days=1), sort="due_date", limit=ITEM_LIMIT
            ),
        )
        due_today = await self._tasks.find(
            workspace_id,
            TaskQuery(status="open", due_from=day, due_to=day, sort="priority", limit=ITEM_LIMIT),
        )
        # High-priority tasks due today or before are already listed; sorting by due date puts
        # them first (undated last), so skipping that many leaves the rest in order.
        high: frozenset[TaskPriority] = frozenset({"high"})
        high_due = await self._tasks.find(
            workspace_id, TaskQuery(status="open", priorities=high, due_to=day, limit=1)
        )
        high_rest = await self._tasks.find(
            workspace_id,
            TaskQuery(
                status="open",
                priorities=high,
                sort="due_date",
                limit=ITEM_LIMIT,
                offset=high_due.total,
            ),
        )
        upcoming = await self._tasks.find(
            workspace_id,
            TaskQuery(
                status="open",
                due_from=day + timedelta(days=1),
                due_to=horizon_end,
                sort="due_date",
                limit=ITEM_LIMIT,
            ),
        )
        # Completed since the start of yesterday, in the person's time zone.
        since, _ = window_instants(day - timedelta(days=1), day, window.timezone)
        completed = await self._tasks.find(
            workspace_id, TaskQuery(status="completed", sort="completed_at", limit=TASK_SCAN)
        )
        recent = [
            task
            for task in completed.tasks
            if task.completed_at is not None and since <= task.completed_at
        ]
        section = TaskSection(
            overdue=TaskList(
                items=tuple(_task(task, "warning") for task in overdue.tasks), total=overdue.total
            ),
            due_today=TaskList(
                items=tuple(
                    _task(task, "warning" if task.priority == "high" else "info")
                    for task in due_today.tasks
                ),
                total=due_today.total,
            ),
            high_priority=TaskList(
                items=tuple(_task(task, "info") for task in high_rest.tasks),
                total=max(high_rest.total - high_due.total, 0),
            ),
            completed=TaskList(
                items=tuple(_task(task, "info") for task in recent[:ITEM_LIMIT]),
                total=len(recent),
            ),
        )
        later = TaskList(
            items=tuple(_task(task, "info") for task in upcoming.tasks), total=upcoming.total
        )
        return section, later

    # Calendar

    async def _schedule(
        self, workspace_id: uuid.UUID, window: DayWindow, horizon: int
    ) -> ScheduleSection:
        day = window.date
        result = await self._calendar.range(
            workspace_id,
            DateWindow(
                start=day,
                end=day + timedelta(days=1 + horizon),
                timezone=window.timezone,
                include_tasks=True,
                include_completed_tasks=True,
            ),
        )
        confirmed = sorted(
            (item for item in result.occurrences if item.status != "cancelled"), key=_event_order
        )
        today = [
            item
            for item in confirmed
            # The calendar's own rules: all-day occurrences by date, timed ones by instant (an
            # instant event at the window's start counts).
            if (
                in_date_window(item, day, day + timedelta(days=1))
                if item.event.all_day
                else item.start_at < window.end
                and (item.end_at > window.start or item.start_at >= window.start)
            )
        ]
        later = [
            item for item in confirmed if not item.event.all_day and item.start_at >= window.end
        ]
        events = [_event(item) for item in today]
        conflicts = find_conflicts(events)
        clashing = {key for conflict in conflicts for key in (conflict.first, conflict.second)}
        events = [
            replace(event, severity="warning") if event.ref.key in clashing else event
            for event in events
        ]
        blocks = sorted(
            (
                TimeBlock(
                    ref=_task_ref(task),
                    title=task.title,
                    start_at=task.scheduled_start,
                    end_at=task.scheduled_end,
                    completed=task.status == "completed",
                )
                for task in result.scheduled_tasks
                if task.scheduled_start is not None
                and task.scheduled_end is not None
                and task.scheduled_start < window.end
                and task.scheduled_end > window.start
            ),
            key=lambda block: (block.start_at, block.ref.key),
        )
        return ScheduleSection(
            events=tuple(events),
            time_blocks=tuple(blocks[:ITEM_LIMIT]),
            conflicts=tuple(conflicts),
            upcoming=tuple(_event(item) for item in later[:ITEM_LIMIT]),
        )

    # Finance

    async def _payment_section(
        self, workspace_id: uuid.UUID, day: date, horizon: int
    ) -> PaymentSection:
        items = await self._payments.payments(
            workspace_id,
            PaymentQuery(
                today=day,
                date_from=day,
                date_to=day + timedelta(days=horizon),
                statuses=frozenset({"overdue", "due", "upcoming"}),
                include_overdue=True,
            ),
        )
        severity: dict[str, Severity] = {"overdue": "critical", "due": "warning"}
        ordered = sorted(
            items,
            key=lambda item: (
                item.status != "overdue",
                item.due_date,
                item.name.casefold(),
                str(item.commitment_id),
            ),
        )
        return PaymentSection(
            items=tuple(
                BriefingPayment(
                    ref=SourceRef(
                        module="payments",
                        type="commitment",
                        id=item.commitment_id,
                        occurrence=item.due_date.isoformat(),
                    ),
                    kind=item.kind,
                    name=item.name,
                    counterparty=item.counterparty,
                    amount=item.amount,
                    estimated=item.estimated,
                    currency=item.currency,
                    due_date=item.due_date,
                    status=item.status,
                    severity=severity.get(item.status, "info"),
                )
                for item in ordered[:ITEM_LIMIT]
            ),
            overdue=sum(1 for item in items if item.status == "overdue"),
            due_today=sum(1 for item in items if item.status == "due"),
            upcoming=sum(1 for item in items if item.status == "upcoming"),
        )

    async def _budget_section(self, workspace_id: uuid.UUID, day: date) -> BudgetSection:
        budgets: list[BriefingBudget] = []
        for view in await self._budgets.views(workspace_id, day):
            if view.status != "active" or view.current is None:
                continue
            period, used = view.current.period, view.current.utilization
            budgets.append(
                BriefingBudget(
                    ref=SourceRef(module="budgets", type="budget", id=view.budget.id),
                    name=view.budget.name,
                    scope=view.budget.scope,
                    currency=view.budget.currency,
                    period_start=period.start,
                    period_end=period.end,
                    available=used.available,
                    spent=used.spent,
                    remaining=used.remaining,
                    utilization_bps=used.utilization_bps,
                    status=used.status,
                    severity=_BUDGET_SEVERITY[used.status],
                )
            )
        budgets.sort(
            key=lambda b: (
                SEVERITY_RANK[b.severity],
                -(b.utilization_bps if b.utilization_bps is not None else -1),
                b.name.casefold(),
                str(b.ref.id),
            )
        )
        return BudgetSection(
            items=tuple(budgets[:ITEM_LIMIT]),
            exceeded=sum(1 for b in budgets if b.status == "exceeded"),
            approaching=sum(1 for b in budgets if b.status in ("approaching", "near")),
        )

    async def _savings_goals(
        self, workspace_id: uuid.UUID, day: date
    ) -> tuple[BriefingSavingsGoal, ...]:
        near = day + timedelta(days=GOAL_HORIZON_DAYS)
        goals = [
            BriefingSavingsGoal(
                ref=SourceRef(module="goals", type="savings_goal", id=view.goal.id),
                name=view.goal.name,
                currency=view.goal.currency,
                target_amount=view.goal.target_amount,
                saved=view.progress.saved,
                progress_bps=view.progress.progress_bps,
                target_date=view.goal.target_date,
                severity="warning" if view.goal.target_date < day else "info",
            )
            for view in await self._goals.views(workspace_id, day)
            if view.goal.state == "active"
            and not view.progress.reached
            and view.goal.target_date is not None
            and view.goal.target_date <= near
        ]
        goals.sort(key=lambda g: (g.target_date, g.name.casefold(), str(g.ref.id)))
        return tuple(goals[:ITEM_LIMIT])

    # Habits and routines

    async def _habit_section(
        self, workspace_id: uuid.UUID, day: date, timezone: str
    ) -> HabitSection:
        view = await self._habits.today(workspace_id, day, timezone)
        habits: list[BriefingHabit] = []
        remaining = done = 0
        for item in view.habits:
            # Only habits the habits module says are due today (or done anyway). An open day of
            # a weekly target counts only while the week still needs days.
            if item.state in _HABIT_UNSCHEDULED:
                continue
            is_remaining = habit_is_remaining(item)
            is_done = item.state in ("completed", "bonus")
            if item.state == "open" and not is_remaining:
                continue
            remaining += is_remaining
            done += is_done
            habits.append(
                BriefingHabit(
                    ref=SourceRef(module="habits", type="habit", id=item.habit.id),
                    name=item.habit.name,
                    kind=item.habit.kind,
                    state=item.state,
                    done=is_done,
                    current_streak=item.current_streak,
                    streak_unit=item.streak_unit,
                    week_done=item.week_done,
                    week_due=item.week_due,
                )
            )
        return HabitSection(habits=tuple(habits), remaining=remaining, done=done)

    async def _routine_section(self, workspace_id: uuid.UUID, day: date) -> RoutineSection:
        weekday = WEEKDAYS[day.weekday()]
        routines: list[BriefingRoutine] = []
        for detail in await self._routines.find(workspace_id, ("active",)):
            routine = detail.routine
            if routine.weekdays and weekday not in routine.weekdays:
                continue
            active, last = detail.active_session, detail.last_session
            state: RoutineState
            if active is not None and active.day == day:
                state = "in_progress"
            elif last is not None and last.day == day and last.status == "completed":
                state = "completed"
            else:
                state = "not_started"
            routines.append(
                BriefingRoutine(
                    ref=SourceRef(module="routines", type="routine", id=routine.id),
                    name=routine.name,
                    time_of_day=routine.time_of_day.strftime("%H:%M")
                    if routine.time_of_day
                    else None,
                    state=state,
                    steps=len(routine.steps),
                    estimated_minutes=routine.estimated_minutes,
                )
            )
        routines.sort(
            key=lambda r: (
                r.time_of_day is None,
                r.time_of_day or "",
                r.name.casefold(),
                str(r.ref.id),
            )
        )
        return RoutineSection(routines=tuple(routines[:ITEM_LIMIT]))

    # Health

    async def _health_section(self, owner: Owner, window: DayWindow) -> HealthSection:
        day = window.date
        scheduled = await self._health.scheduled(owner, day, window.timezone)
        active = await self._health.active(owner)
        completed = await self._health.completed(owner, day)
        goals = await self._health.goals(owner, day)
        logged: set[uuid.UUID | None] = {s.session.calendar_event_id for s in completed}
        if active is not None:
            logged.add(active.session.calendar_event_id)
        workouts: list[BriefingWorkout] = [
            BriefingWorkout(
                ref=SourceRef(
                    module="health",
                    type="event",
                    id=item.calendar_event_id,
                    occurrence=item.start_at.isoformat() if item.start_at else None,
                ),
                name=item.title,
                state="scheduled",
                start_at=item.start_at,
                end_at=item.end_at,
            )
            # A scheduled workout already started or done today shows once, as that session.
            for item in scheduled
            if item.calendar_event_id not in logged
        ]
        if active is not None:
            workouts.append(
                BriefingWorkout(
                    ref=SourceRef(module="health", type="workout", id=active.session.id),
                    name=active.session.name,
                    state="in_progress",
                    start_at=active.session.started_at,
                    end_at=None,
                )
            )
        workouts.sort(key=lambda w: (w.start_at is None, w.start_at or window.start, w.ref.key))
        done = [
            BriefingWorkout(
                ref=SourceRef(module="health", type="workout", id=s.session.id),
                name=s.session.name,
                state="completed",
                start_at=s.session.started_at,
                end_at=s.session.ended_at,
            )
            for s in sorted(completed, key=lambda s: (s.session.started_at, str(s.session.id)))
        ]
        return HealthSection(
            workouts=tuple([*workouts, *done][:ITEM_LIMIT]),
            goals=tuple(
                BriefingFitnessGoal(
                    ref=SourceRef(module="health", type="fitness_goal", id=g.goal.id),
                    name=g.goal.details.name,
                    category=g.goal.details.category,
                    pace=g.pace,
                    reached=g.reached,
                    target_date=g.goal.details.target_date,
                    severity="info",
                )
                for g in sorted(
                    goals,
                    key=lambda g: (
                        g.goal.details.target_date is None,
                        g.goal.details.target_date or day,
                        g.goal.details.name.casefold(),
                        str(g.goal.id),
                    ),
                )[:ITEM_LIMIT]
            ),
        )

    # Documents, shopping, and investments

    async def _document_section(
        self, workspace_id: uuid.UUID, day: date, horizon: int
    ) -> DocumentSection:
        soon = day + timedelta(days=SOON_DAYS)
        expired, expired_total = await self._documents.find(
            workspace_id,
            DocumentQuery(
                expiry=DateRange(None, day - timedelta(days=1)),
                sort="expiry",
                order="desc",
                limit=ITEM_LIMIT,
            ),
        )
        expiring, expiring_total = await self._documents.find(
            workspace_id,
            DocumentQuery(
                expiry=DateRange(day, day + timedelta(days=DOCUMENT_HORIZON_DAYS)),
                sort="expiry",
                order="asc",
                limit=ITEM_LIMIT,
            ),
        )
        renewals, _ = await self._documents.find(
            workspace_id,
            DocumentQuery(
                renewal=DateRange(day, day + timedelta(days=horizon)),
                sort="expiry",
                order="asc",
                limit=ITEM_LIMIT,
            ),
        )

        def item(document: Document, kind: DocumentDateKind, when: date) -> BriefingDocument:
            lapsed = when < day
            return BriefingDocument(
                ref=SourceRef(module="documents", type="document", id=document.id),
                title=document.title,
                kind=kind,
                date=when,
                lapsed=lapsed,
                severity="warning" if lapsed or when <= soon else "info",
            )

        lapsed = [
            item(d, "expiry", d.details.expiry_date)
            for d in expired
            if d.details.expiry_date is not None
        ]
        coming = [
            item(d, "expiry", d.details.expiry_date)
            for d in expiring
            if d.details.expiry_date is not None
        ] + [
            item(d, "renewal", d.details.renewal_date)
            for d in renewals
            if d.details.renewal_date is not None
        ]
        coming.sort(key=lambda d: (d.date, d.kind, d.title.casefold(), str(d.ref.id)))
        return DocumentSection(
            items=tuple([*lapsed, *coming][:ITEM_LIMIT]),
            expired=expired_total,
            expiring=expiring_total,
        )

    async def _shopping_section(self, workspace_id: uuid.UUID) -> ShoppingSection:
        lists = [entry for entry in await self._shopping.overview(workspace_id) if entry.needed]
        lists.sort(
            key=lambda e: (
                not e.shopping_list.is_default,
                -e.needed,
                e.shopping_list.name.casefold(),
                str(e.shopping_list.id),
            )
        )
        return ShoppingSection(
            lists=tuple(
                BriefingShoppingList(
                    ref=SourceRef(
                        module="shopping", type="shopping_list", id=entry.shopping_list.id
                    ),
                    name=entry.shopping_list.name,
                    needed=entry.needed,
                )
                for entry in lists[:ITEM_LIMIT]
            ),
            needed=sum(entry.needed for entry in lists),
        )

    async def _people_section(
        self, workspace_id: uuid.UUID, day: date, horizon: int
    ) -> PeopleSection:
        """Dates from today through the horizon, soonest first; names and dates only."""
        coming: list[BriefingPersonDate] = []
        for person in await self._people.people(workspace_id):
            for entry in person.dates:
                on = next_occurrence(entry, day)
                days_away = (on - day).days
                if days_away > horizon:
                    continue
                coming.append(
                    BriefingPersonDate(
                        ref=SourceRef(module="people", type="person", id=person.id),
                        name=person.name,
                        kind=entry.kind,
                        label=entry.label,
                        on=on,
                        days_away=days_away,
                        years=years_on(entry, on) or None,
                    )
                )
        coming.sort(key=lambda item: (item.days_away, item.name.casefold(), str(item.ref.id)))
        return PeopleSection(
            items=tuple(coming[:ITEM_LIMIT]),
            today=sum(1 for item in coming if item.days_away == 0),
            total=len(coming),
        )

    async def _investment_section(
        self, workspace_id: uuid.UUID, day: date, horizon: int
    ) -> InvestmentSection:
        end = day + timedelta(days=horizon)
        book = await self._investments.book(workspace_id, day)
        names = {view.holding.id: view.holding.name for view in book.holdings}
        sips = sorted(
            (
                BriefingSip(
                    ref=SourceRef(
                        module="investments",
                        type="sip",
                        id=view.plan.id,
                        occurrence=view.next_due_date.isoformat(),
                    ),
                    holding_name=names.get(view.plan.holding_id, ""),
                    amount=view.plan.amount,
                    currency=view.plan.currency,
                    due_date=view.next_due_date,
                    auto_debit=view.plan.auto_debit,
                    # A manual installment due today is the person's to record.
                    severity="warning"
                    if view.next_due_date == day and not view.plan.auto_debit
                    else "info",
                )
                for view in await self._investments.sip_plans(workspace_id, day)
                if view.plan.state == "active"
                and view.next_due_date is not None
                and view.next_due_date <= end
            ),
            key=lambda s: (s.due_date, s.holding_name.casefold(), str(s.ref.id)),
        )
        deposits = sorted(
            (
                BriefingDeposit(
                    ref=SourceRef(module="investments", type="deposit", id=view.deposit.id),
                    name=view.deposit.name,
                    institution=view.deposit.institution,
                    maturity_date=view.deposit.maturity_date,
                    projected_maturity_amount=view.projected_maturity_amount,
                    currency=view.deposit.currency,
                    matured=view.deposit.maturity_date < day,
                    severity="warning" if view.deposit.maturity_date < day else "info",
                )
                for view in book.deposits
                if view.deposit.status == "active" and view.deposit.maturity_date <= end
            ),
            key=lambda d: (d.maturity_date, d.name.casefold(), str(d.ref.id)),
        )
        return InvestmentSection(
            sips=tuple(sips[:ITEM_LIMIT]), deposits=tuple(deposits[:ITEM_LIMIT])
        )

    # Notes

    async def _note_section(self, workspace_id: uuid.UUID, got: _Collected) -> NoteSection:
        event_keys: dict[uuid.UUID, list[str]] = {}
        if got.schedule is not None:
            for event in got.schedule.events:
                event_keys.setdefault(event.ref.id, []).append(event.ref.key)
        task_ids = sorted(got.task_ids(), key=str)
        matches = await self._notes.linked_to(workspace_id, task_ids, sorted(event_keys, key=str))
        linked = [
            BriefingNote(
                ref=SourceRef(module="notes", type="note", id=match.id),
                title=match.title,
                note_type=match.note_type,
                reason="linked",
                linked_to=tuple(
                    sorted(
                        [f"task:{task_id}" for task_id in match.task_ids]
                        + [key for event_id in match.event_ids for key in event_keys[event_id]]
                    )
                ),
                updated_at=match.updated_at,
            )
            for match in matches[:ITEM_LIMIT]
        ]
        shown = {note.ref.id for note in linked}
        pinned = await self._notes.find(
            workspace_id,
            NoteQuery(pinned=True, sort="updated_at", limit=PINNED_NOTE_LIMIT + len(shown)),
        )
        extra = [
            BriefingNote(
                ref=SourceRef(module="notes", type="note", id=item.note.id),
                title=item.note.title,
                note_type=item.note.note_type,
                reason="pinned",
                linked_to=(),
                updated_at=item.note.updated_at,
            )
            for item in pinned.items
            if item.note.id not in shown
        ][:PINNED_NOTE_LIMIT]
        return NoteSection(items=(*linked, *extra))

    # Reminders

    async def _reminder_section(
        self, workspace_id: uuid.UUID, window: DayWindow, got: _Collected
    ) -> tuple[ReminderSection, dict[uuid.UUID, datetime]]:
        horizon = window.end + timedelta(days=got.horizon_days)
        tasks = got.task_ids()
        commitments: set[uuid.UUID] = (
            {item.ref.id for item in got.payments.items} if got.payments is not None else set()
        )
        documents: set[uuid.UUID] = (
            {item.ref.id for item in got.documents.items} if got.documents is not None else set()
        )
        deposits: set[uuid.UUID] = (
            {item.ref.id for item in got.investments.deposits}
            if got.investments is not None
            else set()
        )
        items: list[BriefingReminder] = []
        task_reminders: dict[uuid.UUID, datetime] = {}
        elsewhere = 0
        for view in await self._reminders.upcoming(workspace_id, REMINDER_SCAN):
            at = view.next_occurrence_at
            if at is None or at >= horizon:
                continue
            reminder = view.reminder
            link = reminder.commitment
            # Shown already by what it's about: its task, its event, its payment, or its habit.
            if reminder.task_id is not None and reminder.task_id in tasks:
                if at < window.end:
                    task_reminders.setdefault(reminder.task_id, at)
                elsewhere += 1
                continue
            if link is not None and (
                (link.kind == "calendar_alert" and got.schedule is not None)
                or (link.kind == "habit_reminder" and got.habits is not None)
                or (link.kind in ("loan", "recurring_payment") and link.id in commitments)
                or (link.kind == "document" and link.id in documents)
                or (link.kind == "deposit" and link.id in deposits)
                or (link.kind == "person" and got.people is not None)
            ):
                elsewhere += 1
                continue
            bucket: ReminderBucket
            severity: Severity
            if view.status == "overdue":
                bucket, severity = "overdue", "warning"
            elif at < window.end:
                bucket, severity = "due_today", "info"
            else:
                bucket, severity = "upcoming", "info"
            items.append(
                BriefingReminder(
                    ref=SourceRef(module="reminders", type="reminder", id=reminder.id),
                    title=reminder.title,
                    at=at,
                    bucket=bucket,
                    severity=severity,
                    task_id=reminder.task_id,
                )
            )
        order = {"overdue": 0, "due_today": 1, "upcoming": 2}
        items.sort(key=lambda r: (order[r.bucket], r.at, r.ref.key))
        section = ReminderSection(items=tuple(items[:ITEM_LIMIT]), represented_elsewhere=elsewhere)
        return section, task_reminders


def _attach_reminders(got: _Collected, reminders: dict[uuid.UUID, datetime]) -> None:
    """Show each task's reminder today on the task itself."""
    if not reminders:
        return

    def apply(bucket: TaskList) -> TaskList:
        return replace(
            bucket,
            items=tuple(
                replace(item, reminder_at=reminders[item.ref.id])
                if item.ref.id in reminders
                else item
                for item in bucket.items
            ),
        )

    if got.tasks is not None:
        got.tasks = TaskSection(
            overdue=apply(got.tasks.overdue),
            due_today=apply(got.tasks.due_today),
            high_priority=apply(got.tasks.high_priority),
            completed=got.tasks.completed,
        )
    if got.upcoming_tasks is not None:
        got.upcoming_tasks = apply(got.upcoming_tasks)


def _source_counts(got: _Collected) -> dict[Source, int]:
    def size(bucket: TaskList | None) -> int:
        return len(bucket.items) if bucket is not None else 0

    tasks = got.tasks
    schedule = got.schedule
    health = got.health
    return {
        "tasks": (
            size(tasks.overdue)
            + size(tasks.due_today)
            + size(tasks.high_priority)
            + size(tasks.completed)
            if tasks
            else 0
        )
        + size(got.upcoming_tasks),
        "calendar": len(schedule.events) + len(schedule.upcoming) + len(schedule.time_blocks)
        if schedule
        else 0,
        "reminders": len(got.reminders.items) if got.reminders else 0,
        "payments": len(got.payments.items) if got.payments else 0,
        "budgets": len(got.budgets.items) if got.budgets else 0,
        "goals": len(got.goals) if got.goals else 0,
        "habits": len(got.habits.habits) if got.habits else 0,
        "routines": len(got.routines.routines) if got.routines else 0,
        "health": len(health.workouts) + len(health.goals) if health else 0,
        "notes": len(got.notes.items) if got.notes else 0,
        "documents": len(got.documents.items) if got.documents else 0,
        "shopping": len(got.shopping.lists) if got.shopping else 0,
        "people": len(got.people.items) if got.people else 0,
        "investments": len(got.investments.sips) + len(got.investments.deposits)
        if got.investments
        else 0,
    }
