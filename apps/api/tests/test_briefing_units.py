"""The briefing aggregator and service with fake modules: failure isolation, concurrency,
time zones, conflicts, and how reminders and workouts are matched to what's already shown."""

import json
import logging
import uuid
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest

from orbit_api.repositories.briefings import decode_content, encode_content
from orbit_api.services.ai.models import AI_MODULES
from orbit_api.services.briefings.aggregation import (
    BriefingAggregator,
    day_window,
    find_conflicts,
)
from orbit_api.services.briefings.models import (
    Briefing,
    BriefingContent,
    BriefingEvent,
    BriefingHistoryPage,
    BriefingSettings,
    InvalidBriefingSettingsError,
    Narrative,
    SourceRef,
)
from orbit_api.services.briefings.narrative import briefing_digest, parse_narrative
from orbit_api.services.briefings.service import BriefingService, ScheduledBriefing
from orbit_api.services.budgets.models import BudgetView
from orbit_api.services.calendar.models import CalendarRange, DateWindow
from orbit_api.services.commitments.models import PaymentItem, PaymentQuery
from orbit_api.services.documents.models import Document, DocumentQuery
from orbit_api.services.fitness.models import (
    GoalProgress,
    Owner,
    ScheduledWorkout,
    Session,
    SessionDetail,
    SessionSummary,
)
from orbit_api.services.goals.models import GoalView
from orbit_api.services.habits.models import RoutineDetail, RoutineStatus, TodayView
from orbit_api.services.investments.models import SipPlanView
from orbit_api.services.investments.service import InvestmentBook
from orbit_api.services.notes.models import LinkedNoteMatch, NotePage, NoteQuery
from orbit_api.services.people.models import Person, PersonDate
from orbit_api.services.reminders.models import CommitmentLink, Reminder, ReminderView
from orbit_api.services.reminders.recurrence import Schedule
from orbit_api.services.shopping.models import ShoppingList, ShoppingListOverview
from orbit_api.services.tasks.models import TaskPage, TaskQuery
from orbit_api.services.transactions import ConflictError

NOW = datetime(2030, 6, 10, 22, 30, tzinfo=UTC)  # 11 June, 07:30 in Tokyo.
WS = uuid.uuid4()
USER = uuid.uuid4()


class FakeTasks:
    def __init__(self) -> None:
        self.queries: list[TaskQuery] = []

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage:
        self.queries.append(query)
        return TaskPage(tasks=[], total=0)


class FakeCalendar:
    def __init__(self) -> None:
        self.windows: list[DateWindow] = []

    async def range(self, workspace_id: uuid.UUID, window: DateWindow) -> CalendarRange:
        self.windows.append(window)
        return CalendarRange(occurrences=[], scheduled_tasks=[], due_tasks=[])


class FakeReminders:
    def __init__(self, views: list[ReminderView] | None = None) -> None:
        self._views = views or []

    async def upcoming(self, workspace_id: uuid.UUID, limit: int) -> list[ReminderView]:
        return self._views


class FakePayments:
    def __init__(self, items: list[PaymentItem] | None = None) -> None:
        self._items = items or []

    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]:
        return self._items


class FakeBudgets:
    async def views(self, workspace_id: uuid.UUID, today: date) -> list[BudgetView]:
        return []


class FakeGoals:
    async def views(self, workspace_id: uuid.UUID, today: date) -> list[GoalView]:
        return []


class FakeHabits:
    def __init__(self) -> None:
        self.calls: list[tuple[date | None, str]] = []

    async def today(self, workspace_id: uuid.UUID, day: date | None, timezone: str) -> TodayView:
        self.calls.append((day, timezone))
        return TodayView(day=day or NOW.date(), habits=[], week=[], upcoming=[])


class FakeRoutines:
    async def find(
        self, workspace_id: uuid.UUID, statuses: Sequence[RoutineStatus] | None
    ) -> list[RoutineDetail]:
        return []


