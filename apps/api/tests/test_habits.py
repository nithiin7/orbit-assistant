"""The habits and routines API: habits, schedules, the log, streaks, the Today view, analytics,
reminders through the reminder system, calendar entries, tasks and notes, routines and sessions,
and workspace isolation.

The API uses the real clock, so logged days are relative to today (in UTC, every habit's time
zone here). Reminders delivered by the worker use habits that start in 2030.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.scheduler.worker import ReminderWorker
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
DAILY = {"type": "daily"}
EVERY_DAY = {"type": "weekdays", "weekdays": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}

Headers = dict[str, str]
Json = dict[str, Any]


def today() -> date:
    return datetime.now(UTC).date()


def ago(days: int) -> str:
    return (today() - timedelta(days=days)).isoformat()


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


@pytest.fixture
def habits(ws: str) -> str:
    return f"{ws}/habits"


@pytest.fixture
def routines(ws: str) -> str:
    return f"{ws}/routines"


def create(client: TestClient, habits: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "name": "Read",
        "schedule": DAILY,
        "start_date": ago(10),
        "timezone": "UTC",
        **fields,
    }
    response = client.post(habits, json=body, headers=headers)
    assert response.status_code == 201, response.text
    habit: Json = response.json()
    return habit


def log(
    client: TestClient, habits: str, headers: Headers, habit: Json, day: str, **body: Any
) -> Json:
    response = client.put(f"{habits}/{habit['id']}/log/{day}", json=body, headers=headers)
    assert response.status_code == 200, response.text
    result: Json = response.json()
    return result


def detail(client: TestClient, habits: str, headers: Headers, habit: Json) -> Json:
    result: Json = client.get(f"{habits}/{habit['id']}", headers=headers).json()
    return result


def managed_reminders(client: TestClient, ws: str, headers: Headers) -> list[Json]:
    reminders: list[Json] = client.get(f"{ws}/reminders", headers=headers).json()["reminders"]
    return [r for r in reminders if r["commitment"] and r["commitment"]["kind"] == "habit_reminder"]


def _db(client: TestClient) -> Any:
    app: Any = client.app
    return app.state.settings.sqlite_path


class TestHabits:
    def test_create_get_and_list(self, client: TestClient, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada, description="Twenty pages", time_of_day="21:00")
        assert habit["habit"]["kind"] == "boolean" and habit["habit"]["target"] is None
        assert habit["habit"]["schedule"]["type"] == "daily"
        assert habit["state"] == "pending" and habit["current_streak"] == 0
        assert habit["reminders"] == [] and habit["tasks"] == [] and habit["notes"] == []
        listed = client.get(habits, headers=ada).json()["habits"]
        assert [h["habit"]["id"] for h in listed] == [habit["habit"]["id"]]

    def test_default_categories(self, client: TestClient, habits: str, ada: Headers) -> None:
        names = [
            c["name"] for c in client.get(f"{habits}/categories", headers=ada).json()["categories"]
        ]
        assert names == [
            "Health",
            "Fitness",
            "Learning",
            "Productivity",
            "Personal",
            "Finance",
            "Lifestyle",
            "Other",
        ]
        created = client.post(
            f"{habits}/categories", json={"name": "Mind", "color": "violet"}, headers=ada
        )
        assert created.status_code == 201
        duplicate = client.post(f"{habits}/categories", json={"name": "mind"}, headers=ada)
        assert duplicate.status_code == 409
        habit = create(client, habits, ada, category_id=created.json()["id"])
        client.delete(f"{habits}/categories/{created.json()['id']}", headers=ada)
        assert detail(client, habits, ada, habit["habit"])["habit"]["category_id"] is None

    def test_validation(self, client: TestClient, habits: str, ada: Headers) -> None:
        base = {"name": "Water", "start_date": ago(1), "schedule": DAILY}
        for body in (
            {**base, "kind": "numeric"},
            {**base, "schedule": {"type": "weekdays"}},
            {**base, "schedule": {"type": "weekly_target", "times_per_week": 9}},
            {**base, "end_date": ago(5)},
            {**base, "time_of_day": "07:30:15"},
            {**base, "icon": "rocket"},
        ):
            assert client.post(habits, json=body, headers=ada).status_code == 422, body

    def test_delete(self, client: TestClient, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada)["habit"]
        log(client, habits, ada, habit, ago(1))
        assert client.delete(f"{habits}/{habit['id']}", headers=ada).status_code == 204
        assert client.get(f"{habits}/{habit['id']}", headers=ada).status_code == 404
        assert query(_db(client), "SELECT COUNT(*) FROM habit_logs") == [(0,)]


class TestLog:
    def test_complete_skip_and_undo(self, client: TestClient, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada)["habit"]
        done = log(client, habits, ada, habit, today().isoformat())
        assert done["state"] == "completed" and done["log"]["status"] == "completed"
        assert done["current_streak"] == 1
        skipped = log(client, habits, ada, habit, ago(1), status="skipped", note="Travelling")
        assert skipped["state"] == "skipped" and skipped["log"]["note"] == "Travelling"
        undone = client.delete(f"{habits}/{habit['id']}/log/{today().isoformat()}", headers=ada)
        assert undone.json()["state"] == "pending" and undone.json()["log"] is None

    def test_one_entry_per_day(self, client: TestClient, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada)["habit"]
        log(client, habits, ada, habit, ago(2))
        log(client, habits, ada, habit, ago(2), status="skipped")
        assert query(_db(client), "SELECT COUNT(*), MAX(skipped) FROM habit_logs") == [(1, 1)]

    def test_partial_progress(self, client: TestClient, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada, kind="numeric", unit="litres", target=3)["habit"]
        partial = log(client, habits, ada, habit, today().isoformat(), status="progress", value=1.5)
        assert partial["state"] == "partial" and partial["log"]["target"] == 3
        full = log(client, habits, ada, habit, today().isoformat(), status="progress", value=3.2)
        assert full["state"] == "completed"
        # Past partial days show their progress, but count as missed.
        past = log(client, habits, ada, habit, ago(1), status="progress", value=1)
        assert past["state"] == "partial" and past["period"]["state"] == "missed"

    def test_target_changes_keep_history(
        self, client: TestClient, habits: str, ada: Headers
    ) -> None:
        habit = create(client, habits, ada, kind="duration", target=15)["habit"]
        log(client, habits, ada, habit, ago(1))
        client.patch(f"{habits}/{habit['id']}", json={"target": 30}, headers=ada)
        history = client.get(
            f"{habits}/{habit['id']}/history", params={"start": ago(1), "end": ago(1)}, headers=ada
        ).json()
        assert history["days"][0]["state"] == "completed"
        assert history["days"][0]["log"]["target"] == 15

    def test_refuses_future_and_out_of_range_days(
        self, client: TestClient, habits: str, ada: Headers
    ) -> None:
        habit = create(client, habits, ada, start_date=ago(3))["habit"]
        tomorrow = (today() + timedelta(days=1)).isoformat()
        for day in (tomorrow, ago(4)):
            response = client.put(f"{habits}/{habit['id']}/log/{day}", json={}, headers=ada)
            assert response.status_code == 422
        response = client.put(
            f"{habits}/{habit['id']}/log/{ago(1)}", json={"status": "progress"}, headers=ada
        )
        assert response.status_code == 422


class TestStreaks:
    def test_daily_streak_and_rates(self, client: TestClient, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada, start_date=ago(6))["habit"]
        for days in (6, 5, 3, 2, 1):
            log(client, habits, ada, habit, ago(days))
        result = detail(client, habits, ada, habit)
        # Today is pending, so it doesn't break the streak; the 4th day back was missed.
        assert (result["current_streak"], result["longest_streak"]) == (3, 3)
        assert result["streak_unit"] == "day" and result["total_completions"] == 5
        assert result["completion_rate"] == pytest.approx(5 / 6)

    def test_paused_days_neither_break_nor_count(
        self, client: TestClient, habits: str, ada: Headers
    ) -> None:
        habit = create(client, habits, ada, start_date=ago(2))["habit"]
        log(client, habits, ada, habit, ago(2))
        log(client, habits, ada, habit, ago(1))
        paused = client.patch(f"{habits}/{habit['id']}", json={"status": "paused"}, headers=ada)
        body = paused.json()
        assert body["habit"]["status"] == "paused" and body["state"] == "paused"
        assert body["habit"]["pauses"] == [{"start": today().isoformat(), "end": None}]
        assert body["current_streak"] == 2
        # Resuming the same day leaves no pause behind.
        resumed = client.patch(f"{habits}/{habit['id']}", json={"status": "active"}, headers=ada)
        assert resumed.json()["habit"]["pauses"] == [] and resumed.json()["state"] == "pending"

    def test_schedule_changes_keep_history(
        self, client: TestClient, habits: str, ada: Headers
    ) -> None:
        habit = create(client, habits, ada, start_date=ago(7))["habit"]
        for days in range(1, 8):
            log(client, habits, ada, habit, ago(days))
        weekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(today().weekday() + 1) % 7]
        changed = client.patch(
            f"{habits}/{habit['id']}",
            json={"schedule": {"type": "weekdays", "weekdays": [weekday]}},
            headers=ada,
        ).json()
        assert [v["schedule"]["type"] for v in changed["habit"]["schedule_history"]] == [
            "daily",
            "weekdays",
        ]
        # Today isn't due under the new schedule; the past week still counts.
        assert changed["state"] == "unscheduled"
        assert changed["current_streak"] == 7 and changed["completion_rate"] == 1

    def test_weekly_target(self, client: TestClient, habits: str, ada: Headers) -> None:
        start = today() - timedelta(days=today().weekday() + 7)  # Monday last week
        habit = create(
            client,
            habits,
            ada,
            start_date=start.isoformat(),
            schedule={"type": "weekly_target", "times_per_week": 3},
        )["habit"]
        for offset in (0, 2, 4):
            log(client, habits, ada, habit, (start + timedelta(days=offset)).isoformat())
        result = detail(client, habits, ada, habit)
        assert result["streak_unit"] == "week" and result["current_streak"] == 1
        assert result["period"]["unit"] == "week" and result["period"]["required"] == 3
        assert result["state"] == "open"


class TestViews:
    def test_today(self, client: TestClient, habits: str, ada: Headers) -> None:
        read = create(client, habits, ada)["habit"]
        create(
            client, habits, ada, name="Gym", schedule={"type": "weekly_target", "times_per_week": 2}
        )
        log(client, habits, ada, read, today().isoformat())
        view = client.get(f"{habits}/today", params={"timezone": "UTC"}, headers=ada).json()
        assert view["day"] == today().isoformat()
        assert {h["habit"]["name"]: h["state"] for h in view["habits"]} == {
            "Read": "completed",
            "Gym": "open",
        }
        assert len(view["week"]) == 7 and len(view["upcoming"]) == 7
        assert view["upcoming"][0]["habit_ids"] == [read["id"]]
        week = {d["day"]: d for d in view["week"]}
        assert week[today().isoformat()]["completed"] == 1

    def test_analytics(self, client: TestClient, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada, start_date=ago(13))["habit"]
        for days in range(7, 14):
            log(client, habits, ada, habit, ago(days))
        result = client.get(
            f"{habits}/analytics", params={"start": ago(13), "end": ago(0)}, headers=ada
        ).json()
        assert len(result["heatmap"]) == 14
        performance = result["habits"][0]
        assert (performance["met"], performance["missed"]) == (7, 6)
        assert performance["trend"] < 0  # Declining: done the first week, not the second.
        assert result["categories"][0]["name"] == "Uncategorized"
        assert sum(p["met"] for p in result["weekly"]) == 7
        too_long = {"start": "2020-01-01", "end": "2026-01-01"}
        assert client.get(f"{habits}/analytics", params=too_long, headers=ada).status_code == 422

    def test_calendar_entries(
        self, client: TestClient, habits: str, routines: str, ada: Headers
    ) -> None:
        create(
            client,
            habits,
            ada,
            name="Stretch",
            start_date="2030-01-01",
            schedule={"type": "weekdays", "weekdays": ["mon", "wed"]},
            time_of_day="07:00",
        )
        create(client, habits, ada, name="No time", start_date="2030-01-01")
        create(
            client,
            habits,
            ada,
            name="Flexible",
            start_date="2030-01-01",
            time_of_day="08:00",
            schedule={"type": "weekly_target", "times_per_week": 2},
        )
        client.post(
            routines,
            json={
                "name": "Morning",
                "time_of_day": "06:30",
                "weekdays": ["mon"],
                "timezone": "UTC",
                "steps": [
                    {"name": "Water", "duration_minutes": 5},
                    {"name": "Walk", "duration_minutes": 20},
                ],
            },
            headers=ada,
        )
        # 2030-01-14 is a Monday.
        result = client.get(
            f"{habits}/calendar",
            params={"start": "2030-01-14", "end": "2030-01-17", "timezone": "UTC"},
            headers=ada,
        ).json()["entries"]
        assert [(e["kind"], e["title"], e["start_at"], e["end_at"]) for e in result] == [
            ("routine", "Morning", "2030-01-14T06:30:00Z", "2030-01-14T06:55:00Z"),
            ("habit", "Stretch", "2030-01-14T07:00:00Z", "2030-01-14T07:15:00Z"),
            ("habit", "Stretch", "2030-01-16T07:00:00Z", "2030-01-16T07:15:00Z"),
        ]

    def test_calendar_preference(self, client: TestClient, ada: Headers) -> None:
        url = "/api/v1/me/calendar-preferences"
        assert client.get(url, headers=ada).json()["show_habits"] is True
        saved = client.put(url, json={"show_habits": False}, headers=ada)
        assert saved.status_code == 200 and saved.json()["show_habits"] is False


class TestReminders:
    def test_reminder_times_become_managed_reminders(
        self, client: TestClient, ws: str, habits: str, ada: Headers
    ) -> None:
        habit = create(client, habits, ada, start_date="2030-01-14", reminders=[{"time": "07:00"}])
        assert [r["time"] for r in habit["reminders"]] == ["07:00:00"]
        [reminder] = managed_reminders(client, ws, ada)
        assert (
            reminder["title"] == "Read" and reminder["next_occurrence_at"] == "2030-01-14T07:00:00Z"
        )
        # The reminders API refuses to change it.
        url = f"{ws}/reminders/{reminder['id']}"
        assert client.patch(url, json={"title": "X"}, headers=ada).status_code == 409

        # Weekday-specific: only Wednesdays.
        client.put(
            f"{habits}/{habit['habit']['id']}/reminders",
            json={"reminders": [{"time": "07:00", "weekdays": ["wed"]}]},
            headers=ada,
        )
        [same] = managed_reminders(client, ws, ada)
        assert same["id"] == reminder["id"]  # Kept, not duplicated.
        assert same["next_occurrence_at"] == "2030-01-16T07:00:00Z"

        # Pausing cancels it; resuming brings it back.
        client.patch(f"{habits}/{habit['habit']['id']}", json={"status": "paused"}, headers=ada)
        assert managed_reminders(client, ws, ada) == []
        client.patch(f"{habits}/{habit['habit']['id']}", json={"status": "active"}, headers=ada)
        assert len(managed_reminders(client, ws, ada)) == 1

        # Removing the time, or deleting the habit, deletes the reminder.
        client.put(
            f"{habits}/{habit['habit']['id']}/reminders", json={"reminders": []}, headers=ada
        )
        assert managed_reminders(client, ws, ada) == []
        assert query(_db(client), "SELECT COUNT(*) FROM reminder_occurrences") == [(0,)]

    def test_completing_today_moves_the_reminder(
        self, client: TestClient, ws: str, habits: str, ada: Headers
    ) -> None:
        habit = create(client, habits, ada, reminders=[{"time": "23:59"}])["habit"]
        log(client, habits, ada, habit, today().isoformat())
        [reminder] = managed_reminders(client, ws, ada)
        assert reminder["next_occurrence_at"][:10] > today().isoformat()

    def test_archiving_cancels(
        self, client: TestClient, ws: str, habits: str, ada: Headers
    ) -> None:
        habit = create(client, habits, ada, reminders=[{"time": "06:00"}, {"time": "20:00"}])
        assert len(managed_reminders(client, ws, ada)) == 2
        client.patch(f"{habits}/{habit['habit']['id']}", json={"status": "archived"}, headers=ada)
        assert managed_reminders(client, ws, ada) == []
        archived = client.get(habits, params={"status": "archived"}, headers=ada).json()["habits"]
        assert len(archived) == 1

    def test_duplicate_times_are_refused(
        self, client: TestClient, habits: str, ada: Headers
    ) -> None:
        body = {
            "name": "Read",
            "schedule": DAILY,
            "start_date": ago(0),
            "reminders": [{"time": "07:00"}, {"time": "07:00"}],
        }
        assert client.post(habits, json=body, headers=ada).status_code == 422


@pytest.fixture
async def database(migrated_settings: Settings) -> AsyncIterator[Database]:
    database = await open_database(migrated_settings)
    yield database
    await database.dispose()


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.mark.anyio
async def test_worker_delivers_and_moves_to_the_next_due_day(
    client: TestClient, ws: str, habits: str, routines: str, ada: Headers, database: Database
) -> None:
    create(
        client,
        habits,
        ada,
        start_date="2030-01-14",
        schedule={"type": "weekdays", "weekdays": ["mon", "thu"]},
        reminders=[{"time": "07:00"}],
    )
    client.post(
        routines,
        json={"name": "Evening", "timezone": "UTC", "reminders": [{"time": "07:00"}]},
        headers=ada,
    )
    clock = Clock(datetime(2030, 1, 14, 7, 0, 30, tzinfo=UTC))
    worker = ReminderWorker(database, clock=clock)
    # The routine's reminder is for today in real time; only the habit's is due in 2030.
    await worker.run_once()
    inbox = client.get("/api/v1/me/notifications", headers=ada).json()
    assert "Read" in [n["title"] for n in inbox["notifications"]]
    by_title = {r["title"]: r for r in managed_reminders(client, ws, ada)}
    assert by_title["Read"]["next_occurrence_at"] == "2030-01-17T07:00:00Z"
    assert (await worker.run_once()).claimed == 0


class TestRoutines:
    def test_create_edit_and_reorder(self, client: TestClient, routines: str, ada: Headers) -> None:
        created = client.post(
            routines,
            json={
                "name": "Morning",
                "weekdays": ["mon", "tue"],
                "steps": [
                    {"name": "Water", "duration_minutes": 2},
                    {"name": "Stretch", "duration_minutes": 10},
                ],
            },
            headers=ada,
        )
        assert created.status_code == 201, created.text
        routine = created.json()
        assert routine["estimated_minutes"] == 12 and routine["weekdays"] == ["mon", "tue"]
        water, stretch = routine["steps"]
        updated = client.patch(
            f"{routines}/{routine['id']}",
            json={"steps": [{"id": stretch["id"], "name": "Stretch"}, {"name": "Journal"}]},
            headers=ada,
        ).json()
        assert [(s["name"], s["position"]) for s in updated["steps"]] == [
            ("Stretch", 0),
            ("Journal", 1),
        ]
        assert updated["steps"][0]["id"] == stretch["id"]
        assert water["id"] not in {s["id"] for s in updated["steps"]}
        unknown = client.patch(
            f"{routines}/{routine['id']}",
            json={"steps": [{"id": str(uuid.uuid4()), "name": "X"}]},
            headers=ada,
        )
        assert unknown.status_code == 422

    def test_sessions(self, client: TestClient, habits: str, routines: str, ada: Headers) -> None:
        habit = create(client, habits, ada, name="Meditate")["habit"]
        routine = client.post(
            routines,
            json={
                "name": "Morning",
                "timezone": "UTC",
                "steps": [{"name": "Meditate", "habit_id": habit["id"]}, {"name": "Run"}],
            },
            headers=ada,
        ).json()
        base = f"{routines}/{routine['id']}/sessions"
        session = client.post(base, json={}, headers=ada)
        assert session.status_code == 201
        session = session.json()
        assert session["status"] == "active" and session["day"] == today().isoformat()
        # No second active session.
        assert client.post(base, json={}, headers=ada).status_code == 409

        meditate, run = session["steps"]
        done = client.patch(
            f"{base}/{session['id']}/steps/{meditate['id']}",
            json={"status": "completed"},
            headers=ada,
        ).json()
        assert done["steps"][0]["status"] == "completed"
        # Completing the step completed its habit for the day.
        assert detail(client, habits, ada, habit)["state"] == "completed"
        assert done["status"] == "active"
        # Settling the last pending step finishes the session by itself.
        last = client.patch(
            f"{base}/{session['id']}/steps/{run['id']}", json={"status": "skipped"}, headers=ada
        ).json()
        assert last["status"] == "completed" and last["finished_at"] is not None
        undo = client.patch(
            f"{base}/{session['id']}/steps/{run['id']}", json={"status": "pending"}, headers=ada
        )
        assert undo.status_code == 409

        # Editing the routine doesn't change the session; notes stay editable.
        client.patch(f"{routines}/{routine['id']}", json={"name": "Dawn", "steps": []}, headers=ada)
        finished = client.patch(
            f"{base}/{session['id']}", json={"notes": "Felt good"}, headers=ada
        ).json()
        assert finished["status"] == "completed" and finished["finished_at"] is not None
        assert finished["routine_name"] == "Morning"
        assert [s["status"] for s in finished["steps"]] == ["completed", "skipped"]
        again = client.patch(f"{base}/{session['id']}", json={"status": "abandoned"}, headers=ada)
        assert again.status_code == 409

        listed = client.get(base, headers=ada).json()
        assert listed["total"] == 1 and listed["sessions"][0]["notes"] == "Felt good"
        result = client.get(f"{routines}/{routine['id']}", headers=ada).json()
        assert result["sessions_completed"] == 1 and result["active_session"] is None

        # A new session can start once the last one ended, and be abandoned.
        second = client.post(base, json={}, headers=ada).json()
        assert second["steps"] == []
        abandoned = client.patch(
            f"{base}/{second['id']}", json={"status": "abandoned"}, headers=ada
        )
        assert abandoned.json()["status"] == "abandoned"

    def test_all_skipped_session_stays_active(
        self, client: TestClient, routines: str, ada: Headers
    ) -> None:
        routine = client.post(
            routines, json={"name": "Evening", "steps": [{"name": "Read"}]}, headers=ada
        ).json()
        base = f"{routines}/{routine['id']}/sessions"
        session = client.post(base, json={}, headers=ada).json()
        step = session["steps"][0]["id"]
        skipped = client.patch(
            f"{base}/{session['id']}/steps/{step}", json={"status": "skipped"}, headers=ada
        ).json()
        assert skipped["status"] == "active"
        result = client.get(f"{routines}/{routine['id']}", headers=ada).json()
        assert result["sessions_completed"] == 0 and result["active_session"] is not None

    def test_session_note(self, client: TestClient, routines: str, ada: Headers) -> None:
        routine = client.post(routines, json={"name": "Study"}, headers=ada).json()
        base = f"{routines}/{routine['id']}/sessions"
        session = client.post(base, json={}, headers=ada).json()
        note = client.post(f"{base}/{session['id']}/note", json={}, headers=ada)
        assert note.status_code == 201 and note.json()["title"].startswith("Study · ")
        fetched = client.get(f"{base}/{session['id']}", headers=ada).json()
        assert fetched["note_id"] == note.json()["id"]


class TestLinks:
    def test_tasks_and_notes(self, client: TestClient, ws: str, habits: str, ada: Headers) -> None:
        habit = create(client, habits, ada)["habit"]
        task = client.post(
            f"{habits}/{habit['id']}/tasks", json={"title": "Buy a book"}, headers=ada
        )
        assert task.status_code == 201
        other = client.post(f"{ws}/tasks", json={"title": "Library card"}, headers=ada).json()
        client.put(f"{habits}/{habit['id']}/tasks/{other['id']}", headers=ada)
        note = client.post(
            f"{habits}/{habit['id']}/notes", json={"day": ago(0)}, headers=ada
        ).json()
        assert note["title"].startswith("Read · ")
        result = detail(client, habits, ada, habit)
        assert {t["title"] for t in result["tasks"]} == {"Buy a book", "Library card"}
        assert [n["id"] for n in result["notes"]] == [note["id"]]
        client.delete(f"{habits}/{habit['id']}/tasks/{other['id']}", headers=ada)
        client.delete(f"{habits}/{habit['id']}/notes/{note['id']}", headers=ada)
        result = detail(client, habits, ada, habit)
        assert [t["title"] for t in result["tasks"]] == ["Buy a book"] and result["notes"] == []
        # Deleting the task removes the link.
        client.delete(f"{ws}/tasks/{task.json()['id']}", headers=ada)
        assert detail(client, habits, ada, habit)["tasks"] == []


class TestIsolation:
    def test_other_workspaces_are_unreachable(
        self, client: TestClient, ws: str, habits: str, routines: str, ada: Headers, grace: Headers
    ) -> None:
        habit = create(client, habits, ada)["habit"]
        routine = client.post(routines, json={"name": "Morning"}, headers=ada).json()
        # Grace can't reach Ada's workspace at all.
        assert client.get(f"{habits}/{habit['id']}", headers=grace).status_code == 404
        assert client.get(routines, headers=grace).status_code == 404

        # Nor can she use Ada's IDs inside her own workspace.
        mine = personal(client, grace)
        assert client.get(f"{mine}/habits/{habit['id']}", headers=grace).status_code == 404
        assert client.get(f"{mine}/routines/{routine['id']}", headers=grace).status_code == 404
        put = client.put(f"{mine}/habits/{habit['id']}/log/{ago(0)}", json={}, headers=grace)
        assert put.status_code == 404

        # Ada can't link Grace's task, note, or habit.
        their_task = client.post(f"{mine}/tasks", json={"title": "Theirs"}, headers=grace).json()
        their_habit = create(client, f"{mine}/habits", grace)["habit"]
        linked = client.put(f"{habits}/{habit['id']}/tasks/{their_task['id']}", headers=ada)
        assert linked.status_code == 422
        step = client.patch(
            f"{routines}/{routine['id']}",
            json={"steps": [{"name": "X", "habit_id": their_habit["id"]}]},
            headers=ada,
        )
        assert step.status_code == 422
        step = client.patch(
            f"{routines}/{routine['id']}",
            json={"steps": [{"name": "X", "task_id": their_task["id"]}]},
            headers=ada,
        )
        assert step.status_code == 422
        # Lists only show the workspace's own habits.
        assert [h["habit"]["name"] for h in client.get(habits, headers=ada).json()["habits"]] == [
            "Read"
        ]

    def test_requires_sign_in(self, client: TestClient, habits: str) -> None:
        assert client.get(habits).status_code == 401
