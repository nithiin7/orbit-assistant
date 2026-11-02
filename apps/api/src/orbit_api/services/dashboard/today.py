"""The dashboard's daily overview: what needs attention today, across modules.

The overview owns no data and repeats no module's rules. It asks each module's own service for
a small, bounded slice (counts and the first few items) and arranges the answers. Each section
loads on its own: a module that fails is logged, reported as unavailable, and the rest of the
overview still loads.

Sections run one after another, because they share the request's database session, which
can't run queries concurrently. Each is a handful of indexed or bounded queries.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal, Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.calendar.models import (
    AgendaPage,
    CalendarRange,
    DateWindow,
    EventOccurrence,
)
from orbit_api.services.commitments.models import PaymentItem, PaymentQuery
from orbit_api.services.documents.models import (
    DateRange,
    Document,
    DocumentCounts,
    DocumentQuery,
)
from orbit_api.services.habits.models import HabitProgress, TodayView
from orbit_api.services.reminders.models import ReminderView
from orbit_api.services.tasks.models import Task, TaskPage, TaskQuery, TaskSummary
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

logger = logging.getLogger(__name__)

Section = Literal["tasks", "events", "reminders", "habits", "documents", "payments"]

# How many items a section lists; counts are always complete.
ITEM_LIMIT = 5
# How far the overview looks for the next appointment, and for payments falling due.
NEXT_EVENT_DAYS = 7
PAYMENT_DAYS = 7
# Documents expiring within this many days need attention.
EXPIRY_DAYS = 30
# Reminders are read soonest first; this bounds how many are counted as pending today.
REMINDER_SCAN = 50


class TaskSource(Protocol):
    async def summarize(self, workspace_id: uuid.UUID, today: date) -> TaskSummary: ...

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage: ...


class CalendarSource(Protocol):
    async def range(self, workspace_id: uuid.UUID, window: DateWindow) -> CalendarRange: ...

    async def agenda(
        self,
        workspace_id: uuid.UUID,
        start: datetime,
        limit: int,
        cursor: str | None = None,
        include_tasks: bool = True,
    ) -> AgendaPage: ...


class ReminderSource(Protocol):
    async def upcoming(self, workspace_id: uuid.UUID, limit: int) -> list[ReminderView]: ...


class HabitSource(Protocol):
    async def today(
        self, workspace_id: uuid.UUID, day: date | None, timezone: str
    ) -> TodayView: ...


class DocumentSource(Protocol):
    async def counts(self, workspace_id: uuid.UUID, today: date) -> DocumentCounts: ...

    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]: ...


class PaymentSource(Protocol):
    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]: ...


@dataclass(frozen=True, slots=True)
class TaskSection:
    summary: TaskSummary
    # The most overdue first.
    overdue: list[Task]
    due_today: list[Task]


@dataclass(frozen=True, slots=True)
class EventSection:
    # Today's occurrences that aren't cancelled, in order; all-day ones first.
    today: list[EventOccurrence]
    # The next occurrence that hasn't started yet, within `NEXT_EVENT_DAYS`.
    next: EventOccurrence | None


@dataclass(frozen=True, slots=True)
class ReminderSection:
    # Enabled reminders whose next occurrence is before the end of today, including any that
    # are already due. Counted over the soonest `REMINDER_SCAN`.
    pending: int
    items: list[ReminderView]


@dataclass(frozen=True, slots=True)
class HabitSection:
    # Habits still to do today, and those done (including extra days).
    remaining: int
    done: int
    # Of the habits tracked today.
    total: int


@dataclass(frozen=True, slots=True)
class DocumentSection:
    expired: int
    expiring: int
    # Expired first (most recently), then the soonest to expire.
    items: list[Document]


@dataclass(frozen=True, slots=True)
class PaymentSection:
    overdue: int
    # Unsettled payments due from today to `PAYMENT_DAYS` ahead.
    due_soon: int
    # Overdue first, then by due date. Amounts are not part of the overview.
    items: list[PaymentItem]


@dataclass(frozen=True, slots=True)
class DailyOverview:
    day: date
    timezone: str
    now: datetime
    tasks: TaskSection | None = None
    events: EventSection | None = None
    reminders: ReminderSection | None = None
    habits: HabitSection | None = None
    documents: DocumentSection | None = None
    payments: PaymentSection | None = None
    # Sections that failed to load; their fields are `None`.
    unavailable: tuple[Section, ...] = field(default=())


def habit_is_remaining(item: HabitProgress) -> bool:
    """Still to do on its day: pending or partly done, or an open day in an unmet period."""
    if item.state in ("pending", "partial"):
        return True
    return item.state == "open" and item.period is not None and item.period.state == "pending"


def summarize_habits(view: TodayView) -> HabitSection:
    remaining = sum(1 for item in view.habits if habit_is_remaining(item))
    done = sum(1 for item in view.habits if item.state in ("completed", "bonus"))
    return HabitSection(remaining=remaining, done=done, total=remaining + done)


def _event_order(occurrence: EventOccurrence) -> tuple[bool, datetime, str]:
    return (not occurrence.event.all_day, occurrence.start_at, occurrence.title)


class DailyOverviewService:
    def __init__(
        self,
        *,
        tasks: TaskSource,
        calendar: CalendarSource,
        reminders: ReminderSource,
        habits: HabitSource,
        documents: DocumentSource,
        payments: PaymentSource,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._tasks = tasks
        self._calendar = calendar
        self._reminders = reminders
        self._habits = habits
        self._documents = documents
        self._payments = payments
        self._transaction = transaction
        self._clock = clock

    async def today(
        self,
        workspace_id: uuid.UUID,
        timezone: str,
        sections: Sequence[Section] | None = None,
    ) -> DailyOverview:
        """Today in `timezone`. `sections` limits what is loaded (all by default)."""
        now = self._clock()
        zone = ZoneInfo(timezone)
        day = now.astimezone(zone).date()
        wanted = set(sections) if sections is not None else None
        unavailable: list[Section] = []

        async def load[T](name: Section, loader: Callable[[], Awaitable[T]]) -> T | None:
            if wanted is not None and name not in wanted:
                return None
            try:
                return await loader()
            # A deliberate boundary: one module failing must not take the overview down. The
            # error is logged with its traceback, the section is reported as unavailable, and
            # the session is rolled back so a failed statement can't poison the next section.
            except Exception:
                logger.exception("Dashboard overview section %r failed to load.", name)
                await self._transaction.rollback()
                unavailable.append(name)
                return None

        tasks = await load("tasks", lambda: self._task_section(workspace_id, day))
        events = await load("events", lambda: self._event_section(workspace_id, day, timezone, now))
        reminders = await load("reminders", lambda: self._reminder_section(workspace_id, day, zone))
        habits = await load("habits", lambda: self._habit_section(workspace_id, day, timezone))
        documents = await load("documents", lambda: self._document_section(workspace_id, day))
        payments = await load("payments", lambda: self._payment_section(workspace_id, day))
        return DailyOverview(
            day=day,
            timezone=timezone,
            now=now,
            tasks=tasks,
            events=events,
            reminders=reminders,
            habits=habits,
            documents=documents,
            payments=payments,
            unavailable=tuple(unavailable),
        )

    async def _task_section(self, workspace_id: uuid.UUID, day: date) -> TaskSection:
        summary = await self._tasks.summarize(workspace_id, day)
        overdue = await self._tasks.find(
            workspace_id,
            TaskQuery(
                status="open",
                due_to=day - timedelta(days=1),
                sort="due_date",
                limit=ITEM_LIMIT,
            ),
        )
        due_today = await self._tasks.find(
            workspace_id,
            TaskQuery(status="open", due_from=day, due_to=day, sort="priority", limit=ITEM_LIMIT),
        )
        return TaskSection(summary=summary, overdue=overdue.tasks, due_today=due_today.tasks)

    async def _event_section(
        self, workspace_id: uuid.UUID, day: date, timezone: str, now: datetime
    ) -> EventSection:
        window = DateWindow(
            start=day, end=day + timedelta(days=1), timezone=timezone, include_tasks=False
        )
        result = await self._calendar.range(workspace_id, window)
        today = sorted(
            (item for item in result.occurrences if item.status != "cancelled"), key=_event_order
        )
        # The agenda lists what hasn't ended; the next appointment is the first not yet begun.
        agenda = await self._calendar.agenda(
            workspace_id, now, limit=ITEM_LIMIT * 4, include_tasks=False
        )
        horizon = now + timedelta(days=NEXT_EVENT_DAYS)
        upcoming = next(
            (
                item.occurrence
                for item in agenda.items
                if item.occurrence is not None
                and not item.occurrence.event.all_day
                and now <= item.occurrence.start_at < horizon
            ),
            None,
        )
        return EventSection(today=today, next=upcoming)

    async def _reminder_section(
        self, workspace_id: uuid.UUID, day: date, zone: ZoneInfo
    ) -> ReminderSection:
        end_of_day = datetime.combine(day + timedelta(days=1), datetime.min.time(), zone)
        views = await self._reminders.upcoming(workspace_id, REMINDER_SCAN)
        pending = [
            view
            for view in views
            if view.next_occurrence_at is not None and view.next_occurrence_at < end_of_day
        ]
        return ReminderSection(pending=len(pending), items=pending[:ITEM_LIMIT])

    async def _habit_section(
        self, workspace_id: uuid.UUID, day: date, timezone: str
    ) -> HabitSection:
        return summarize_habits(await self._habits.today(workspace_id, day, timezone))

    async def _document_section(self, workspace_id: uuid.UUID, day: date) -> DocumentSection:
        counts = await self._documents.counts(workspace_id, day)
        expired, _ = await self._documents.find(
            workspace_id,
            DocumentQuery(
                expiry=DateRange(None, day - timedelta(days=1)),
                sort="expiry",
                order="desc",
                limit=ITEM_LIMIT,
            ),
        )
        expiring, _ = await self._documents.find(
            workspace_id,
            DocumentQuery(
                expiry=DateRange(day, day + timedelta(days=EXPIRY_DAYS)),
                sort="expiry",
                order="asc",
                limit=ITEM_LIMIT,
            ),
        )
        return DocumentSection(
            expired=counts.expired,
            expiring=counts.expiring_30,
            items=[*expired, *expiring][:ITEM_LIMIT],
        )

    async def _payment_section(self, workspace_id: uuid.UUID, day: date) -> PaymentSection:
        items = await self._payments.payments(
            workspace_id,
            PaymentQuery(
                today=day,
                date_from=day,
                date_to=day + timedelta(days=PAYMENT_DAYS),
                statuses=frozenset({"overdue", "due", "upcoming"}),
                include_overdue=True,
            ),
        )
        overdue = [item for item in items if item.status == "overdue"]
        soon = [item for item in items if item.status != "overdue"]
        ordered = sorted(overdue, key=lambda item: item.due_date) + sorted(
            soon, key=lambda item: item.due_date
        )
        return PaymentSection(overdue=len(overdue), due_soon=len(soon), items=ordered[:ITEM_LIMIT])
