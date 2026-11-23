"""Daily briefings through the API: aggregation across real modules, persistence, history, and
isolation. The aggregator's rules with fake modules are in `test_briefing_units.py`."""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

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


def today_in(timezone: str = "UTC") -> date:
    return datetime.now(ZoneInfo(timezone)).date()


def ok(response: Any, code: int = 200) -> Json:
    assert response.status_code == code, response.text
    body: Json = response.json()
    return body


def post(client: TestClient, url: str, headers: Headers, body: Json) -> Json:
    return ok(client.post(url, json=body, headers=headers), 201)


def briefing(client: TestClient, ws: str, headers: Headers, timezone: str = "UTC") -> Json:
    return ok(client.get(f"{ws}/briefings/today", params={"timezone": timezone}, headers=headers))


def regenerate(client: TestClient, ws: str, headers: Headers, timezone: str = "UTC") -> Json:
    return ok(
        client.post(
            f"{ws}/briefings/today/regenerate", json={"timezone": timezone}, headers=headers
        )
    )


def task(client: TestClient, ws: str, headers: Headers, title: str, **fields: Any) -> Json:
    return post(client, f"{ws}/tasks", headers, {"title": title, **fields})


def titles(items: list[Json], field: str = "title") -> list[str]:
    return [item[field] for item in items]


def source(body: Json, module: str) -> Json:
    found: Json = next(s for s in body["content"]["sources"] if s["module"] == module)
    return found