class FakeHealth:
    def __init__(
        self,
        scheduled: list[ScheduledWorkout] | None = None,
        completed: list[SessionSummary] | None = None,
    ) -> None:
        self._scheduled = scheduled or []
        self._completed = completed or []
        self.owners: list[Owner] = []

    async def scheduled(self, owner: Owner, day: date, timezone: str) -> list[ScheduledWorkout]:
        self.owners.append(owner)
        return self._scheduled

    async def active(self, owner: Owner) -> SessionDetail | None:
        return None

    async def completed(self, owner: Owner, day: date) -> list[SessionSummary]:
        return self._completed

    async def goals(self, owner: Owner, day: date) -> list[GoalProgress]:
        return []


class FakeNotes:
    async def linked_to(
        self,
        workspace_id: uuid.UUID,
        task_ids: Sequence[uuid.UUID],
        event_ids: Sequence[uuid.UUID],
    ) -> list[LinkedNoteMatch]:
        return []

    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> NotePage:
        return NotePage(items=[], total=0)


class FakeDocuments:
    def __init__(self, by_kind: dict[str, list[Document]] | None = None) -> None:
        self._by_kind = by_kind or {}

    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]:
        if query.renewal.start is not None:
            found = self._by_kind.get("renewal", [])
        elif query.expiry.start is None and query.expiry.end is not None:
            found = self._by_kind.get("expired", [])
        else:
            found = self._by_kind.get("expiring", [])
        return found, len(found)


class FakeShopping:
    def __init__(self, lists: list[ShoppingListOverview] | None = None) -> None:
        self._lists = lists or []

    async def overview(self, workspace_id: uuid.UUID) -> list[ShoppingListOverview]:
        return self._lists


class FakePeople:
    def __init__(self, people: list[Person] | None = None) -> None:
        self._people = people or []

    async def people(self, workspace_id: uuid.UUID) -> list[Person]:
        return self._people


class FakeInvestments:
    def __init__(
        self, book: InvestmentBook | None = None, sips: list[SipPlanView] | None = None
    ) -> None:
        self._book = book
        self._sips = sips or []

    async def book(self, workspace_id: uuid.UUID, as_of: date) -> InvestmentBook:
        return self._book or InvestmentBook(
            as_of=as_of, accounts=[], holdings=[], deposits=[], transactions=[], ledger={}
        )

    async def sip_plans(
        self, workspace_id: uuid.UUID, today: date, holding_id: uuid.UUID | None = None
    ) -> list[SipPlanView]:
        return self._sips


class Broken:
    """Any module whose every read fails."""

    def __getattr__(self, name: str) -> Any:
        async def fail(*args: object, **kwargs: object) -> Any:
            raise RuntimeError("the module's tables are unreachable")

        return fail


class FakeTransaction:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


def aggregator(transaction: FakeTransaction | None = None, **sources: Any) -> BriefingAggregator:
    defaults: dict[str, Any] = {
        "tasks": FakeTasks(),
        "calendar": FakeCalendar(),
        "reminders": FakeReminders(),
        "payments": FakePayments(),
        "budgets": FakeBudgets(),
        "goals": FakeGoals(),
        "habits": FakeHabits(),
        "routines": FakeRoutines(),
        "health": FakeHealth(),
        "notes": FakeNotes(),
        "documents": FakeDocuments(),
        "shopping": FakeShopping(),
        "people": FakePeople(),
        "investments": FakeInvestments(),
    }
    return BriefingAggregator(
        **{**defaults, **sources},
        transaction=transaction or FakeTransaction(),
        clock=lambda: NOW,
    )


def reminder_view(
    title: str,
    at: datetime,
    *,
    task_id: uuid.UUID | None = None,
    link: CommitmentLink | None = None,
) -> ReminderView:
    reminder = Reminder(
        id=uuid.uuid4(),
        workspace_id=WS,
        task_id=task_id,
        title=title,
        description="",
        enabled=True,
        schedule=Schedule(start_date=at.date(), time_of_day=time(9), timezone="UTC"),
        last_occurrence_at=None,
        last_outcome=None,
        created_at=NOW,
        updated_at=NOW,
        commitment=link,
    )
    return ReminderView(reminder=reminder, status="scheduled", next_occurrence_at=at, task=None)


def payment(commitment_id: uuid.UUID, due: date) -> PaymentItem:
    return PaymentItem(
        kind="bill",
        commitment_id=commitment_id,
        occurrence_id=None,
        name="Electricity",
        counterparty="",
        amount=2_500_00,
        estimated=True,
        currency="INR",
        due_date=due,
        status="upcoming",
        account_id=None,
        paid_on=None,
        transaction_ids=(),
    )


