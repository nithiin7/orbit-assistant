"""Structured context: exact answers from the modules' own services, for the modules a question
is about and the person allows.

Numbers here are Orbit's, not the model's: spending totals, budget use, streaks, counts, and
dates come from the modules' calculations (or, for a total of listed figures, from integer
arithmetic in this file), and are handed to the model as facts to repeat. Each module loads on
its own: a failure is logged, the session is rolled back, and the rest still answers.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Final, Protocol

from orbit_api.services.ai.models import AiModule, RecordRef
from orbit_api.services.ai.routing import Route
from orbit_api.services.budgets.models import BudgetView
from orbit_api.services.calendar.models import CalendarRange, DateWindow, EventOccurrence
from orbit_api.services.commitments.models import PaymentItem, PaymentQuery
from orbit_api.services.documents.models import DateRange, Document, DocumentCounts, DocumentQuery
from orbit_api.services.finance.models import AccountView, CashFlow, Category, CategorySpending
from orbit_api.services.finance.money import CURRENCY_EXPONENTS, Currency, month_bounds
from orbit_api.services.fitness.models import Overview, Owner, SessionStatus, SessionSummary
from orbit_api.services.habits.models import HabitProgress, HabitStatus
from orbit_api.services.notes.models import NotePage, NoteQuery
from orbit_api.services.reminders.models import ReminderView
from orbit_api.services.tasks.models import Task, TaskPage, TaskQuery, TaskSummary
from orbit_api.services.transactions import Transaction

logger = logging.getLogger(__name__)

ITEMS: Final = 15


class TaskSource(Protocol):
    async def summarize(self, workspace_id: uuid.UUID, today: date) -> TaskSummary: ...

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage: ...


class CalendarSource(Protocol):
    async def range(self, workspace_id: uuid.UUID, window: DateWindow) -> CalendarRange: ...


class ReminderSource(Protocol):
    async def upcoming(self, workspace_id: uuid.UUID, limit: int) -> list[ReminderView]: ...


class FinanceSource(Protocol):
    async def accounts(
        self, workspace_id: uuid.UUID, as_of: date | None = None
    ) -> list[AccountView]: ...

    async def categories(self, workspace_id: uuid.UUID) -> list[Category]: ...

    async def cash_flow(
        self, workspace_id: uuid.UUID, currency: Currency, month: date
    ) -> CashFlow: ...

    async def spending_by_category(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[CategorySpending]: ...


class PaymentSource(Protocol):
    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]: ...


class BudgetSource(Protocol):
    async def views(self, workspace_id: uuid.UUID, today: date) -> list[BudgetView]: ...


class HabitSource(Protocol):
    async def find(
        self, workspace_id: uuid.UUID, statuses: Sequence[HabitStatus] | None
    ) -> list[HabitProgress]: ...


class WorkoutSource(Protocol):
    async def find(
        self,
        owner: Owner,
        *,
        start: date | None = None,
        end: date | None = None,
        statuses: Sequence[SessionStatus] = (),
        limit: int | None = None,
        offset: int = 0,
    ) -> list[SessionSummary]: ...


class HealthSource(Protocol):
    async def overview(self, owner: Owner, day: date, timezone: str) -> Overview: ...


class DocumentSource(Protocol):
    async def counts(self, workspace_id: uuid.UUID, today: date) -> DocumentCounts: ...

    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]: ...


class NoteSource(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> NotePage: ...


@dataclass(frozen=True, slots=True)
class ContextItem:
    ref: RecordRef
    body: str


@dataclass(frozen=True, slots=True)
class ContextBlock:
    module: AiModule
    heading: str
    items: list[ContextItem] = field(default_factory=list[ContextItem])


@dataclass(frozen=True, slots=True)
class Sources:
    tasks: TaskSource
    calendar: CalendarSource
    reminders: ReminderSource
    finance: FinanceSource
    payments: PaymentSource
    budgets: BudgetSource
    habits: HabitSource
    workouts: WorkoutSource
    health: HealthSource
    documents: DocumentSource
    notes: NoteSource


@dataclass(frozen=True, slots=True)
class Viewer:
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    today: date
    timezone: str
    now: datetime


class ContextBuilder:
    def __init__(self, sources: Sources, transaction: Transaction) -> None:
        self._s = sources
        self._transaction = transaction

    @property
    def sources(self) -> Sources:
        return self._s

    async def build(
        self, viewer: Viewer, route: Route, permitted: frozenset[AiModule]
    ) -> tuple[list[ContextBlock], list[AiModule]]:
        """Blocks for the routed modules the person allows, and the modules that failed."""
        loaders: dict[AiModule, Callable[[], Awaitable[list[ContextBlock]]]] = {
            "tasks": lambda: self.tasks(viewer, route),
            "calendar": lambda: self.calendar(viewer, route),
            "reminders": lambda: self.reminders(viewer, route),
            "finance": lambda: self.finance(viewer, route),
            "habits": lambda: self.habits(viewer),
            "health": lambda: self.health(viewer, route),
            "documents": lambda: self.documents(viewer),
            "notes": lambda: self.notes(viewer, route),
        }
        blocks: list[ContextBlock] = []
        failed: list[AiModule] = []
        for module, loader in loaders.items():
            if module not in route.modules or module not in permitted:
                continue
            try:
                blocks += await loader()
            # A deliberate boundary: one module failing must not stop the answer. The error is
            # logged (IDs only) and the session rolled back so the next module can query.
            except Exception:
                logger.exception("AI context for %r failed to load.", module)
                await self._transaction.rollback()
                failed.append(module)
        return blocks, failed

    # Tasks

    async def tasks(self, viewer: Viewer, route: Route) -> list[ContextBlock]:
        ws, today = viewer.workspace_id, viewer.today
        summary = await self._s.tasks.summarize(ws, today)
        items = [
            ContextItem(
                ref=RecordRef(kind="tasks_summary", id=None, title="Task counts", day=today),
                body=(
                    f"Calculated by Orbit on {today:%d %b %Y}: {summary.open} open, "
                    f"{summary.overdue} overdue, {summary.due_today} due today, "
                    f"{summary.completed} completed."
                ),
            )
        ]
        if route.start is not None and route.end is not None:
            page = await self._s.tasks.find(
                ws,
                TaskQuery(
                    status="open",
                    due_from=route.start,
                    due_to=route.end,
                    sort="due_date",
                    limit=ITEMS,
                ),
            )
            heading = f"Open tasks due {route.period}"
            items += [_task_item(t, today) for t in page.tasks]
        else:
            heading = "Overdue and upcoming tasks"
            overdue = await self._s.tasks.find(
                ws,
                TaskQuery(
                    status="open", due_to=today - timedelta(days=1), sort="due_date", limit=10
                ),
            )
            upcoming = await self._s.tasks.find(
                ws,
                TaskQuery(
                    status="open",
                    due_from=today,
                    due_to=today + timedelta(days=7),
                    sort="due_date",
                    limit=10,
                ),
            )
            items += [_task_item(t, today) for t in overdue.tasks + upcoming.tasks]
        blocks = [ContextBlock(module="tasks", heading=heading, items=items)]
        start = route.start or today - timedelta(days=14)
        end = route.end or today
        if _mentions(route, "complet", "done", "finish", "productiv", "working on", "worked on"):
            done = await self._s.tasks.find(
                ws, TaskQuery(status="completed", sort="completed_at", limit=50)
            )
            completed = [
                t
                for t in done.tasks
                if t.completed_at is not None and start <= t.completed_at.date() <= end
            ]
            blocks.append(
                ContextBlock(
                    module="tasks",
                    heading=f"Completed {start:%d %b} to {end:%d %b} ({len(completed)} tasks)",
                    items=[_task_item(t, today) for t in completed[:ITEMS]],
                )
            )
        return blocks

    # Calendar

    async def calendar(self, viewer: Viewer, route: Route) -> list[ContextBlock]:
        start = route.start or viewer.today
        end = route.end or viewer.today + timedelta(days=7)
        window = DateWindow(
            start=start, end=end + timedelta(days=1), timezone=viewer.timezone, include_tasks=False
        )
        result = await self._s.calendar.range(viewer.workspace_id, window)
        occurrences = sorted(
            (o for o in result.occurrences if o.status != "cancelled"), key=lambda o: o.start_at
        )
        items = [_event_item(o) for o in occurrences[:25]]
        conflicts = find_conflicts(occurrences)
        if conflicts:
            lines = [
                f"{a.title} ({a.start:%a %d %b %H:%M}) overlaps {b.title} ({b.start:%H:%M})"
                for a, b in conflicts[:10]
            ]
            items.append(
                ContextItem(
                    ref=RecordRef(
                        kind="calendar_summary", id=None, title="Overlapping events", day=start
                    ),
                    body="Calculated by Orbit: " + "; ".join(lines) + ".",
                )
            )
        heading = f"Calendar from {start:%a %d %b} to {end:%a %d %b} ({len(occurrences)} events)"
        return [ContextBlock(module="calendar", heading=heading, items=items)]

    # Reminders

    async def reminders(self, viewer: Viewer, route: Route) -> list[ContextBlock]:
        views = await self._s.reminders.upcoming(viewer.workspace_id, 25)
        end = route.end or viewer.today + timedelta(days=14)
        items = [
            ContextItem(
                ref=RecordRef(
                    kind="reminder",
                    id=v.reminder.id,
                    title=v.reminder.title,
                    day=v.next_occurrence_at.date() if v.next_occurrence_at else None,
                ),
                body=(
                    f"Next: {v.next_occurrence_at:%a %d %b %Y %H:%M} UTC"
                    if v.next_occurrence_at
                    else "No upcoming time"
                ),
            )
            for v in views
            if v.next_occurrence_at is None or v.next_occurrence_at.date() <= end
        ]
        return [ContextBlock(module="reminders", heading="Upcoming reminders", items=items[:ITEMS])]

    # Finance

    async def finance(self, viewer: Viewer, route: Route) -> list[ContextBlock]:
        ws, today = viewer.workspace_id, viewer.today
        start = route.start or today.replace(day=1)
        end = (
            min(route.end or today, today)
            if route.start is None or route.start <= today
            else route.end
        )
        assert end is not None
        accounts = await self._s.finance.accounts(ws)
        currencies: list[Currency] = sorted({view.account.currency for view in accounts})
        names = {c.id: c.name for c in await self._s.finance.categories(ws)}
        blocks: list[ContextBlock] = []
        period = route.period or "this month"
        for currency in currencies:
            items: list[ContextItem] = []
            spending = await self._s.finance.spending_by_category(ws, currency, start, end)
            total = sum(entry.net for entry in spending)
            lines = [
                f"{_category_name(names, e.category_id)}: {format_money(e.net, currency)}"
                for e in spending[:10]
            ]
            body = (
                f"Calculated by Orbit for {start:%d %b %Y} to {end:%d %b %Y}: net spending "
                f"(expenses minus refunds, transfers excluded) {format_money(total, currency)}."
            )
            first, last = month_bounds(start)
            if start == first and end <= last:
                flow = await self._s.finance.cash_flow(ws, currency, start)
                body += (
                    f" Income in {start:%B}: {format_money(flow.income, currency)} across "
                    f"{flow.transactions} transactions."
                )
            if lines:
                body += " By category: " + "; ".join(lines) + "."
            items.append(
                ContextItem(
                    ref=RecordRef(
                        kind="finance_summary",
                        id=None,
                        title=f"Spending {period} ({currency})",
                        day=start,
                        detail=format_money(total, currency),
                    ),
                    body=body,
                )
            )
            blocks.append(
                ContextBlock(module="finance", heading=f"Spending ({currency})", items=items)
            )

        payments = await self._s.payments.payments(
            ws,
            PaymentQuery(
                today=today,
                date_from=today,
                date_to=max(route.end or today, today) + timedelta(days=30),
                include_overdue=True,
            ),
        )
        due = [p for p in payments if p.status != "paid"][:ITEMS]
        if due:
            blocks.append(
                ContextBlock(
                    module="finance",
                    heading="Upcoming and overdue payments (loans, subscriptions, bills)",
                    items=[_payment_item(p) for p in due],
                )
            )
        budgets = [
            view for view in await self._s.budgets.views(ws, today) if view.status == "active"
        ]
        if budgets:
            blocks.append(
                ContextBlock(
                    module="finance",
                    heading="Active budgets (current period)",
                    items=[_budget_item(view) for view in budgets[:ITEMS]],
                )
            )
        return blocks

    # Habits

    async def habits(self, viewer: Viewer) -> list[ContextBlock]:
        progress = await self._s.habits.find(viewer.workspace_id, ("active",))
        items = [_habit_item(p) for p in progress[:25]]
        return [
            ContextBlock(
                module="habits", heading="Active habits (calculated by Orbit)", items=items
            )
        ]

    # Health

    async def health(self, viewer: Viewer, route: Route) -> list[ContextBlock]:
        owner = Owner(workspace_id=viewer.workspace_id, user_id=viewer.user_id)
        start = route.start or viewer.today - timedelta(days=14)
        end = route.end or viewer.today
        sessions = await self._s.workouts.find(owner, start=start, end=end, statuses=("completed",))
        overview = await self._s.health.overview(owner, viewer.today, viewer.timezone)
        items = [
            ContextItem(
                ref=RecordRef(
                    kind="workout", id=s.session.id, title=s.session.name, day=s.session.day
                ),
                body=(
                    f"Workout on {s.session.day:%a %d %b}: {s.exercise_count} exercises, "
                    f"{s.set_count} sets"
                    + (f", {round(s.session.duration_s / 60)} min" if s.session.duration_s else "")
                    + "."
                ),
            )
            for s in sessions[:ITEMS]
        ]
        weight = overview.weight_trend[-1] if overview.weight_trend else None
        summary = (
            f"Calculated by Orbit: {len(sessions)} completed workouts from {start:%d %b} to "
            f"{end:%d %b}; {overview.week_workouts} this week. Today: {overview.water_ml} ml "
            f"water, {overview.nutrition.energy_cal} kcal recorded."
        )
        if weight is not None:
            summary += f" Latest weight: {weight.weight_g / 1000:.1f} kg on {weight.day:%d %b}."
        items.insert(
            0,
            ContextItem(
                ref=RecordRef(
                    kind="health_summary", id=None, title="Health summary", day=viewer.today
                ),
                body=summary,
            ),
        )
        return [
            ContextBlock(module="health", heading="Recorded health and fitness data", items=items)
        ]

    # Documents

    async def documents(self, viewer: Viewer) -> list[ContextBlock]:
        today = viewer.today
        expiring, _ = await self._s.documents.find(
            viewer.workspace_id,
            DocumentQuery(
                expiry=DateRange(today - timedelta(days=30), today + timedelta(days=90)),
                sort="expiry",
                order="asc",
                limit=ITEMS,
            ),
        )
        items = [
            ContextItem(
                ref=RecordRef(
                    kind="document",
                    id=d.id,
                    title=d.title,
                    day=d.details.expiry_date,
                    detail=f"Expires {d.details.expiry_date:%d %b %Y}"
                    if d.details.expiry_date
                    else "",
                ),
                body=f"Expires: {d.details.expiry_date}" if d.details.expiry_date else "",
            )
            for d in expiring
        ]
        return [
            ContextBlock(
                module="documents", heading="Documents expiring recently or soon", items=items
            )
        ]

    # Notes

    async def notes(self, viewer: Viewer, route: Route) -> list[ContextBlock]:
        if not _mentions(route, "recent", "lately", "latest", "last", "journal"):
            return []
        page = await self._s.notes.find(viewer.workspace_id, NoteQuery(limit=8))
        items = [
            ContextItem(
                ref=RecordRef(
                    kind="note",
                    id=item.note.id,
                    title=item.note.title or "Untitled note",
                    day=item.note.updated_at.date(),
                ),
                body=f"Updated {item.note.updated_at:%d %b %Y}. Excerpt: {item.excerpt}",
            )
            for item in page.items
        ]
        return [ContextBlock(module="notes", heading="Recently updated notes", items=items)]


def find_conflicts(
    occurrences: Sequence[EventOccurrence],
) -> list[tuple[EventOccurrence, EventOccurrence]]:
    """Pairs of timed, non-cancelled occurrences that overlap, in start order."""
    timed = sorted(
        (o for o in occurrences if not o.event.all_day and o.status != "cancelled"),
        key=lambda o: o.start_at,
    )
    pairs: list[tuple[EventOccurrence, EventOccurrence]] = []
    for index, first in enumerate(timed):
        for second in timed[index + 1 :]:
            if second.start_at >= first.end_at:
                break
            pairs.append((first, second))
    return pairs


def format_money(amount: int, currency: Currency) -> str:
    """`INR 1,23,456.50`, `USD 1,234.50`: exact, from minor units, grouped like the web app."""
    exponent = CURRENCY_EXPONENTS[currency]
    sign = "-" if amount < 0 else ""
    whole, fraction = divmod(abs(amount), 10**exponent)
    digits = str(whole)
    if currency == "INR" and len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        grouped = ",".join([*groups, tail])
    else:
        grouped = f"{whole:,}"
    decimals = f".{fraction:0{exponent}d}" if exponent else ""
    return f"{currency} {sign}{grouped}{decimals}"


def _category_name(names: dict[uuid.UUID, str], category_id: uuid.UUID | None) -> str:
    return names.get(category_id, "Uncategorized") if category_id else "Uncategorized"


def _mentions(route: Route, *terms: str) -> bool:
    text = " ".join(route.keywords)
    return any(term in text for term in terms) or (
        route.period is not None and "recent" in terms and "recent" in route.period
    )


def _task_item(task: Task, today: date) -> ContextItem:
    due = ""
    if task.due_date is not None:
        overdue = task.status == "open" and task.due_date < today
        due = f", due {task.due_date:%a %d %b %Y}" + (" (overdue)" if overdue else "")
    body = f"Status: {task.status}, priority: {task.priority}{due}."
    if task.completed_at is not None:
        body += f" Completed {task.completed_at:%d %b %Y}."
    if task.description:
        body += f" Notes: {task.description[:300]}"
    return ContextItem(
        ref=RecordRef(kind="task", id=task.id, title=task.title, day=task.due_date), body=body
    )


def _event_item(occurrence: EventOccurrence) -> ContextItem:
    when = (
        f"{occurrence.start:%a %d %b %Y} (all day)"
        if occurrence.event.all_day
        else (
            f"{occurrence.start:%a %d %b %Y %H:%M} to {occurrence.end:%H:%M} "
            f"({occurrence.event.timezone})"
        )
    )
    body = f"When: {when}."
    if occurrence.location:
        body += f" Where: {occurrence.location}."
    if occurrence.description:
        body += f" Details: {occurrence.description[:300]}"
    return ContextItem(
        ref=RecordRef(
            kind="event",
            id=occurrence.event.id,
            title=occurrence.title,
            day=occurrence.start.date(),
            detail=when,
        ),
        body=body,
    )


def _payment_item(payment: PaymentItem) -> ContextItem:
    amount = format_money(payment.amount, payment.currency)
    estimate = " (estimated)" if payment.estimated else ""
    return ContextItem(
        ref=RecordRef(
            kind=payment.kind,
            id=payment.commitment_id,
            title=payment.name,
            day=payment.due_date,
            detail=amount,
        ),
        body=(
            f"{payment.kind.capitalize()} payment of {amount}{estimate} due "
            f"{payment.due_date:%a %d %b %Y}; status: {payment.status}."
            + (f" To: {payment.counterparty}." if payment.counterparty else "")
        ),
    )


def _budget_item(view: BudgetView) -> ContextItem:
    budget = view.budget
    body = f"{budget.name}: no current period."
    if view.current is not None:
        use = view.current.utilization
        percent = f"{use.utilization_bps / 100:.1f}%" if use.utilization_bps is not None else "n/a"
        body = (
            f"Calculated by Orbit for {view.current.period.start:%d %b} to "
            f"{view.current.period.end:%d %b %Y}: spent {format_money(use.spent, budget.currency)} "
            f"of {format_money(use.available, budget.currency)} ({percent}); remaining "
            f"{format_money(use.remaining, budget.currency)}; "
            f"status: {use.status.replace('_', ' ')}."
        )
        if use.projected is not None:
            body += f" Projected by period end: {format_money(use.projected, budget.currency)}."
    return ContextItem(ref=RecordRef(kind="budget", id=budget.id, title=budget.name), body=body)


def _habit_item(progress: HabitProgress) -> ContextItem:
    def rate(value: float | None) -> str:
        return f"{value * 100:.0f}%" if value is not None else "n/a"

    habit = progress.habit
    unit = progress.streak_unit
    body = (
        f"Today: {progress.state.replace('_', ' ')}. Current streak: {progress.current_streak} "
        f"{unit}(s); longest: {progress.longest_streak}. Completion over the last 7 days: "
        f"{rate(progress.weekly_rate)}; last 30 days: {rate(progress.monthly_rate)}; total "
        f"completions: {progress.total_completions}."
    )
    return ContextItem(ref=RecordRef(kind="habit", id=habit.id, title=habit.name), body=body)
