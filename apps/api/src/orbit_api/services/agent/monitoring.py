"""Proactive monitoring: what Orbit checks for the person, in code, at the frequency they chose.

No model is involved and nothing is polled from outside Orbit: each category reads the modules'
own services (the same sources the assistant's structured context uses) and returns findings.
Each finding item has a key with its record and date, so `AutomationService` notifies about an
item once, however often monitoring runs. Categories need the module's permission, and health
data is read only for its owner.
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Protocol

from orbit_api.services.agent.models import (
    MONITOR_MODULE,
    Agent,
    Finding,
    FindingItem,
    MonitorCategory,
)
from orbit_api.services.agent.signals import HabitDays
from orbit_api.services.ai.context import Sources, Viewer, find_conflicts, format_money
from orbit_api.services.ai.models import AiSettings, Insight, RecordRef
from orbit_api.services.calendar.models import DateWindow
from orbit_api.services.commitments.models import PaymentQuery
from orbit_api.services.documents.models import DateRange, DocumentQuery
from orbit_api.services.fitness.models import Owner
from orbit_api.services.tasks.models import TaskQuery
from orbit_api.services.transactions import Transaction

logger = logging.getLogger(__name__)

LIST: int = 5


class InsightSource(Protocol):
    async def insights(self, viewer: Viewer, settings: AiSettings) -> list[Insight]: ...


class Monitor:
    def __init__(
        self,
        sources: Sources,
        insights: InsightSource,
        habits: HabitDays,
        transaction: Transaction,
    ) -> None:
        self._s = sources
        self._insights = insights
        self._habit_days = habits
        self._transaction = transaction

    async def findings(self, agent: Agent, viewer: Viewer) -> list[Finding]:
        settings = agent.monitoring
        checks: dict[MonitorCategory, Callable[[], Awaitable[Finding | None]]] = {
            "overdue_tasks": lambda: self._overdue(viewer),
            "upcoming_deadlines": lambda: self._deadlines(viewer, settings.days_ahead),
            "calendar_conflicts": lambda: self._conflicts(viewer, settings.days_ahead),
            "upcoming_events": lambda: self._events(viewer),
            "upcoming_bills": lambda: self._bills(viewer, settings.days_ahead),
            "budget_warnings": lambda: self._budgets(viewer, settings.budget_percent),
            "unusual_spending": lambda: self._spending(viewer),
            "expiring_documents": lambda: self._documents(viewer, settings.document_days),
            "missing_document_details": lambda: self._missing_details(viewer),
            "missed_habits": lambda: self._habits(viewer),
            "workout_consistency": lambda: self._workouts(viewer),
        }
        found: list[Finding] = []
        for category, check in checks.items():
            if category not in settings.categories or MONITOR_MODULE[category] not in agent.modules:
                continue
            try:
                finding = await check()
            # A deliberate boundary: one module failing must not stop the other checks. IDs
            # only in the log; the session is rolled back so the next check can query.
            except Exception:
                logger.exception("Monitoring %r for agent %s failed.", category, agent.id)
                await self._transaction.rollback()
                continue
            if finding is not None and finding.items:
                found.append(finding)
        return found

    async def _overdue(self, viewer: Viewer) -> Finding | None:
        page = await self._s.tasks.find(
            viewer.workspace_id,
            TaskQuery(
                status="open", due_to=viewer.today - timedelta(days=1), sort="due_date", limit=20
            ),
        )
        if not page.tasks:
            return None
        # One nudge a day while anything is overdue.
        return Finding(
            category="overdue_tasks",
            title=_count(page.total, "overdue task"),
            items=(
                FindingItem(
                    key=f"overdue_tasks:{viewer.today}",
                    label=", ".join(t.title for t in page.tasks[:LIST]),
                ),
            ),
        )

    async def _deadlines(self, viewer: Viewer, days: int) -> Finding | None:
        page = await self._s.tasks.find(
            viewer.workspace_id,
            TaskQuery(
                status="open",
                due_from=viewer.today,
                due_to=viewer.today + timedelta(days=days),
                sort="due_date",
                limit=20,
            ),
        )
        items = tuple(
            FindingItem(
                key=f"deadline:{t.id}:{t.due_date}",
                label=f"{t.title} (due {t.due_date:%a %d %b})",
                ref=RecordRef(kind="task", id=t.id, title=t.title, day=t.due_date),
            )
            for t in page.tasks
            if t.due_date is not None
        )
        return Finding("upcoming_deadlines", f"Due in the next {days} days", items)

    async def _conflicts(self, viewer: Viewer, days: int) -> Finding | None:
        result = await self._s.calendar.range(
            viewer.workspace_id,
            DateWindow(
                start=viewer.today,
                end=viewer.today + timedelta(days=days + 1),
                timezone=viewer.timezone,
                include_tasks=False,
            ),
        )
        items = tuple(
            FindingItem(
                key=f"conflict:{a.event.id}:{a.start_at.isoformat()}:{b.event.id}:"
                f"{b.start_at.isoformat()}",
                label=f"{a.title} ({a.start:%a %d %b %H:%M}) overlaps {b.title}",
                ref=RecordRef(kind="event", id=a.event.id, title=a.title, day=a.start.date()),
            )
            for a, b in find_conflicts(result.occurrences)[:10]
        )
        return Finding("calendar_conflicts", "Overlapping events", items)

    async def _events(self, viewer: Viewer) -> Finding | None:
        result = await self._s.calendar.range(
            viewer.workspace_id,
            DateWindow(
                start=viewer.today,
                end=viewer.today + timedelta(days=2),
                timezone=viewer.timezone,
                include_tasks=False,
            ),
        )
        horizon = viewer.now + timedelta(hours=24)
        items = tuple(
            FindingItem(
                key=f"event:{o.event.id}:{o.start_at.isoformat()}",
                label=f"{o.title} at {o.start:%a %H:%M}",
                ref=RecordRef(kind="event", id=o.event.id, title=o.title, day=o.start.date()),
            )
            for o in sorted(result.occurrences, key=lambda o: o.start_at)
            if o.status != "cancelled"
            and not o.event.all_day
            and viewer.now < o.start_at <= horizon
        )
        return Finding("upcoming_events", "Coming up in the next 24 hours", items[:10])

    async def _bills(self, viewer: Viewer, days: int) -> Finding | None:
        payments = await self._s.payments.payments(
            viewer.workspace_id,
            PaymentQuery(
                today=viewer.today,
                date_from=viewer.today,
                date_to=viewer.today + timedelta(days=days),
            ),
        )
        items = tuple(
            FindingItem(
                key=f"payment:{p.commitment_id}:{p.due_date}",
                label=f"{p.name}: {format_money(p.amount, p.currency)} on {p.due_date:%a %d %b}",
            )
            for p in payments
            if p.status != "paid"
        )
        return Finding("upcoming_bills", "Payments due soon", items[:10])

    async def _budgets(self, viewer: Viewer, percent: int) -> Finding | None:
        items: list[FindingItem] = []
        for view in await self._s.budgets.views(viewer.workspace_id, viewer.today):
            current = view.current
            if view.status != "active" or current is None:
                continue
            used = current.utilization.utilization_bps
            if used is None or used < percent * 100:
                continue
            band = 100 if used >= 10_000 else percent
            items.append(
                FindingItem(
                    key=f"budget:{view.budget.id}:{current.period.start}:{band}",
                    label=f"{view.budget.name}: {used / 100:.0f}% used",
                )
            )
        return Finding("budget_warnings", "Budgets running high", tuple(items))

    async def _spending(self, viewer: Viewer) -> Finding | None:
        found = await self._insights.insights(
            viewer, AiSettings(user_id=viewer.user_id, modules=frozenset({"finance"}))
        )
        items = tuple(
            FindingItem(key=f"spending:{i.key}", label=i.title)
            for i in found
            if i.kind == "spending_trend" and i.tone == "attention"
        )
        return Finding("unusual_spending", "Unusual spending", items)

    async def _documents(self, viewer: Viewer, days: int) -> Finding | None:
        documents, _ = await self._s.documents.find(
            viewer.workspace_id,
            DocumentQuery(
                expiry=DateRange(viewer.today, viewer.today + timedelta(days=days)),
                sort="expiry",
                order="asc",
                limit=20,
            ),
        )
        items = tuple(
            FindingItem(
                key=f"document:{d.id}:{d.details.expiry_date}",
                label=f"{d.title} (expires {d.details.expiry_date:%d %b %Y})",
                ref=RecordRef(kind="document", id=d.id, title=d.title, day=d.details.expiry_date),
            )
            for d in documents
            if d.details.expiry_date is not None
        )
        return Finding("expiring_documents", "Documents expiring soon", items)

    async def _missing_details(self, viewer: Viewer) -> Finding | None:
        documents, _ = await self._s.documents.find(
            viewer.workspace_id, DocumentQuery(sort="updated", limit=50)
        )
        items = tuple(
            FindingItem(
                key=f"details:{d.id}",
                label=d.title,
                ref=RecordRef(kind="document", id=d.id, title=d.title),
            )
            for d in documents
            if d.category_id is None and d.details.expiry_date is None and not d.tags
        )
        return Finding("missing_document_details", "Documents without details", items[:10])

    async def _habits(self, viewer: Viewer) -> Finding | None:
        yesterday = viewer.today - timedelta(days=1)
        view = await self._habit_days.today(viewer.workspace_id, yesterday, viewer.timezone)
        items = tuple(
            FindingItem(key=f"habit:{p.habit.id}:{yesterday}", label=p.habit.name)
            for p in view.habits
            if p.state == "missed"
        )
        return Finding("missed_habits", "Habits missed", items)

    async def _workouts(self, viewer: Viewer) -> Finding | None:
        owner = Owner(workspace_id=viewer.workspace_id, user_id=viewer.user_id)
        recent = await self._s.workouts.find(
            owner,
            start=viewer.today - timedelta(days=6),
            end=viewer.today,
            statuses=("completed",),
        )
        before = await self._s.workouts.find(
            owner,
            start=viewer.today - timedelta(days=13),
            end=viewer.today - timedelta(days=7),
            statuses=("completed",),
        )
        if len(before) < 2 or len(recent) * 2 > len(before):
            return None
        week = viewer.today.isocalendar()
        return Finding(
            "workout_consistency",
            "Fewer workouts than usual",
            (
                FindingItem(
                    key=f"workouts:{week.year}-{week.week}",
                    label=f"{len(recent)} workouts this week, {len(before)} the week before",
                ),
            ),
        )


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}{'' if n == 1 else 's'}"