class TestWindows:
    def test_a_day_is_bounded_in_the_persons_time_zone(self) -> None:
        window = day_window(date(2030, 6, 11), "Asia/Tokyo")

        assert window.start == datetime(2030, 6, 10, 15, tzinfo=UTC)
        assert window.end == datetime(2030, 6, 11, 15, tzinfo=UTC)

    @pytest.mark.parametrize(
        ("day", "hours"),
        [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25), (date(2026, 6, 1), 24)],
    )
    def test_daylight_saving_days_are_23_or_25_hours(self, day: date, hours: int) -> None:
        window = day_window(day, "America/New_York")

        assert window.end - window.start == timedelta(hours=hours)

    @pytest.mark.anyio
    async def test_every_module_is_asked_about_the_persons_date(self) -> None:
        tasks, calendar, habits, health = FakeTasks(), FakeCalendar(), FakeHabits(), FakeHealth()

        content = await aggregator(
            tasks=tasks, calendar=calendar, habits=habits, health=health
        ).collect(WS, USER, date(2030, 6, 11), "Asia/Tokyo")

        assert content.window.date == date(2030, 6, 11)
        overdue, due_today = tasks.queries[0], tasks.queries[1]
        assert overdue.due_to == date(2030, 6, 10)
        assert (due_today.due_from, due_today.due_to) == (date(2030, 6, 11), date(2030, 6, 11))
        assert calendar.windows[0].start == date(2030, 6, 11)
        assert calendar.windows[0].timezone == "Asia/Tokyo"
        assert habits.calls == [(date(2030, 6, 11), "Asia/Tokyo")]
        # Health is read for this person only.
        assert health.owners == [Owner(workspace_id=WS, user_id=USER)]


def _event(key: str, start: datetime, minutes: int, *, all_day: bool = False) -> BriefingEvent:
    end = start + timedelta(minutes=minutes)
    return BriefingEvent(
        ref=SourceRef(module="calendar", type="event", id=uuid.uuid4(), occurrence=key),
        title=key,
        location="",
        all_day=all_day,
        start_at=start,
        end_at=end,
        local_start=start,
        local_end=end,
        event_timezone="UTC",
        recurring=False,
        severity="info",
    )


class TestConflicts:
    def test_overlaps_are_paired_and_touching_or_all_day_events_are_not(self) -> None:
        nine = datetime(2030, 6, 11, 9, tzinfo=UTC)
        a = _event("a", nine, 60)
        b = _event("b", nine + timedelta(minutes=30), 60)
        c = _event("c", nine + timedelta(minutes=45), 10)
        touching = _event("d", nine + timedelta(minutes=90), 30)
        holiday = _event("e", nine.replace(hour=0), 24 * 60, all_day=True)

        conflicts = find_conflicts([holiday, touching, c, b, a])

        assert [(x.first, x.second) for x in conflicts] == [
            (a.ref.key, b.ref.key),
            (a.ref.key, c.ref.key),
            (b.ref.key, c.ref.key),
        ]
        first = conflicts[0]
        assert (first.start_at, first.end_at) == (b.start_at, a.end_at)