class TestEmptyAndShape:
    def test_an_empty_workspace_gives_a_complete_briefing_with_empty_sections(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        body = briefing(client, ws, ada)
        content = body["content"]

        assert body["date"] == today_in().isoformat()
        assert (body["timezone"], body["status"], body["revision"]) == ("UTC", "complete", 1)
        assert content["unavailable"] == []
        assert content["window"]["date"] == body["date"]
        assert {s["status"] for s in content["sources"]} == {"empty"}
        # Every module is reported, in a fixed order.
        assert [s["module"] for s in content["sources"]] == [
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
            "people",
            "notes",
            "reminders",
        ]
        # Empty modules are empty sections, never missing ones.
        assert content["schedule"] == {
            "events": [],
            "time_blocks": [],
            "conflicts": [],
            "upcoming": [],
        }
        assert content["tasks"]["overdue"] == {"items": [], "total": 0}
        assert content["reminders"] == {"items": [], "represented_elsewhere": 0}
        assert content["payments"] == {"items": [], "overdue": 0, "due_today": 0, "upcoming": 0}
        assert content["budgets"] == {"items": [], "exceeded": 0, "approaching": 0}
        assert content["habits"] == {"habits": [], "remaining": 0, "done": 0}
        assert content["health"] == {"workouts": [], "goals": []}
        assert content["notes"] == {"items": []}
        assert content["documents"] == {"items": [], "expired": 0, "expiring": 0}
        assert content["shopping"] == {"lists": [], "needed": 0}
        assert content["investments"] == {"sips": [], "deposits": []}
        assert content["summary"]["attention"] == []

    @pytest.mark.parametrize(
        ("method", "path", "kwargs"),
        [
            ("get", "/briefings/today", {"params": {"timezone": "Mars/Olympus"}}),
            ("post", "/briefings/today/regenerate", {"json": {"timezone": "Nowhere"}}),
            ("post", "/briefings/today/regenerate", {"json": {"extra": 1}}),
            ("get", "/briefings", {"params": {"limit": 0}}),
            ("get", "/briefings", {"params": {"limit": 101}}),
            ("get", "/briefings", {"params": {"offset": -1}}),
            ("get", "/briefings/not-a-date", {}),
        ],
    )
    def test_invalid_input_is_rejected(
        self, client: TestClient, ws: str, ada: Headers, method: str, path: str, kwargs: Json
    ) -> None:
        response = getattr(client, method)(f"{ws}{path}", headers=ada, **kwargs)
        assert response.status_code == 422, response.text

    def test_the_users_time_zone_is_the_default(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        ok(client.patch("/api/v1/me", json={"timezone": "Asia/Kolkata"}, headers=ada))

        body = ok(client.get(f"{ws}/briefings/today", headers=ada))

        assert body["timezone"] == "Asia/Kolkata"
        assert body["date"] == today_in("Asia/Kolkata").isoformat()


class TestTasks:
    def test_tasks_are_sorted_into_overdue_today_priority_and_done(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_in()
        task(client, ws, ada, "Late", due_date=str(today - timedelta(3)))
        task(client, ws, ada, "Later late", due_date=str(today - timedelta(1)))
        task(client, ws, ada, "Today", due_date=str(today))
        task(client, ws, ada, "Today urgent", due_date=str(today), priority="high")
        task(client, ws, ada, "Big, someday", priority="high")
        task(client, ws, ada, "Big, next week", priority="high", due_date=str(today + timedelta(5)))
        task(client, ws, ada, "Someday")
        task(client, ws, ada, "Friday", due_date=str(today + timedelta(4)))
        task(client, ws, ada, "Next month", due_date=str(today + timedelta(30)))
        done = task(client, ws, ada, "Done", due_date=str(today))
        ok(client.post(f"{ws}/tasks/{done['id']}/complete", headers=ada))

        content = briefing(client, ws, ada)["content"]
        tasks = content["tasks"]

        assert titles(tasks["overdue"]["items"]) == ["Late", "Later late"]
        assert {t["severity"] for t in tasks["overdue"]["items"]} == {"warning"}
        assert titles(tasks["due_today"]["items"]) == ["Today urgent", "Today"]
        assert [t["severity"] for t in tasks["due_today"]["items"]] == ["warning", "info"]
        # High priority beyond today: dated first, and an undated one is never urgent.
        assert titles(tasks["high_priority"]["items"]) == ["Big, next week", "Big, someday"]
        assert tasks["high_priority"]["total"] == 2
        assert {t["severity"] for t in tasks["high_priority"]["items"]} == {"info"}
        assert titles(tasks["completed"]["items"]) == ["Done"]
        # Due within the week ahead; nothing undated, nothing further out.
        assert titles(content["deadlines"]["tasks"]["items"]) == ["Friday", "Big, next week"]
        shown = {
            t["title"]
            for bucket in (*tasks.values(), content["deadlines"]["tasks"])
            for t in bucket["items"]
        }
        assert "Someday" not in shown and "Next month" not in shown
        summary = content["summary"]
        assert (summary["tasks_overdue"], summary["tasks_due_today"]) == (2, 2)
        assert source(briefing(client, ws, ada), "tasks")["status"] == "ok"

    def test_more_than_a_page_reports_the_full_total(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        yesterday = str(today_in() - timedelta(1))
        for number in range(12):
            task(client, ws, ada, f"Late {number}", due_date=yesterday)

        overdue = briefing(client, ws, ada)["content"]["tasks"]["overdue"]

        assert len(overdue["items"]) == 10
        assert overdue["total"] == 12


class TestCalendar:
    def test_events_in_the_users_day_with_all_day_first_and_conflicts(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        zone = "Asia/Kolkata"
        today = today_in(zone)
        cal = f"{ws}/calendar"

        def event(title: str, start: datetime, minutes: int = 60, **fields: Any) -> Json:
            end = start + timedelta(minutes=minutes)
            body = {
                "title": title,
                "start": start.strftime("%Y-%m-%dT%H:%M"),
                "end": end.strftime("%Y-%m-%dT%H:%M"),
                "timezone": zone,
                **fields,
            }
            return post(client, f"{cal}/events", ada, body)

        midnight = datetime.combine(today, datetime.min.time())
        event("Standup", midnight + timedelta(hours=9), 30)
        event("Review", midnight + timedelta(hours=9, minutes=15), 60)
        event("Lunch", midnight + timedelta(hours=13))
        # Touching the review's end is not a conflict.
        event("Focus", midnight + timedelta(hours=10, minutes=15), 45)
        event("Late call", midnight + timedelta(hours=23, minutes=30), 15)
        event("Tomorrow early", midnight + timedelta(days=1, minutes=30), 30)
        event("Next week", midnight + timedelta(days=6, hours=9))
        event("Too far", midnight + timedelta(days=9, hours=9))
        post(
            client,
            f"{cal}/events",
            ada,
            {
                "title": "Holiday",
                "all_day": True,
                "start": f"{today}T00:00",
                "end": f"{today + timedelta(1)}T00:00",
                "timezone": zone,
            },
        )
        cancelled = event("Cancelled", midnight + timedelta(hours=15))
        ok(
            client.patch(
                f"{cal}/events/{cancelled['id']}",
                json={"status": "cancelled"},
                headers=ada,
            )
        )

        schedule = briefing(client, ws, ada, zone)["content"]["schedule"]

        assert titles(schedule["events"]) == [
            "Holiday",
            "Standup",
            "Review",
            "Focus",
            "Lunch",
            "Late call",
        ]
        by_title = {e["title"]: e for e in schedule["events"]}
        assert schedule["conflicts"] == [
            {
                "first": by_title["Standup"]["ref"]["key"],
                "second": by_title["Review"]["ref"]["key"],
                "start_at": by_title["Review"]["start_at"],
                "end_at": by_title["Standup"]["end_at"],
            }
        ]
        assert by_title["Standup"]["severity"] == "warning"
        assert by_title["Lunch"]["severity"] == "info"
        assert by_title["Holiday"]["all_day"] is True
        # 09:00 in Kolkata is 03:30 UTC.
        assert by_title["Standup"]["start_at"].startswith(f"{today}T03:30:00")
        assert by_title["Standup"]["local_start"].startswith(f"{today}T09:00:00")
        assert titles(schedule["upcoming"]) == ["Tomorrow early", "Next week"]

    def test_a_recurring_event_shows_todays_occurrence(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_in()
        start = datetime.combine(today - timedelta(days=3), datetime.min.time()) + timedelta(
            hours=8
        )
        post(
            client,
            f"{ws}/calendar/events",
            ada,
            {
                "title": "Run",
                "start": start.strftime("%Y-%m-%dT%H:%M"),
                "end": (start + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M"),
                "timezone": "UTC",
                "recurrence": {"frequency": "daily"},
            },
        )

        schedule = briefing(client, ws, ada)["content"]["schedule"]

        (run,) = schedule["events"]
        assert run["recurring"] is True
        assert run["start_at"].startswith(f"{today}T08:00:00")
        # The key names the occurrence, so each day's is distinct and stable.
        assert run["ref"]["occurrence"].startswith(f"{today}T08:00:00")
        assert run["ref"]["key"] == f"event:{run['ref']['id']}:{run['ref']['occurrence']}"
        assert len(schedule["upcoming"]) == 7

    def test_scheduled_tasks_are_time_blocks(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        start = datetime.combine(today_in(), datetime.min.time(), UTC) + timedelta(hours=14)
        task(
            client,
            ws,
            ada,
            "Write report",
            scheduled_start=start.isoformat(),
            scheduled_end=(start + timedelta(hours=1)).isoformat(),
        )

        schedule = briefing(client, ws, ada)["content"]["schedule"]

        assert titles(schedule["time_blocks"]) == ["Write report"]
        assert schedule["events"] == []


class TestReminders:
    def test_reminders_about_listed_tasks_show_on_the_task_not_twice(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_in()
        call = task(client, ws, ada, "Call the bank", due_date=str(today))
        later = (datetime.now(UTC) + timedelta(hours=1)).replace(second=0, microsecond=0)
        if later.date() != today:
            pytest.skip("too close to midnight UTC for a reminder later today")
        at = {"start_date": str(today), "time_of_day": later.strftime("%H:%M"), "timezone": "UTC"}
        post(client, f"{ws}/reminders", ada, {"title": "Call", "task_id": call["id"], **at})
        post(client, f"{ws}/reminders", ada, {"title": "Water plants", **at})
        post(
            client,
            f"{ws}/reminders",
            ada,
            {
                "title": "Weekly review",
                "start_date": str(today + timedelta(2)),
                "time_of_day": "09:00",
                "timezone": "UTC",
                "recurrence": {
                    "frequency": "weekly",
                    "weekdays": [WEEKDAYS[(today + timedelta(2)).weekday()]],
                },
            },
        )

        content = briefing(client, ws, ada)["content"]

        reminders = content["reminders"]
        assert titles(reminders["items"]) == ["Water plants", "Weekly review"]
        assert [r["bucket"] for r in reminders["items"]] == ["due_today", "upcoming"]
        assert reminders["represented_elsewhere"] == 1
        (listed,) = content["tasks"]["due_today"]["items"]
        assert listed["reminder_at"] is not None
        assert listed["reminder_at"].startswith(f"{today}T{later:%H:%M}")
        assert content["summary"]["reminders_due"] == 1


class TestFinance:
    @pytest.fixture
    def fin(self, ws: str) -> str:
        return f"{ws}/finance"

    def test_payments_use_the_commitments_figures_and_their_reminders_arent_repeated(
        self, client: TestClient, ws: str, ada: Headers, fin: str
    ) -> None:
        today = today_in()
        body = {
            "kind": "subscription",
            "name": "Netflix",
            "provider": "Netflix",
            "amount": 649_00,
            "frequency": "monthly",
            "next_due_date": str(today + timedelta(3)),
        }
        post(client, f"{fin}/recurring-payments", ada, body)
        post(
            client,
            f"{fin}/recurring-payments",
            ada,
            {**body, "name": "Gym", "next_due_date": str(today), "amount": 1_500_00},
        )
        expected = ok(
            client.get(
                f"{fin}/payments",
                params={
                    "date_from": str(today),
                    "date_to": str(today + timedelta(7)),
                    "today": str(today),
                },
                headers=ada,
            )
        )

        content = briefing(client, ws, ada)["content"]
        payments = content["payments"]

        assert titles(payments["items"], "name") == ["Gym", "Netflix"]
        assert [(p["status"], p["severity"]) for p in payments["items"]] == [
            ("due", "warning"),
            ("upcoming", "info"),
        ]
        assert [p["amount"] for p in payments["items"]] == [1_500_00, 649_00]
        assert (payments["due_today"], payments["upcoming"], payments["overdue"]) == (1, 1, 0)
        # The same figures the commitments module reports.
        listed = {(p["name"], p["amount"], p["due_date"]) for p in payments["items"]}
        reported = {(p["name"], p["amount"], p["due_date"]) for p in expected["payments"]}
        assert listed <= reported
        # The payments' managed reminders, if any, aren't listed again.
        assert all(r["title"] not in ("Netflix", "Gym") for r in content["reminders"]["items"])
        assert content["summary"]["payments_due"] == 1

    def test_budget_status_matches_the_budgets_module(
        self, client: TestClient, ws: str, ada: Headers, fin: str
    ) -> None:
        today = today_in()
        bank = post(
            client, f"{fin}/accounts", ada, {"name": "Bank", "type": "bank", "opening_balance": 0}
        )["id"]
        post(
            client,
            f"{fin}/budgets",
            ada,
            {
                "name": "Everything",
                "scope": "overall",
                "amount": 1_000_00,
                "start_date": today.replace(day=1).isoformat(),
            },
        )
        post(
            client,
            f"{fin}/transactions",
            ada,
            {
                "type": "expense",
                "amount": 1_200_00,
                "account_id": bank,
                "occurred_on": today.isoformat(),
                "description": "Groceries",
            },
        )
        module = ok(client.get(f"{fin}/budgets", headers=ada))["budgets"][0]["current_period"]

        content = briefing(client, ws, ada)["content"]

        (budget,) = content["budgets"]["items"]
        assert (budget["available"], budget["spent"], budget["remaining"]) == (
            module["available"],
            module["spent"],
            module["remaining"],
        )
        assert (budget["status"], budget["severity"]) == ("exceeded", "critical")
        assert budget["utilization_bps"] == 12_000
        assert content["budgets"]["exceeded"] == 1
        assert content["summary"]["attention"][0] == {
            "key": budget["ref"]["key"],
            "module": "budgets",
            "title": "Everything",
            "severity": "critical",
        }


class TestHabits:
    def test_only_habits_due_today_are_listed_with_their_state_and_streak(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_in()
        habits = f"{ws}/habits"
        start = str(today - timedelta(days=2))

        def habit(name: str, schedule: Json) -> Json:
            body = {"name": name, "schedule": schedule, "start_date": start, "timezone": "UTC"}
            return post(client, habits, ada, body)

        read = habit("Read", {"type": "daily"})
        habit("Walk", {"type": "daily"})
        other_day = WEEKDAYS[(today.weekday() + 1) % 7]
        habit("Swim", {"type": "weekdays", "weekdays": [other_day]})
        for day in (today - timedelta(days=1), today):
            ok(client.put(f"{habits}/{read['habit']['id']}/log/{day}", json={}, headers=ada))

        section = briefing(client, ws, ada)["content"]["habits"]

        assert titles(section["habits"], "name") == ["Read", "Walk"]
        done, todo = section["habits"]
        assert (done["state"], done["done"], done["current_streak"]) == ("completed", True, 2)
        assert (todo["state"], todo["done"]) == ("pending", False)
        # Swim isn't due today, so it's neither listed nor missed.
        assert (section["remaining"], section["done"]) == (1, 1)


class TestNotes:
    def test_notes_linked_to_todays_items_and_pinned_notes(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_in()
        due = task(client, ws, ada, "Prepare slides", due_date=str(today))
        linked = post(client, f"{ws}/notes", ada, {"title": "Slide outline"})
        ok(client.put(f"{ws}/notes/{linked['id']}/tasks/{due['id']}", headers=ada))
        trashed = post(client, f"{ws}/notes", ada, {"title": "Old outline"})
        ok(client.put(f"{ws}/notes/{trashed['id']}/tasks/{due['id']}", headers=ada))
        ok(client.post(f"{ws}/notes/{trashed['id']}/trash", headers=ada))
        pinned = post(client, f"{ws}/notes", ada, {"title": "Packing list"})
        ok(
            client.patch(
                f"{ws}/notes/{pinned['id']}",
                json={"is_pinned": True, "expected_revision": 1},
                headers=ada,
            )
        )
        post(client, f"{ws}/notes", ada, {"title": "Unrelated", "text": "secret thoughts"})

        notes = briefing(client, ws, ada)["content"]["notes"]["items"]

        assert [(n["title"], n["reason"]) for n in notes] == [
            ("Slide outline", "linked"),
            ("Packing list", "pinned"),
        ]
        assert notes[0]["linked_to"] == [f"task:{due['id']}"]
        # Only references and titles are kept, never content.
        assert "text" not in notes[0] and "content" not in notes[0]


class TestPersistence:
    def test_the_briefing_is_kept_until_regenerated(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        first = briefing(client, ws, ada)
        task(client, ws, ada, "New", due_date=str(today_in()))

        again = briefing(client, ws, ada)
        assert (again["id"], again["revision"], again["generated_at"]) == (
            first["id"],
            1,
            first["generated_at"],
        )
        assert again["content"]["tasks"]["due_today"]["total"] == 0

        fresh = regenerate(client, ws, ada)
        assert (fresh["id"], fresh["revision"]) == (first["id"], 2)
        assert fresh["generated_at"] > first["generated_at"]
        assert fresh["created_at"] == first["created_at"]
        assert titles(fresh["content"]["tasks"]["due_today"]["items"]) == ["New"]
        # Reading it again gives the regenerated snapshot.
        assert briefing(client, ws, ada)["revision"] == 2

    def test_regenerating_without_a_briefing_prepares_one(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        assert regenerate(client, ws, ada)["revision"] == 1

    def test_history_and_retrieval_by_date(self, client: TestClient, ws: str, ada: Headers) -> None:
        assert ok(client.get(f"{ws}/briefings", headers=ada)) == {"items": [], "total": 0}
        task(client, ws, ada, "Late", due_date=str(today_in() - timedelta(2)))
        prepared = briefing(client, ws, ada)

        history = ok(client.get(f"{ws}/briefings", headers=ada))
        (listing,) = history["items"]
        assert history["total"] == 1
        assert (listing["id"], listing["date"], listing["status"]) == (
            prepared["id"],
            prepared["date"],
            "complete",
        )
        assert listing["summary"] == prepared["content"]["summary"]
        assert "content" not in listing

        stored = ok(client.get(f"{ws}/briefings/{prepared['date']}", headers=ada))
        assert stored == prepared
        missing = client.get(f"{ws}/briefings/2001-01-01", headers=ada)
        assert missing.status_code == 404
        assert ok(client.get(f"{ws}/briefings", params={"offset": 1}, headers=ada))["items"] == []

    def test_the_snapshot_keeps_no_descriptions(
        self, client: TestClient, ws: str, ada: Headers, migrated_settings: Settings
    ) -> None:
        task(client, ws, ada, "Pay", due_date=str(today_in()), description="account 1234-5678")

        body = briefing(client, ws, ada)

        assert "1234-5678" not in str(body)


class TestIsolation:
    def test_another_persons_workspace_is_not_found(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        briefing(client, ws, ada)
        day = today_in().isoformat()

        for method, path in (
            ("get", "/briefings/today"),
            ("get", "/briefings"),
            ("get", f"/briefings/{day}"),
            ("post", "/briefings/today/regenerate"),
        ):
            kwargs: Json = {"json": {}} if method == "post" else {}
            response = getattr(client, method)(f"{ws}{path}", headers=grace, **kwargs)
            assert response.status_code == 404, (path, response.text)

    def test_a_briefing_reads_only_its_own_workspace(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        task(client, ws, ada, "Ada's task", due_date=str(today_in()))
        theirs = personal(client, grace)

        body = briefing(client, theirs, grace)

        assert body["content"]["tasks"]["due_today"]["total"] == 0
        assert ok(client.get(f"{theirs}/briefings", headers=grace))["total"] == 1
        assert ok(client.get(f"{ws}/briefings", headers=ada))["total"] == 0

    def test_unknown_workspaces_look_like_other_peoples(
        self, client: TestClient, ada: Headers
    ) -> None:
        response = client.get(f"{WORKSPACES}/{uuid.uuid4()}/briefings/today", headers=ada)
        assert response.status_code == 404


class TestDocumentsShoppingInvestments:
    def test_documents_by_tracked_date_without_their_details(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_in()

        def document(title: str, **dates: Any) -> None:
            post(
                client,
                f"{ws}/documents",
                ada,
                {"title": title, "description": "policy no. 99-ABC", **dates},
            )

        document("Old visa", expiry_date=str(today - timedelta(2)))
        document("Passport", expiry_date=str(today + timedelta(3)))
        document("Licence", expiry_date=str(today + timedelta(20)))
        document("Insurance", renewal_date=str(today + timedelta(2)))
        document("Far away", expiry_date=str(today + timedelta(90)))

        body = briefing(client, ws, ada)
        section = body["content"]["documents"]

        assert [(d["title"], d["kind"], d["lapsed"], d["severity"]) for d in section["items"]] == [
            ("Old visa", "expiry", True, "warning"),
            ("Insurance", "renewal", False, "warning"),
            ("Passport", "expiry", False, "warning"),
            ("Licence", "expiry", False, "info"),
        ]
        assert (section["expired"], section["expiring"]) == (1, 2)
        assert "99-ABC" not in str(body)
        attention = {a["title"] for a in body["content"]["summary"]["attention"]}
        assert {"Old visa", "Passport", "Insurance"} <= attention

    def test_shopping_lists_with_items_to_buy(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        shop = f"{ws}/shopping"
        default = ok(client.get(f"{shop}/lists", headers=ada))["lists"][0]
        hardware = post(client, f"{shop}/lists", ada, {"name": "Hardware"})
        post(client, f"{shop}/lists", ada, {"name": "Empty"})
        for name in ("Milk", "Eggs"):
            post(client, f"{shop}/lists/{default['id']}/items", ada, {"name": name})
        for name in ("Nails", "Glue", "Tape"):
            post(client, f"{shop}/lists/{hardware['id']}/items", ada, {"name": name})

        section = briefing(client, ws, ada)["content"]["shopping"]

        # The default list first, then the fullest; empty lists are left out.
        assert [(entry["name"], entry["needed"]) for entry in section["lists"]] == [
            (default["name"], 2),
            ("Hardware", 3),
        ]
        assert section["needed"] == 5

    def test_sip_installments_and_deposit_maturities_from_the_investments_module(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        today = today_in()
        fin = f"{ws}/finance"
        bank = post(
            client,
            f"{fin}/accounts",
            ada,
            {"name": "Bank", "type": "bank", "opening_balance": 10_00_000_00},
        )
        funds = post(
            client,
            f"{fin}/investment-accounts",
            ada,
            {"name": "Coin", "kind": "mutual_fund", "provider": "Zerodha"},
        )
        fund = post(
            client,
            f"{fin}/holdings",
            ada,
            {"account_id": funds["account_id"], "kind": "mutual_fund", "name": "Nifty 50 Index"},
        )
        post(
            client,
            f"{fin}/sip-plans",
            ada,
            {
                "holding_id": fund["id"],
                "amount": 5_000_00,
                "next_due_date": str(today + timedelta(2)),
                "funding_account_id": bank["id"],
            },
        )
        deposits = post(
            client,
            f"{fin}/investment-accounts",
            ada,
            {"name": "SBI deposits", "kind": "deposit", "provider": "SBI"},
        )
        deposit = post(
            client,
            f"{fin}/deposits",
            ada,
            {
                "account_id": deposits["account_id"],
                "kind": "fixed",
                "name": "SBI FD",
                "institution": "SBI",
                "interest_rate_bps": 700,
                "compounding": "quarterly",
                "start_date": str(today - timedelta(360)),
                "maturity_date": str(today + timedelta(5)),
                "amount": 1_00_000_00,
                "cash_account_id": bank["id"],
                "reminder": {"days_before": 7, "timezone": "UTC"},
            },
        )

        content = briefing(client, ws, ada)["content"]
        section = content["investments"]

        (sip,) = section["sips"]
        assert (sip["holding_name"], sip["amount"], sip["due_date"]) == (
            "Nifty 50 Index",
            5_000_00,
            str(today + timedelta(2)),
        )
        (fd,) = section["deposits"]
        assert (fd["name"], fd["matured"], fd["maturity_date"]) == (
            "SBI FD",
            False,
            str(today + timedelta(5)),
        )
        # The investments module's own projection.
        assert fd["projected_maturity_amount"] == deposit["projected_maturity_amount"]
        # The deposit's maturity reminder isn't listed again under reminders.
        assert all(r["title"] != "SBI FD" for r in content["reminders"]["items"])


class TestTimeZones:
    def test_each_time_zone_has_its_own_briefing_for_a_date(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        # Both are UTC+0 all year, so they always share the local date.
        utc = briefing(client, ws, ada, "UTC")
        abidjan = briefing(client, ws, ada, "Africa/Abidjan")

        assert utc["date"] == abidjan["date"]
        assert utc["id"] != abidjan["id"]
        assert (abidjan["timezone"], abidjan["revision"]) == ("Africa/Abidjan", 1)
        # Each is kept: asking again returns the same one.
        assert briefing(client, ws, ada, "UTC")["id"] == utc["id"]
        history = ok(client.get(f"{ws}/briefings", headers=ada))
        assert history["total"] == 2
        assert {item["timezone"] for item in history["items"]} == {"UTC", "Africa/Abidjan"}

        # Regenerating one leaves the other alone.
        assert regenerate(client, ws, ada, "UTC")["revision"] == 2
        assert briefing(client, ws, ada, "Africa/Abidjan")["revision"] == 1

        day = utc["date"]
        chosen = ok(client.get(f"{ws}/briefings/{day}", params={"timezone": "UTC"}, headers=ada))
        assert chosen["id"] == utc["id"]
        # Without a time zone: the date's most recently prepared, the regenerated UTC one.
        assert ok(client.get(f"{ws}/briefings/{day}", headers=ada))["id"] == utc["id"]
        missing = client.get(
            f"{ws}/briefings/{day}", params={"timezone": "Asia/Tokyo"}, headers=ada
        )
        assert missing.status_code == 404
