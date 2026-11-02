"""Personal insights: a few deterministic observations about recorded data.

Every figure comes from the modules' own calculations; no model is involved, so insights work
with any provider, or none chosen yet, and can't invent anything. Each names its period and the
records behind it, is shown only when there is something worth saying, and can be dismissed:
its key includes the period, so a dismissed insight stays hidden until the period changes.
Insights create no notifications.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable, Sequence
from datetime import date, timedelta
from typing import Final, Protocol

from orbit_api.services.ai.context import ContextBuilder, Viewer, format_money
from orbit_api.services.ai.models import AiModule, AiSettings, Insight, RecordRef
from orbit_api.services.calendar.models import DateWindow
from orbit_api.services.commitments.models import PaymentQuery
from orbit_api.services.documents.models import DateRange, DocumentQuery
from orbit_api.services.finance.money import Currency, add_months, month_bounds
from orbit_api.services.tasks.models import TaskQuery
from orbit_api.services.transactions import Transaction

logger = logging.getLogger(__name__)

# A category's spending must change by at least this share, and this much, to be mentioned.
SPENDING_CHANGE: Final = 0.3
MIN_SPENDING_CHANGE: Final = 1000


class DismissalRepository(Protocol):
    async def keys(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> set[str]: ...

    async def add(self, workspace_id: uuid.UUID, user_id: uuid.UUID, key: str) -> None: ...


class InsightService:
    def __init__(
        self, context: ContextBuilder, dismissals: DismissalRepository, transaction: Transaction
    ) -> None:
        self._sources = context.sources
        self._dismissals = dismissals
        self._transaction = transaction

    async def insights(self, viewer: Viewer, settings: AiSettings) -> list[Insight]:
        generators: list[tuple[AiModule, Callable[[], Awaitable[list[Insight]]]]] = [
            ("finance", lambda: self._spending(viewer)),
            ("finance", lambda: self._budgets(viewer)),
            ("finance", lambda: self._payments(viewer)),
            ("habits", lambda: self._habits(viewer)),
            ("tasks", lambda: self._tasks(viewer)),
            ("calendar", lambda: self._calendar(viewer)),
            ("documents", lambda: self._documents(viewer)),
        ]
        dismissed = await self._dismissals.keys(viewer.workspace_id, viewer.user_id)
        found: list[Insight] = []
        for module, generate in generators:
            if module not in settings.modules:
                continue
            try:
                found += await generate()
            # A deliberate boundary: one module failing must not hide the other insights.
            except Exception:
                logger.exception("Insights for %r failed.", module)
                await self._transaction.rollback()
        return [insight for insight in found if insight.key not in dismissed]

    async def dismiss(self, workspace_id: uuid.UUID, user_id: uuid.UUID, key: str) -> None:
        if key not in await self._dismissals.keys(workspace_id, user_id):
            await self._dismissals.add(workspace_id, user_id, key)
            await self._transaction.commit()

    async def _spending(self, viewer: Viewer) -> list[Insight]:
        """This month so far against the same days of last month, per category."""
        today = viewer.today
        start = today.replace(day=1)
        previous_start = add_months(start, -1)
        _, previous_last = month_bounds(previous_start)
        previous_end = min(previous_start + timedelta(days=today.day - 1), previous_last)
        finance = self._sources.finance
        names = {c.id: c.name for c in await finance.categories(viewer.workspace_id)}
        accounts = await finance.accounts(viewer.workspace_id)
        currencies: list[Currency] = sorted({v.account.currency for v in accounts})
        insights: list[Insight] = []
        for currency in currencies:
            now = await finance.spending_by_category(viewer.workspace_id, currency, start, today)
            then = {
                e.category_id: e.net
                for e in await finance.spending_by_category(
                    viewer.workspace_id, currency, previous_start, previous_end
                )
            }
            changes: list[tuple[int, str]] = []
            rising = False
            for entry in now:
                before = then.get(entry.category_id, 0)
                delta = entry.net - before
                if before > 0 and abs(delta) >= max(before * SPENDING_CHANGE, MIN_SPENDING_CHANGE):
                    name = (
                        names.get(entry.category_id, "Uncategorized")
                        if entry.category_id
                        else "Uncategorized"
                    )
                    direction = "up" if delta > 0 else "down"
                    rising |= delta > 0
                    changes.append(
                        (
                            abs(delta),
                            f"{name}: {format_money(entry.net, currency)}, {direction} from "
                            f"{format_money(before, currency)}",
                        )
                    )
            if not changes:
                continue
            changes.sort(reverse=True)
            insights.append(
                Insight(
                    key=f"spending:{currency}:{start:%Y-%m}:{today:%d}",
                    kind="spending_trend",
                    module="finance",
                    title=f"Spending changes this month ({currency})",
                    body=(
                        f"Compared with the same {today.day} days of last month: "
                        + "; ".join(text for _, text in changes[:3])
                        + "."
                    ),
                    period_start=start,
                    period_end=today,
                    refs=(
                        RecordRef(kind="finance_summary", id=None, title="Spending by category"),
                    ),
                    tone="attention"
                    if any(">" in t or "up" in t for _, t in changes[:1])
                    else "neutral",
                )
            )
        return insights

    async def _budgets(self, viewer: Viewer) -> list[Insight]:
        views = await self._sources.budgets.views(viewer.workspace_id, viewer.today)
        flagged = [
            v
            for v in views
            if v.status == "active"
            and v.current is not None
            and v.current.utilization.status in ("near", "exceeded")
        ]
        if not flagged:
            return []
        lines: list[str] = []
        for view in flagged[:4]:
            assert view.current is not None
            use = view.current.utilization
            percent = f"{use.utilization_bps / 100:.0f}%" if use.utilization_bps is not None else ""
            lines.append(
                f"{view.budget.name} {percent} used "
                f"({format_money(use.spent, view.budget.currency)} of "
                f"{format_money(use.available, view.budget.currency)})"
            )
        period = flagged[0].current
        assert period is not None
        return [
            Insight(
                key=f"budget:{period.period.start:%Y-%m-%d}:{_ids(v.budget.id for v in flagged)}",
                kind="budget",
                module="finance",
                title="Budgets close to or over their limit",
                body="; ".join(lines) + ".",
                period_start=period.period.start,
                period_end=period.period.end,
                refs=tuple(
                    RecordRef(kind="budget", id=v.budget.id, title=v.budget.name)
                    for v in flagged[:4]
                ),
                tone="attention",
            )
        ]

    async def _payments(self, viewer: Viewer) -> list[Insight]:
        end = viewer.today + timedelta(days=7)
        payments = await self._sources.payments.payments(
            viewer.workspace_id,
            PaymentQuery(
                today=viewer.today, date_from=viewer.today, date_to=end, include_overdue=True
            ),
        )
        due = [p for p in payments if p.status != "paid"]
        if not due:
            return []
        overdue = [p for p in due if p.due_date < viewer.today]
        lines = [
            f"{p.name} {format_money(p.amount, p.currency)} on {p.due_date:%a %d %b}"
            for p in due[:4]
        ]
        return [
            Insight(
                key=f"payments:{viewer.today.isoformat()}:{len(due)}",
                kind="upcoming_payments",
                module="finance",
                title=f"{len(due)} payment(s) due within a week"
                + (f", {len(overdue)} overdue" if overdue else ""),
                body="; ".join(lines) + ".",
                period_start=viewer.today,
                period_end=end,
                refs=tuple(
                    RecordRef(kind=p.kind, id=p.commitment_id, title=p.name, day=p.due_date)
                    for p in due[:4]
                ),
                tone="attention" if overdue else "neutral",
            )
        ]

    async def _habits(self, viewer: Viewer) -> list[Insight]:
        progress = await self._sources.habits.find(viewer.workspace_id, ("active",))
        rated = [p for p in progress if p.weekly_rate is not None]
        if not rated:
            return []
        strong = [p for p in rated if (p.weekly_rate or 0) >= 0.85]
        slipping = [
            p
            for p in rated
            if p.monthly_rate is not None and (p.weekly_rate or 0) + 0.25 <= p.monthly_rate
        ]
        if not strong and not slipping:
            return []
        parts: list[str] = []
        if strong:
            parts.append("Consistent this week: " + ", ".join(p.habit.name for p in strong[:4]))
        if slipping:
            parts.append(
                "Below their 30-day rate: "
                + ", ".join(
                    f"{p.habit.name} ({(p.weekly_rate or 0) * 100:.0f}% vs "
                    f"{(p.monthly_rate or 0) * 100:.0f}%)"
                    for p in slipping[:3]
                )
            )
        week_start = viewer.today - timedelta(days=6)
        return [
            Insight(
                key=f"habits:{viewer.today.isocalendar().year}-{viewer.today.isocalendar().week}",
                kind="habit_consistency",
                module="habits",
                title="Habit consistency",
                body=". ".join(parts) + ".",
                period_start=week_start,
                period_end=viewer.today,
                refs=tuple(
                    RecordRef(kind="habit", id=p.habit.id, title=p.habit.name)
                    for p in (strong + slipping)[:5]
                ),
                tone="attention" if slipping else "positive",
            )
        ]

    async def _tasks(self, viewer: Viewer) -> list[Insight]:
        start = viewer.today - timedelta(days=6)
        done = await self._sources.tasks.find(
            viewer.workspace_id, TaskQuery(status="completed", sort="completed_at", limit=100)
        )
        completed = [
            t for t in done.tasks if t.completed_at is not None and t.completed_at.date() >= start
        ]
        summary = await self._sources.tasks.summarize(viewer.workspace_id, viewer.today)
        if not completed and summary.overdue == 0:
            return []
        body = f"{len(completed)} task(s) completed in the last 7 days."
        if summary.overdue:
            body += f" {summary.overdue} open task(s) are overdue."
        return [
            Insight(
                key=f"tasks:{viewer.today.isoformat()}",
                kind="task_completion",
                module="tasks",
                title="Task progress this week",
                body=body,
                period_start=start,
                period_end=viewer.today,
                refs=tuple(RecordRef(kind="task", id=t.id, title=t.title) for t in completed[:3]),
                tone="attention" if summary.overdue else "positive",
            )
        ]

    async def _calendar(self, viewer: Viewer) -> list[Insight]:
        end = viewer.today + timedelta(days=6)
        result = await self._sources.calendar.range(
            viewer.workspace_id,
            DateWindow(
                start=viewer.today,
                end=end + timedelta(days=1),
                timezone=viewer.timezone,
                include_tasks=False,
            ),
        )
        timed = [o for o in result.occurrences if o.status != "cancelled" and not o.event.all_day]
        if len(timed) < 3:
            return []
        hours: dict[date, float] = {}
        for occurrence in timed:
            day = occurrence.start.date()
            hours[day] = (
                hours.get(day, 0) + (occurrence.end_at - occurrence.start_at).total_seconds() / 3600
            )
        busiest, most = max(hours.items(), key=lambda pair: pair[1])
        return [
            Insight(
                key=f"calendar:{viewer.today.isoformat()}",
                kind="calendar_workload",
                module="calendar",
                title="The week ahead",
                body=(
                    f"{len(timed)} timed events in the next 7 days, about "
                    f"{sum(hours.values()):.0f} hours. Busiest: {busiest:%A} with {most:.1f} hours."
                ),
                period_start=viewer.today,
                period_end=end,
                refs=(),
                tone="attention" if most >= 6 else "neutral",
            )
        ]

    async def _documents(self, viewer: Viewer) -> list[Insight]:
        end = viewer.today + timedelta(days=30)
        documents, total = await self._sources.documents.find(
            viewer.workspace_id,
            DocumentQuery(expiry=DateRange(viewer.today, end), sort="expiry", order="asc", limit=5),
        )
        if not documents:
            return []
        lines: Sequence[str] = [
            f"{d.title} on {d.details.expiry_date:%d %b}"
            for d in documents
            if d.details.expiry_date
        ]
        return [
            Insight(
                key=f"documents:{viewer.today:%Y-%m}:{total}",
                kind="document_expiry",
                module="documents",
                title=f"{total} document(s) expire within 30 days",
                body="; ".join(lines) + ".",
                period_start=viewer.today,
                period_end=end,
                refs=tuple(RecordRef(kind="document", id=d.id, title=d.title) for d in documents),
                tone="attention",
            )
        ]


def _ids(ids: Iterable[uuid.UUID]) -> str:
    return ",".join(sorted(str(i) for i in ids))