class TestFailures:
    @pytest.mark.anyio
    async def test_a_failing_module_is_reported_and_the_rest_still_load(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        transaction = FakeTransaction()

        with caplog.at_level(logging.ERROR):
            content = await aggregator(transaction, payments=Broken(), health=Broken()).collect(
                WS, USER, NOW.date(), "UTC"
            )

        assert content.unavailable == ("payments", "health")
        assert content.payments is None and content.health is None
        assert content.tasks is not None and content.schedule is not None
        states = {s.module: s.status for s in content.sources}
        assert states["payments"] == states["health"] == "unavailable"
        assert states["tasks"] == "empty"
        # Each failure rolls the session back and is logged with the module's name.
        assert transaction.rollbacks == 2
        assert "'payments' failed" in caplog.text and "'health' failed" in caplog.text

    @pytest.mark.anyio
    async def test_everything_failing_is_still_a_briefing(self) -> None:
        broken = Broken()
        content = await aggregator(
            tasks=broken,
            calendar=broken,
            reminders=broken,
            payments=broken,
            budgets=broken,
            goals=broken,
            habits=broken,
            routines=broken,
            health=broken,
            notes=broken,
            documents=broken,
            shopping=broken,
            investments=broken,
        ).collect(WS, USER, NOW.date(), "UTC")

        assert len(content.unavailable) == 13
        assert content.deadlines is None
        assert content.summary.attention == ()


class TestReminderMatching:
    @pytest.mark.anyio
    async def test_reminders_managed_by_a_shown_payment_or_event_are_not_repeated(self) -> None:
        bill = uuid.uuid4()
        later = NOW + timedelta(hours=1)
        views = [
            reminder_view("Electricity due", later, link=CommitmentLink("recurring_payment", bill)),
            reminder_view("Other bill", later, link=CommitmentLink("loan", uuid.uuid4())),
            reminder_view(
                "Meeting soon", later, link=CommitmentLink("calendar_alert", uuid.uuid4())
            ),
            reminder_view(
                "Passport",
                later + timedelta(minutes=5),
                link=CommitmentLink("document", uuid.uuid4()),
            ),
            reminder_view("Far off", NOW + timedelta(days=30)),
        ]

        content = await aggregator(
            reminders=FakeReminders(views),
            payments=FakePayments([payment(bill, NOW.date() + timedelta(days=2))]),
        ).collect(WS, USER, NOW.date(), "UTC")

        assert content.reminders is not None
        # A loan that isn't in the briefing and a document's dates are still listed.
        assert [r.title for r in content.reminders.items] == ["Other bill", "Passport"]
        assert content.reminders.represented_elsewhere == 2

    @pytest.mark.anyio
    async def test_when_payments_are_unavailable_their_reminders_are_shown(self) -> None:
        views = [
            reminder_view(
                "Electricity due",
                NOW + timedelta(hours=1),
                link=CommitmentLink("recurring_payment", uuid.uuid4()),
            )
        ]

        content = await aggregator(reminders=FakeReminders(views), payments=Broken()).collect(
            WS, USER, NOW.date(), "UTC"
        )

        assert content.reminders is not None
        assert [r.title for r in content.reminders.items] == ["Electricity due"]


def _session(event_id: uuid.UUID | None, name: str) -> SessionSummary:
    owner = Owner(workspace_id=WS, user_id=USER)
    session = Session(
        id=uuid.uuid4(),
        owner=owner,
        template_id=None,
        calendar_event_id=event_id,
        name=name,
        day=NOW.date(),
        timezone="UTC",
        status="completed",
        started_at=NOW - timedelta(hours=2),
        ended_at=NOW - timedelta(hours=1),
        paused_at=None,
        paused_seconds=0,
        duration_s=3600,
        notes="felt tired",
        created_at=NOW,
        updated_at=NOW,
    )
    return SessionSummary(session=session, exercise_count=3, set_count=9, volume_g=1_000_000)


class TestHealth:
    @pytest.mark.anyio
    async def test_a_scheduled_workout_already_done_shows_once_without_its_details(self) -> None:
        legs, arms = uuid.uuid4(), uuid.uuid4()
        start = NOW - timedelta(hours=3)
        scheduled = [
            ScheduledWorkout(legs, "Leg day", None, None, start, start + timedelta(hours=1), ()),
            ScheduledWorkout(arms, "Arm day", None, None, NOW + timedelta(hours=1), None, ()),
        ]

        content = await aggregator(
            health=FakeHealth(scheduled, [_session(legs, "Leg day")])
        ).collect(WS, USER, NOW.date(), "UTC")

        assert content.health is not None
        assert [(w.name, w.state) for w in content.health.workouts] == [
            ("Arm day", "scheduled"),
            ("Leg day", "completed"),
        ]
        # Session notes and training volume are never copied into the snapshot.
        assert "felt tired" not in repr(content)
        assert "1000000" not in repr(content)


class TestAttention:
    @pytest.mark.anyio
    async def test_money_first_then_late_work(self) -> None:
        late = replace(payment(uuid.uuid4(), NOW.date() - timedelta(days=1)), status="overdue")
        soon = payment(uuid.uuid4(), NOW.date() + timedelta(days=1))

        content = await aggregator(payments=FakePayments([soon, late])).collect(
            WS, USER, NOW.date(), "UTC"
        )

        assert [(a.module, a.severity) for a in content.summary.attention] == [
            ("payments", "critical")
        ]
        assert content.summary.payments_overdue == 1
        assert content.payments is not None
        assert [p.status for p in content.payments.items] == ["overdue", "upcoming"]


# The service


class FakeRepository:
    """Holds briefings in memory by date and time zone. `race` makes the first insert lose to a
    concurrent one."""

    def __init__(self, race: Briefing | None = None) -> None:
        self.stored: dict[tuple[date, str], Briefing] = {}
        self._race = race
        self.replaced: list[date] = []

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, day: date, timezone: str | None
    ) -> Briefing | None:
        if timezone is not None:
            return self.stored.get((day, timezone))
        dated = [b for (d, _), b in self.stored.items() if d == day]
        return max(dated, key=lambda b: b.generated_at, default=None)

    async def add(self, briefing: Briefing) -> None:
        key = (briefing.date, briefing.timezone)
        if self._race is not None:
            # Another request inserted first, between our read and our write.
            self.stored[key] = self._race
            self._race = None
            raise ConflictError
        if key in self.stored:
            raise ConflictError
        self.stored[key] = briefing

    async def replace(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        content: BriefingContent,
        generated_at: datetime,
    ) -> None:
        key = (day, content.window.timezone)
        old = self.stored[key]
        self.replaced.append(day)
        self.stored[key] = replace(
            old, content=content, revision=old.revision + 1, generated_at=generated_at
        )

    async def set_narrative(self, briefing: Briefing, narrative: Narrative) -> None:
        key = (briefing.date, briefing.timezone)
        self.stored[key] = replace(self.stored[key], narrative=narrative)

    async def history(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int
    ) -> BriefingHistoryPage:
        return BriefingHistoryPage(items=[], total=0)


