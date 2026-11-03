"""What starts event and condition workflows, found by checking the modules' own data.

Orbit has no event bus, and the modules don't publish events, so event triggers are detected by
the worker from the records themselves:

- **Changes since a cursor** (tasks created or completed, reminders delivered, budget alerts,
  imported calendar events changed) come from timestamps on the modules' rows (`ChangeFeed`).
  The workflow's cursor moves forward after each check.
- **Things inside a window** (an event starting within the lead time, a document expiring
  within N days, a habit missed yesterday) come from the modules' services.

Every signal has a stable key (a record and its date or time), and an execution's trigger key
is unique per agent, so a signal starts at most one execution however often it is seen, by
however many workers.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Final, Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.agent.models import ConditionTrigger, EventTrigger, Scalar
from orbit_api.services.ai.context import Sources
from orbit_api.services.calendar.models import DateWindow
from orbit_api.services.commitments.models import PaymentQuery
from orbit_api.services.documents.models import DateRange, DocumentQuery
from orbit_api.services.habits.models import TodayView
from orbit_api.services.tasks.models import TaskQuery

MAX_SIGNALS: Final = 20


@dataclass(frozen=True, slots=True)
class Signal:
    key: str
    data: dict[str, Scalar] = field(default_factory=dict[str, Scalar])


class ChangeFeed(Protocol):
    """Recent changes in the modules' tables, scoped to one workspace (and recipient)."""

    async def tasks_created(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]: ...

    async def tasks_completed(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]: ...

    async def reminders_delivered(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        since: datetime,
        until: datetime,
        limit: int,
    ) -> list[Signal]: ...

    async def budget_alerts(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]: ...

    async def external_events_changed(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]: ...

    async def unread_notifications(self, user_id: uuid.UUID) -> int: ...


class HabitDays(Protocol):
    async def today(
        self, workspace_id: uuid.UUID, day: date | None, timezone: str
    ) -> TodayView: ...


class SignalReader:
    def __init__(self, feed: ChangeFeed, sources: Sources, habits: HabitDays) -> None:
        self._feed = feed
        self._sources = sources
        self._habits = habits

    async def events(
        self,
        trigger: EventTrigger,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        timezone: str,
        since: datetime,
        now: datetime,
    ) -> list[Signal]:
        feed, limit = self._feed, MAX_SIGNALS
        match trigger.event:
            case "task_created":
                return await feed.tasks_created(workspace_id, since, now, limit)
            case "task_completed":
                return await feed.tasks_completed(workspace_id, since, now, limit)
            case "reminder_triggered":
                return await feed.reminders_delivered(workspace_id, user_id, since, now, limit)
            case "budget_threshold":
                return await feed.budget_alerts(workspace_id, since, now, limit)
            case "external_event_changed":
                return await feed.external_events_changed(workspace_id, since, now, limit)
            case "event_approaching":
                return await self._approaching(workspace_id, timezone, now, trigger.lead_minutes)
            case "document_expiring":
                return await self._expiring(workspace_id, timezone, now, trigger.days_ahead)
            case "habit_missed":
                return await self._missed(workspace_id, timezone, now)

    async def _approaching(
        self, workspace_id: uuid.UUID, timezone: str, now: datetime, lead_minutes: int
    ) -> list[Signal]:
        local = now.astimezone(ZoneInfo(timezone)).date()
        horizon = now + timedelta(minutes=lead_minutes)
        window = DateWindow(
            start=local,
            end=horizon.astimezone(ZoneInfo(timezone)).date() + timedelta(days=1),
            timezone=timezone,
            include_tasks=False,
        )
        result = await self._sources.calendar.range(workspace_id, window)
        return [
            Signal(
                key=f"{o.event.id}:{o.start_at.isoformat()}",
                data={
                    "id": str(o.event.id),
                    "title": o.title,
                    "start": o.start.isoformat(),
                    "location": o.location,
                    "minutes_until": int((o.start_at - now).total_seconds() // 60),
                },
            )
            for o in sorted(result.occurrences, key=lambda o: o.start_at)
            if o.status != "cancelled" and not o.event.all_day and now < o.start_at <= horizon
        ][:MAX_SIGNALS]

    async def _expiring(
        self, workspace_id: uuid.UUID, timezone: str, now: datetime, days_ahead: int
    ) -> list[Signal]:
        today = now.astimezone(ZoneInfo(timezone)).date()
        documents, _ = await self._sources.documents.find(
            workspace_id,
            DocumentQuery(
                expiry=DateRange(today, today + timedelta(days=days_ahead)),
                sort="expiry",
                order="asc",
                limit=MAX_SIGNALS,
            ),
        )
        return [
            Signal(
                key=f"{d.id}:{d.details.expiry_date}",
                data={
                    "id": str(d.id),
                    "title": d.title,
                    "expiry_date": str(d.details.expiry_date),
                    "days_left": (d.details.expiry_date - today).days,
                },
            )
            for d in documents
            if d.details.expiry_date is not None
        ]

    async def _missed(self, workspace_id: uuid.UUID, timezone: str, now: datetime) -> list[Signal]:
        yesterday = now.astimezone(ZoneInfo(timezone)).date() - timedelta(days=1)
        view = await self._habits.today(workspace_id, yesterday, timezone)
        return [
            Signal(
                key=f"{p.habit.id}:{yesterday}",
                data={"id": str(p.habit.id), "title": p.habit.name, "day": str(yesterday)},
            )
            for p in view.habits
            if p.state == "missed"
        ][:MAX_SIGNALS]

    async def metric(
        self,
        trigger: ConditionTrigger,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        timezone: str,
        now: datetime,
    ) -> float:
        today = now.astimezone(ZoneInfo(timezone)).date()
        ahead = today + timedelta(days=trigger.days_ahead)
        match trigger.metric:
            case "overdue_tasks":
                return float((await self._sources.tasks.summarize(workspace_id, today)).overdue)
            case "tasks_due_soon":
                page = await self._sources.tasks.find(
                    workspace_id, TaskQuery(status="open", due_from=today, due_to=ahead, limit=1)
                )
                return float(page.total)
            case "upcoming_payments":
                payments = await self._sources.payments.payments(
                    workspace_id, PaymentQuery(today=today, date_from=today, date_to=ahead)
                )
                return float(sum(1 for p in payments if p.status != "paid"))
            case "budget_used_percent":
                views = await self._sources.budgets.views(workspace_id, today)
                used = [
                    v.current.utilization.utilization_bps / 100
                    for v in views
                    if v.status == "active"
                    and v.current is not None
                    and v.current.utilization.utilization_bps is not None
                ]
                return max(used, default=0.0)
            case "documents_expiring":
                _, total = await self._sources.documents.find(
                    workspace_id,
                    DocumentQuery(expiry=DateRange(today, ahead), limit=1),
                )
                return float(total)
            case "unread_notifications":
                return float(await self._feed.unread_notifications(user_id))
