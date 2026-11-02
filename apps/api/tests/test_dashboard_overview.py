"""The dashboard's daily overview: API behavior, and the service's rules with fake modules."""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.calendar.models import (
    AgendaItem,
    AgendaPage,
    CalendarEvent,
    CalendarRange,
    DateWindow,
    EventOccurrence,
    EventStatus,
)
from orbit_api.services.commitments.models import PaymentItem, PaymentQuery, PaymentStatus
from orbit_api.services.dashboard.today import DailyOverviewService
from orbit_api.services.documents.models import Document, DocumentCounts, DocumentQuery
from orbit_api.services.habits.models import TodayView
from orbit_api.services.reminders.models import ReminderView
from orbit_api.services.tasks.models import TaskPage, TaskQuery, TaskSummary
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"
EVERY_DAY = {"type": "daily"}

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def personal(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    return personal(client, ada)


def today_utc() -> date:
    return datetime.now(UTC).date()


def overview(client: TestClient, ws: str, headers: Headers, **params: Any) -> Json:
    response = client.get(
        f"{ws}/dashboard/today", params={"timezone": "UTC", **params}, headers=headers
    )
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def post(client: TestClient, url: str, headers: Headers, body: Json) -> Json:
    response = client.post(url, json=body, headers=headers)
    assert response.status_code == 201, response.text
    result: Json = response.json()
    return result


class TestOverviewApi:
    def test_an_empty_workspace_has_nothing_to_do(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        body = overview(client, ws, ada)

        assert body["date"] == today_utc().isoformat()
        assert body["timezone"] == "UTC"
        assert body["unavailable"] == []
        assert body["tasks"]["overdue"] == 0
        assert body["tasks"]["due_today"] == 0
        assert body["events"] == {"today": [], "next": None}
        assert body["reminders"] == {"pending": 0, "items": []}
        assert body["habits"] == {"remaining": 0, "done": 0, "total": 0}
        assert body["documents"] == {"expired": 0, "expiring": 0, "items": []}
        assert body["payments"] == {"overdue": 0, "due_soon": 0, "items": []}

    def test_counts_and_lists_what_needs_attention(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_utc()
        post(client, f"{ws}/tasks", ada, {"title": "Late", "due_date": str(today - timedelta(3))})
        post(
            client,
            f"{ws}/tasks",
            ada,
            {"title": "Today", "due_date": str(today), "priority": "high"},
        )
        post(client, f"{ws}/tasks", ada, {"title": "Later", "due_date": str(today + timedelta(5))})
        done = post(client, f"{ws}/tasks", ada, {"title": "Done", "due_date": str(today)})
        client.post(f"{ws}/tasks/{done['id']}/complete", headers=ada)
        post(
            client,
            f"{ws}/calendar/events",
            ada,
            {
                "title": "Holiday",
                "all_day": True,
                "start": f"{today}T00:00",
                "end": f"{today + timedelta(1)}T00:00",
                "timezone": "UTC",
            },
        )
        habit = post(
            client,
            f"{ws}/habits",
            ada,
            {"name": "Read", "schedule": EVERY_DAY, "start_date": str(today), "timezone": "UTC"},
        )
        post(
            client,
            f"{ws}/habits",
            ada,
            {"name": "Walk", "schedule": EVERY_DAY, "start_date": str(today), "timezone": "UTC"},
        )
        client.put(
            f"{ws}/habits/{habit['habit']['id']}/log/{today}",
            json={"status": "completed"},
            headers=ada,
        )
        post(
            client,
            f"{ws}/documents",
            ada,
            {"title": "Old visa", "expiry_date": str(today - timedelta(2))},
        )
        post(
            client,
            f"{ws}/documents",
            ada,
            {"title": "Passport", "expiry_date": str(today + timedelta(10))},
        )
        post(
            client,
            f"{ws}/documents",
            ada,
            {"title": "Deed", "expiry_date": str(today + timedelta(200))},
        )

        body = overview(client, ws, ada)

        tasks = body["tasks"]
        assert (tasks["overdue"], tasks["due_today"], tasks["open"]) == (1, 1, 3)
        assert [t["title"] for t in tasks["overdue_items"]] == ["Late"]
        assert [t["title"] for t in tasks["due_today_items"]] == ["Today"]
        assert [e["title"] for e in body["events"]["today"]] == ["Holiday"]
        assert body["habits"] == {"remaining": 1, "done": 1, "total": 2}
        documents = body["documents"]
        assert (documents["expired"], documents["expiring"]) == (1, 1)
        assert [d["title"] for d in documents["items"]] == ["Old visa", "Passport"]
        # Only what identifies the document and when it expires.
        assert set(documents["items"][0]) == {"id", "title", "expiry_date"}

    def test_reminders_due_before_the_end_of_today_are_pending(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        zone = "Pacific/Kiritimati"  # UTC+14: "today" there is often tomorrow in UTC.
        local_today = datetime.now(ZoneInfo(zone)).date()
        post(
            client,
            f"{ws}/reminders",
            ada,
            {
                "title": "Tonight",
                "start_date": str(local_today),
                "time_of_day": "23:59",
                "timezone": zone,
            },
        )
        post(
            client,
            f"{ws}/reminders",
            ada,
            {
                "title": "Next week",
                "start_date": str(local_today + timedelta(7)),
                "time_of_day": "09:00",
                "timezone": zone,
            },
        )

        body = overview(client, ws, ada, timezone=zone)

        assert body["date"] == local_today.isoformat()
        assert body["reminders"]["pending"] == 1
        assert [r["title"] for r in body["reminders"]["items"]] == ["Tonight"]

    def test_today_follows_the_users_time_zone(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        client.patch("/api/v1/me", json={"timezone": "Pacific/Kiritimati"}, headers=ada)

        response = client.get(f"{ws}/dashboard/today", headers=ada)

        expected = datetime.now(ZoneInfo("Pacific/Kiritimati")).date()
        assert response.json()["date"] == expected.isoformat()
        assert response.json()["timezone"] == "Pacific/Kiritimati"

    def test_loads_only_the_requested_sections(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        response = client.get(
            f"{ws}/dashboard/today",
            params=[("section", "tasks"), ("section", "habits")],
            headers=ada,
        )

        body = response.json()
        assert body["tasks"] is not None
        assert body["habits"] is not None
        assert body["events"] is None
        assert body["payments"] is None
        assert body["unavailable"] == []

    @pytest.mark.parametrize(
        "params",
        [{"timezone": "Mars/Olympus"}, {"section": "weather"}, {"user_id": str(uuid.uuid4())}],
    )
    def test_rejects_invalid_parameters(
        self, client: TestClient, ws: str, ada: Headers, params: Json
    ) -> None:
        assert client.get(f"{ws}/dashboard/today", params=params, headers=ada).status_code == 422

    def test_never_shows_another_users_workspace(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        post(client, f"{ws}/tasks", ada, {"title": "Ada's", "due_date": str(today_utc())})
        grace_ws = personal(client, grace)

        assert client.get(f"{ws}/dashboard/today", headers=grace).status_code == 404
        assert client.get(f"{grace_ws}/dashboard/today").status_code == 401
        assert overview(client, grace_ws, grace)["tasks"]["due_today"] == 0

    def test_counts_only_the_workspace_asked_for(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        other = post(client, WORKSPACES, ada, {"name": "Work"})
        post(client, f"{ws}/tasks", ada, {"title": "Home", "due_date": str(today_utc())})

        assert overview(client, f"{WORKSPACES}/{other['id']}", ada)["tasks"]["due_today"] == 0
        assert overview(client, ws, ada)["tasks"]["due_today"] == 1


# The service, with fake modules


NOW = datetime(2030, 6, 10, 22, 30, tzinfo=UTC)  # 11 June, 07:30 in Tokyo.
WS = uuid.uuid4()


def _event(
    title: str, start: datetime, *, all_day: bool = False, status: EventStatus = "confirmed"
) -> EventOccurrence:
    event = CalendarEvent(
        id=uuid.uuid4(),
        workspace_id=WS,
        title=title,
        description="",
        location="",
        category_id=None,
        all_day=all_day,
        timezone="UTC",
        start=start.replace(tzinfo=None),
        end=(start + timedelta(hours=1)).replace(tzinfo=None),
        recurrence=None,
        status="confirmed",
        series_id=None,
        created_at=NOW,
        updated_at=NOW,
    )
    return EventOccurrence(
        event=event,
        original_start=event.start,
        title=title,
        description="",
        location="",
        category_id=None,
        status=status,
        start=event.start,
        end=event.end,
        start_at=start,
        end_at=start + timedelta(hours=1),
        modified=False,
    )


class FakeTasks:
    def __init__(self) -> None:
        self.days: list[date] = []
        self.queries: list[TaskQuery] = []

    async def summarize(self, workspace_id: uuid.UUID, today: date) -> TaskSummary:
        self.days.append(today)
        return TaskSummary(open=3, completed=1, overdue=1, due_today=2)

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage:
        self.queries.append(query)
        return TaskPage(tasks=[], total=0)


class FakeCalendar:
    def __init__(self, today: list[EventOccurrence], agenda: list[EventOccurrence]) -> None:
        self._today = today
        self._agenda = agenda
        self.windows: list[DateWindow] = []

    async def range(self, workspace_id: uuid.UUID, window: DateWindow) -> CalendarRange:
        self.windows.append(window)
        return CalendarRange(occurrences=self._today, scheduled_tasks=[], due_tasks=[])

    async def agenda(
        self,
        workspace_id: uuid.UUID,
        start: datetime,
        limit: int,
        cursor: str | None = None,
        include_tasks: bool = True,
    ) -> AgendaPage:
        items = [
            AgendaItem(start_at=o.start_at, sort_key=o.title, occurrence=o) for o in self._agenda
        ]
        return AgendaPage(items=items, next_cursor=None)


class FakeReminders:
    async def upcoming(self, workspace_id: uuid.UUID, limit: int) -> list[ReminderView]:
        return []


class FakeHabits:
    def __init__(self) -> None:
        self.calls: list[tuple[date | None, str]] = []

    async def today(self, workspace_id: uuid.UUID, day: date | None, timezone: str) -> TodayView:
        self.calls.append((day, timezone))
        return TodayView(day=day or NOW.date(), habits=[], week=[], upcoming=[])


class FakeDocuments:
    async def counts(self, workspace_id: uuid.UUID, today: date) -> DocumentCounts:
        return DocumentCounts(*([0] * 13))

    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]:
        return [], 0


class BrokenPayments:
    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]:
        raise RuntimeError("the finance tables are unreachable")


class FakeTransaction:
    def __init__(self) -> None:
        self.rollbacks = 0

    async def commit(self) -> None:
        raise AssertionError("the overview never writes")

    async def rollback(self) -> None:
        self.rollbacks += 1


def service(
    *,
    tasks: FakeTasks | None = None,
    calendar: FakeCalendar | None = None,
    habits: FakeHabits | None = None,
    transaction: FakeTransaction | None = None,
) -> DailyOverviewService:
    return DailyOverviewService(
        tasks=tasks or FakeTasks(),
        calendar=calendar or FakeCalendar([], []),
        reminders=FakeReminders(),
        habits=habits or FakeHabits(),
        documents=FakeDocuments(),
        payments=BrokenPayments(),
        transaction=transaction or FakeTransaction(),
        clock=lambda: NOW,
    )


class TestOverviewService:
    @pytest.mark.anyio
    async def test_today_is_the_users_date_not_utcs(self) -> None:
        tasks, habits, calendar = FakeTasks(), FakeHabits(), FakeCalendar([], [])

        result = await service(tasks=tasks, habits=habits, calendar=calendar).today(
            WS, "Asia/Tokyo"
        )

        assert result.day == date(2030, 6, 11)
        assert tasks.days == [date(2030, 6, 11)]
        assert habits.calls == [(date(2030, 6, 11), "Asia/Tokyo")]
        assert calendar.windows[0].start == date(2030, 6, 11)
        assert calendar.windows[0].end == date(2030, 6, 12)
        overdue, due_today = tasks.queries
        assert overdue.due_to == date(2030, 6, 10)
        assert (due_today.due_from, due_today.due_to) == (date(2030, 6, 11), date(2030, 6, 11))

    @pytest.mark.anyio
    async def test_a_failing_module_is_reported_and_the_rest_still_load(self) -> None:
        transaction = FakeTransaction()

        result = await service(transaction=transaction).today(WS, "UTC")

        assert result.unavailable == ("payments",)
        assert result.payments is None
        assert result.tasks is not None
        assert result.documents is not None
        # The session is rolled back so a failed statement can't break later queries.
        assert transaction.rollbacks == 1

    @pytest.mark.anyio
    async def test_only_requested_sections_are_loaded(self) -> None:
        tasks = FakeTasks()

        result = await service(tasks=tasks).today(WS, "UTC", ["habits"])

        assert tasks.days == []
        assert result.tasks is None
        assert result.habits is not None
        # Payments weren't asked for, so they can't fail.
        assert result.unavailable == ()

    @pytest.mark.anyio
    async def test_events_today_skip_cancelled_and_put_all_day_first(self) -> None:
        nine = datetime(2030, 6, 10, 9, tzinfo=UTC)
        today = [
            _event("Lunch", nine + timedelta(hours=3)),
            _event("Cancelled", nine, status="cancelled"),
            _event("Holiday", datetime(2030, 6, 10, tzinfo=UTC), all_day=True),
            _event("Standup", nine),
        ]
        agenda = [
            _event("Ongoing", NOW - timedelta(minutes=10)),
            _event("Trip", NOW + timedelta(hours=1), all_day=True),
            _event("Dentist", NOW + timedelta(days=1)),
        ]

        result = await service(calendar=FakeCalendar(today, agenda)).today(WS, "UTC")

        assert result.events is not None
        assert [o.title for o in result.events.today] == ["Holiday", "Standup", "Lunch"]
        # The next appointment is the first timed one that hasn't started.
        assert result.events.next is not None
        assert result.events.next.title == "Dentist"

    @pytest.mark.anyio
    async def test_no_next_event_beyond_a_week(self) -> None:
        agenda = [_event("Far away", NOW + timedelta(days=8))]

        result = await service(calendar=FakeCalendar([], agenda)).today(WS, "UTC")

        assert result.events is not None
        assert result.events.next is None


def _payment(name: str, due: date, status: PaymentStatus) -> PaymentItem:
    return PaymentItem(
        kind="bill",
        commitment_id=uuid.uuid4(),
        occurrence_id=None,
        name=name,
        counterparty="",
        amount=99_900,
        estimated=False,
        currency="INR",
        due_date=due,
        status=status,
        account_id=None,
        paid_on=None,
        transaction_ids=(),
    )


class FakePayments:
    def __init__(self, items: list[PaymentItem]) -> None:
        self._items = items
        self.queries: list[PaymentQuery] = []

    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]:
        self.queries.append(query)
        return self._items


@pytest.mark.anyio
async def test_payments_put_overdue_first_and_look_a_week_ahead() -> None:
    day = NOW.date()
    payments = FakePayments(
        [
            _payment("Internet", day + timedelta(days=3), "upcoming"),
            _payment("Rent", day - timedelta(days=2), "overdue"),
            _payment("Power", day, "due"),
            _payment("Phone", day - timedelta(days=9), "overdue"),
        ]
    )
    overview_service = DailyOverviewService(
        tasks=FakeTasks(),
        calendar=FakeCalendar([], []),
        reminders=FakeReminders(),
        habits=FakeHabits(),
        documents=FakeDocuments(),
        payments=payments,
        transaction=FakeTransaction(),
        clock=lambda: NOW,
    )

    result = await overview_service.today(WS, "UTC", ["payments"])

    assert result.payments is not None
    assert (result.payments.overdue, result.payments.due_soon) == (2, 2)
    assert [item.name for item in result.payments.items] == ["Phone", "Rent", "Power", "Internet"]
    (query,) = payments.queries
    assert (query.date_from, query.date_to) == (day, day + timedelta(days=7))
    assert query.include_overdue