class FakeSettings:
    def __init__(self, settings: BriefingSettings | None = None) -> None:
        self.value = settings or BriefingSettings()

    async def get(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> BriefingSettings:
        return self.value

    async def put(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, settings: BriefingSettings
    ) -> None:
        self.value = settings


class CountingSource:
    def __init__(self, inner: BriefingAggregator) -> None:
        self._inner = inner
        self.calls = 0

    async def collect(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        timezone: str,
        settings: BriefingSettings | None = None,
    ) -> BriefingContent:
        self.calls += 1
        return await self._inner.collect(workspace_id, user_id, day, timezone, settings)


class TestService:
    @pytest.mark.anyio
    async def test_today_is_prepared_once_and_then_kept(self) -> None:
        repository, transaction = FakeRepository(), FakeTransaction()
        source = CountingSource(aggregator())
        service = BriefingService(
            repository, FakeSettings(), source, transaction, clock=lambda: NOW
        )

        first = await service.today(WS, USER, "Asia/Tokyo")
        again = await service.today(WS, USER, "Asia/Tokyo")

        assert first.date == date(2030, 6, 11)
        assert again is first
        assert source.calls == 1
        assert (first.status, first.revision, transaction.commits) == ("complete", 1, 1)

    @pytest.mark.anyio
    async def test_a_concurrent_first_request_returns_the_winners_briefing(self) -> None:
        winner_service = BriefingService(
            FakeRepository(), FakeSettings(), aggregator(), FakeTransaction(), clock=lambda: NOW
        )
        winner = await winner_service.today(WS, USER, "UTC")
        repository, transaction = FakeRepository(race=winner), FakeTransaction()
        service = BriefingService(
            repository, FakeSettings(), aggregator(), transaction, clock=lambda: NOW
        )

        result = await service.today(WS, USER, "UTC")

        assert result.id == winner.id
        assert transaction.rollbacks == 1
        assert list(repository.stored.values()) == [winner]

    @pytest.mark.anyio
    async def test_regenerating_replaces_todays_snapshot(self) -> None:
        repository, transaction = FakeRepository(), FakeTransaction()
        service = BriefingService(
            repository, FakeSettings(), aggregator(), transaction, clock=lambda: NOW
        )
        first = await service.today(WS, USER, "UTC")

        again = await service.regenerate(WS, USER, "UTC")

        assert (again.id, again.revision) == (first.id, 2)
        assert repository.replaced == [NOW.date()]

    @pytest.mark.anyio
    async def test_a_partial_briefing_is_marked_partial(self) -> None:
        service = BriefingService(
            FakeRepository(),
            FakeSettings(),
            aggregator(notes=Broken()),
            FakeTransaction(),
            clock=lambda: NOW,
        )

        result = await service.today(WS, USER, "UTC")

        assert result.status == "partial"
        assert result.content.unavailable == ("notes",)


class TestSnapshotEncoding:
    @pytest.mark.anyio
    async def test_a_snapshot_survives_a_round_trip_through_json(self) -> None:
        bill = uuid.uuid4()
        content = await aggregator(
            payments=FakePayments([payment(bill, NOW.date())]),
            reminders=FakeReminders([reminder_view("Passport", NOW + timedelta(hours=1))]),
        ).collect(WS, USER, NOW.date(), "Asia/Tokyo")

        encoded = encode_content(content)

        assert json.loads(json.dumps(encoded)) == encoded
        assert decode_content(encoded) == content


class TestSettings:
    @pytest.mark.anyio
    async def test_hidden_modules_are_not_read_and_are_off_not_unavailable(self) -> None:
        payments = Broken()
        content = await aggregator(payments=payments, health=Broken()).collect(
            WS,
            USER,
            NOW.date(),
            "UTC",
            BriefingSettings(hidden=frozenset({"payments", "health"})),
        )

        # Broken modules that are hidden are never called, so nothing is unavailable.
        assert content.unavailable == ()
        assert content.payments is None and content.health is None
        states = {s.module: s.status for s in content.sources}
        assert states["payments"] == states["health"] == "off"
        assert states["tasks"] == "empty"

    @pytest.mark.anyio
    async def test_the_horizon_bounds_every_look_ahead(self) -> None:
        tasks, calendar = FakeTasks(), FakeCalendar()

        content = await aggregator(tasks=tasks, calendar=calendar).collect(
            WS, USER, date(2030, 6, 11), "UTC", BriefingSettings(horizon_days=3)
        )

        assert content.horizon_days == 3
        assert calendar.windows[0].end == date(2030, 6, 15)
        upcoming = next(q for q in tasks.queries if q.due_from == date(2030, 6, 12))
        assert upcoming.due_to == date(2030, 6, 14)

    @pytest.mark.anyio
    async def test_settings_are_validated_and_applied_to_the_next_briefing(self) -> None:
        settings = FakeSettings()
        service = BriefingService(
            FakeRepository(), settings, aggregator(), FakeTransaction(), clock=lambda: NOW
        )
        with pytest.raises(InvalidBriefingSettingsError):
            await service.update_settings(WS, USER, BriefingSettings(horizon_days=15))

        await service.update_settings(WS, USER, BriefingSettings(hidden=frozenset({"notes"})))
        briefing = await service.today(WS, USER, "UTC")

        assert briefing.content.notes is None
        assert {s.module: s.status for s in briefing.content.sources}["notes"] == "off"


class TestScheduledPreparation:
    @pytest.mark.anyio
    async def test_prepared_once_after_the_chosen_local_time(self) -> None:
        repository = FakeRepository()
        clock = {"now": datetime(2030, 6, 10, 21, 0, tzinfo=UTC)}  # 06:00 on the 11th in Tokyo.
        service = BriefingService(
            repository, FakeSettings(), aggregator(), FakeTransaction(), clock=lambda: clock["now"]
        )
        entry = ScheduledBriefing(WS, USER, time(7, 0), "Asia/Tokyo")

        assert await service.prepare_if_due(entry) is False
        clock["now"] = datetime(2030, 6, 10, 22, 5, tzinfo=UTC)  # 07:05 in Tokyo.
        assert await service.prepare_if_due(entry) is True
        assert await service.prepare_if_due(entry) is False
        assert list(repository.stored) == [(date(2030, 6, 11), "Asia/Tokyo")]


class TestNarrative:
    def test_priorities_must_point_at_given_items(self) -> None:
        refs = {"I1": ("task:a", "File taxes"), "I2": ("", "and 3 more")}
        parsed = parse_narrative(
            {
                "headline": "  A   busy day ",
                "summary": "Taxes first.",
                "priorities": [
                    {"ref": "I1", "reason": "It's late."},
                    {"ref": "I1", "reason": "Again."},
                    {"ref": "I2", "reason": "Not an item."},
                    {"ref": "I9", "reason": "Invented."},
                    "nonsense",
                ],
            },
            refs,
        )

        assert parsed is not None
        headline, summary, priorities = parsed
        assert (headline, summary) == ("A busy day", "Taxes first.")
        assert [(p.key, p.title, p.reason) for p in priorities] == [
            ("task:a", "File taxes", "It's late.")
        ]
        assert parse_narrative({"headline": "", "summary": "x"}, refs) is None

    @pytest.mark.anyio
    async def test_the_model_sees_only_permitted_modules_and_no_amounts(self) -> None:
        content = await aggregator(
            payments=FakePayments([payment(uuid.uuid4(), NOW.date())]),
            health=FakeHealth(
                [ScheduledWorkout(uuid.uuid4(), "Leg day", None, None, NOW, None, ())]
            ),
        ).collect(WS, USER, NOW.date(), "UTC")

        default = briefing_digest(content, frozenset({"tasks", "calendar", "habits"}))
        assert default is not None
        assert "Electricity" not in default and "Leg day" not in default
        everything = briefing_digest(content, frozenset({"finance", "health"}))
        assert everything is not None
        assert "Electricity" in everything and "Leg day" in everything
        # The bill is ₹2,500.00: no amount, in any form, reaches the model.
        assert "2500" not in everything and "250000" not in everything
        assert briefing_digest(content, frozenset()) is None


class TestPeople:
    @pytest.mark.anyio
    async def test_dates_within_the_horizon_and_never_sent_to_a_model(self) -> None:
        def person(name: str, *dates: PersonDate) -> Person:
            return Person(
                id=uuid.uuid4(),
                workspace_id=WS,
                name=name,
                relationship="friend",
                phone="+91 98765 43210",
                email="",
                note="Secret note",
                favorite=False,
                dates=dates,
                reminder_time=time(9),
                timezone="UTC",
                created_at=NOW,
                updated_at=NOW,
            )

        day = NOW.date()  # 10 June 2030 in UTC.
        people = [
            person("Priya", PersonDate(kind="birthday", month=6, day=10, year=2000)),
            person("Sam", PersonDate(kind="anniversary", month=6, day=14)),
            person("Later", PersonDate(kind="birthday", month=7, day=30)),
        ]
        content = await aggregator(people=FakePeople(people)).collect(WS, USER, day, "UTC")

        section = content.people
        assert section is not None
        assert [(i.name, i.days_away, i.years) for i in section.items] == [
            ("Priya", 0, 30),
            ("Sam", 4, None),
        ]
        assert (section.today, section.total) == (1, 2)
        # The snapshot round-trips, and no model ever sees People.
        assert decode_content(encode_content(content)) == content
        everything = briefing_digest(content, frozenset(AI_MODULES))
        assert everything is None or "Priya" not in everything

    @pytest.mark.anyio
    async def test_people_reminders_are_counted_as_shown(self) -> None:
        link = CommitmentLink(kind="person", id=uuid.uuid4())
        reminders = FakeReminders([reminder_view("Priya's birthday is today", NOW, link=link)])
        content = await aggregator(reminders=reminders).collect(WS, USER, NOW.date(), "UTC")
        assert content.reminders is not None
        assert content.reminders.items == ()
        assert content.reminders.represented_elsewhere == 1


class TestNewSourcesInNarrative:
    @pytest.mark.anyio
    async def test_shopping_never_reaches_a_model(self) -> None:
        groceries = ShoppingList(
            id=uuid.uuid4(),
            workspace_id=WS,
            name="Secret groceries",
            icon="cart",
            is_default=True,
            created_at=NOW,
            updated_at=NOW,
        )
        content = await aggregator(
            shopping=FakeShopping([ShoppingListOverview(groceries, needed=4, purchased=0)])
        ).collect(WS, USER, NOW.date(), "UTC")

        assert content.shopping is not None and content.shopping.needed == 4
        everything = briefing_digest(content, frozenset(AI_MODULES))
        assert everything is not None
        assert "Secret groceries" not in everything
