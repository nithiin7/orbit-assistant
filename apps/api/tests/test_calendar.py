"""The calendar API: events, recurring series and their exceptions, ranges, the agenda, links to
tasks and notes, alerts through the reminder system, preferences, and workspace isolation.

Events are in 2030, so alerts are always ahead of the real clock the API uses.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.scheduler.worker import ReminderWorker
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"

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


@pytest.fixture
def cal(ws: str) -> str:
    return f"{ws}/calendar"


def create(client: TestClient, cal: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "title": "Standup",
        "start": "2030-01-14T09:00",
        "end": "2030-01-14T09:30",
        "timezone": "UTC",
        **fields,
    }
    response = client.post(f"{cal}/events", json=body, headers=headers)
    assert response.status_code == 201, response.text
    event: Json = response.json()
    return event


def view(
    client: TestClient, cal: str, headers: Headers, start: str, end: str, **params: Any
) -> Json:
    response = client.get(
        f"{cal}/range",
        params={"start": start, "end": end, "timezone": "UTC", **params},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    result: Json = response.json()
    return result


def starts(result: Json) -> list[str]:
    return [o["start"] for o in result["occurrences"]]


DAILY = {"frequency": "daily"}


class TestEvents:
    def test_create_get_and_list(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, description="Daily sync", location="Room 4")
        assert event["timezone"] == "UTC"
        assert event["start"] == "2030-01-14T09:00:00"
        assert event["alerts"] == [] and event["notes"] == [] and event["tasks"] == []
        assert event["next_occurrence"]["start_at"] == "2030-01-14T09:00:00Z"

        fetched = client.get(f"{cal}/events/{event['id']}", headers=ada).json()
        assert fetched["location"] == "Room 4"
        listed = client.get(f"{cal}/events", params={"q": "room 4"}, headers=ada).json()
        assert listed["total"] == 1 and listed["events"][0]["id"] == event["id"]
        assert (
            client.get(f"{cal}/events", params={"q": "nothing"}, headers=ada).json()["total"] == 0
        )

    def test_defaults_to_the_users_time_zone(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        client.patch("/api/v1/me", json={"timezone": "Asia/Kolkata"}, headers=ada)
        event = create(client, cal, ada, timezone=None)
        assert event["timezone"] == "Asia/Kolkata"
        # 09:00 in Kolkata is 03:30 UTC.
        assert event["next_occurrence"]["start_at"] == "2030-01-14T03:30:00Z"

    def test_update_move_resize_and_category(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        categories = client.get(f"{cal}/categories", headers=ada).json()["categories"]
        assert [c["name"] for c in categories] == [
            "Personal",
            "Work",
            "Meeting",
            "Appointment",
            "Birthday",
            "Travel",
            "Other",
        ]
        work = categories[1]["id"]
        event = create(client, cal, ada)
        response = client.patch(
            f"{cal}/events/{event['id']}",
            json={"start": "2030-01-15T13:00", "end": "2030-01-15T14:30", "category_id": work},
            headers=ada,
        )
        assert response.status_code == 200, response.text
        updated = response.json()
        assert (updated["start"], updated["end"], updated["category_id"]) == (
            "2030-01-15T13:00:00",
            "2030-01-15T14:30:00",
            work,
        )
        cleared = client.patch(
            f"{cal}/events/{event['id']}", json={"category_id": None}, headers=ada
        ).json()
        assert cleared["category_id"] is None

    def test_cancel_and_delete(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada)
        cancelled = client.patch(
            f"{cal}/events/{event['id']}", json={"status": "cancelled"}, headers=ada
        ).json()
        assert cancelled["status"] == "cancelled"
        shown = view(client, cal, ada, "2030-01-14", "2030-01-15")
        assert [o["status"] for o in shown["occurrences"]] == ["cancelled"]

        assert client.delete(f"{cal}/events/{event['id']}", headers=ada).status_code == 204
        assert client.get(f"{cal}/events/{event['id']}", headers=ada).status_code == 404
        assert view(client, cal, ada, "2030-01-14", "2030-01-15")["occurrences"] == []

    def test_duplicate(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, recurrence=DAILY, alerts=[10])
        response = client.post(f"{cal}/events/{event['id']}/duplicate", headers=ada)
        assert response.status_code == 201
        copy = response.json()
        assert copy["id"] != event["id"]
        assert (copy["recurrence"], copy["alerts"]) == (event["recurrence"], [10])

    def test_all_day_events(self, client: TestClient, cal: str, ada: Headers) -> None:
        trip = create(
            client,
            cal,
            ada,
            title="Trip",
            all_day=True,
            start="2030-03-01T00:00",
            end="2030-03-04T00:00",
            timezone="Pacific/Auckland",
        )

        # A viewer far west of Auckland still sees the trip on 1 to 3 March.
        def on(day: str, following: str) -> list[str]:
            response = client.get(
                f"{cal}/range",
                params={"start": day, "end": following, "timezone": "America/Los_Angeles"},
                headers=ada,
            )
            return [o["event_id"] for o in response.json()["occurrences"]]

        assert on("2030-02-28", "2030-03-01") == []
        assert on("2030-03-01", "2030-03-02") == [trip["id"]]
        assert on("2030-03-03", "2030-03-04") == [trip["id"]]
        assert on("2030-03-04", "2030-03-05") == []

    @pytest.mark.parametrize(
        ("fields", "message"),
        [
            ({"end": "2030-01-14T08:00"}, "before the start"),
            ({"all_day": True}, "midnight"),
            ({"start": "2030-01-14T09:00:30"}, "whole minute"),
            ({"start": "2030-01-14T09:00+01:00"}, "without an offset"),
            ({"timezone": "Mars/Olympus"}, "IANA"),
            ({"title": "  "}, "at least 1"),
            ({"recurrence": {"frequency": "weekly", "weekdays": ["tue"]}}, "weekday"),
            ({"recurrence": {"frequency": "daily", "count": 2, "until": "2030-02-01"}}, "not both"),
            ({"alerts": [0, 5, 10, 15, 30, 60]}, "at most 5"),
            ({"alerts": [50000]}, "less than or equal"),
            ({"workspace_id": str(uuid.uuid4())}, "Extra inputs"),
        ],
    )
    def test_validation(
        self, client: TestClient, cal: str, ada: Headers, fields: Json, message: str
    ) -> None:
        body = {
            "title": "Standup",
            "start": "2030-01-14T09:00",
            "end": "2030-01-14T09:30",
            **fields,
        }
        response = client.post(f"{cal}/events", json=body, headers=ada)
        assert response.status_code == 422, response.text
        assert message in response.text

    def test_rejects_unknown_category_note_and_task(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        for field, value in (
            ("category_id", str(uuid.uuid4())),
            ("note_ids", [str(uuid.uuid4())]),
            ("task_ids", [str(uuid.uuid4())]),
        ):
            body = {
                "title": "X",
                "start": "2030-01-14T09:00",
                "end": "2030-01-14T10:00",
                field: value,
            }
            response = client.post(f"{cal}/events", json=body, headers=ada)
            assert response.status_code == 422, field


class TestRecurrence:
    def test_range_expands_a_series(self, client: TestClient, cal: str, ada: Headers) -> None:
        create(client, cal, ada, recurrence={"frequency": "weekly", "weekdays": ["mon", "wed"]})
        result = view(client, cal, ada, "2030-01-13", "2030-01-20")
        assert starts(result) == ["2030-01-14T09:00:00", "2030-01-16T09:00:00"]
        assert all(o["recurring"] for o in result["occurrences"])

    def test_month_end_series(self, client: TestClient, cal: str, ada: Headers) -> None:
        create(
            client,
            cal,
            ada,
            title="Rent",
            start="2030-01-31T10:00",
            end="2030-01-31T10:15",
            recurrence={"frequency": "monthly"},
        )
        result = view(client, cal, ada, "2030-02-01", "2030-05-01")
        assert starts(result) == [
            "2030-02-28T10:00:00",
            "2030-03-31T10:00:00",
            "2030-04-30T10:00:00",
        ]

    def test_edit_one_occurrence(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, recurrence=DAILY)
        response = client.patch(
            f"{cal}/events/{event['id']}/occurrences/2030-01-15T09:00",
            json={"scope": "this", "title": "Planning", "start": "2030-01-15T11:00"},
            headers=ada,
        )
        assert response.status_code == 200, response.text
        result = view(client, cal, ada, "2030-01-14", "2030-01-17")
        assert [
            (o["title"], o["start"], o["end"], o["modified"]) for o in result["occurrences"]
        ] == [
            ("Standup", "2030-01-14T09:00:00", "2030-01-14T09:30:00", False),
            ("Planning", "2030-01-15T11:00:00", "2030-01-15T11:30:00", True),
            ("Standup", "2030-01-16T09:00:00", "2030-01-16T09:30:00", False),
        ]
        # Renaming the series keeps the occurrence's own title.
        client.patch(f"{cal}/events/{event['id']}", json={"title": "Daily"}, headers=ada)
        titles = [
            o["title"] for o in view(client, cal, ada, "2030-01-14", "2030-01-17")["occurrences"]
        ]
        assert titles == ["Daily", "Planning", "Daily"]

    def test_editing_the_same_occurrence_twice_never_duplicates_it(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        event = create(client, cal, ada, recurrence=DAILY)
        url = f"{cal}/events/{event['id']}/occurrences/2030-01-15T09:00"
        for start in ("2030-01-15T11:00", "2030-01-16T15:00"):
            assert client.patch(url, json={"start": start}, headers=ada).status_code == 200
        result = view(client, cal, ada, "2030-01-14", "2030-01-18")
        ids = [o["id"] for o in result["occurrences"]]
        assert len(ids) == len(set(ids)) == 4
        assert query(_db(client), "SELECT COUNT(*) FROM calendar_event_exceptions") == [(1,)]

    def test_skip_one_occurrence(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, recurrence=DAILY)
        # Browsers send the colon percent-encoded.
        response = client.delete(
            f"{cal}/events/{event['id']}/occurrences/2030-01-15T09%3A00", headers=ada
        )
        assert response.status_code == 204
        assert starts(view(client, cal, ada, "2030-01-14", "2030-01-17")) == [
            "2030-01-14T09:00:00",
            "2030-01-16T09:00:00",
        ]

    def test_cancel_one_occurrence(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, recurrence=DAILY)
        client.patch(
            f"{cal}/events/{event['id']}/occurrences/2030-01-15T09:00",
            json={"status": "cancelled"},
            headers=ada,
        )
        result = view(client, cal, ada, "2030-01-14", "2030-01-17")
        assert [o["status"] for o in result["occurrences"]] == [
            "confirmed",
            "cancelled",
            "confirmed",
        ]

    def test_unknown_occurrence(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, recurrence={"frequency": "weekly", "weekdays": ["mon"]})
        response = client.delete(
            f"{cal}/events/{event['id']}/occurrences/2030-01-15T09:00", headers=ada
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "Occurrence not found."}

    def test_edit_this_and_following(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, recurrence={"frequency": "daily", "count": 5}, alerts=[5])
        response = client.patch(
            f"{cal}/events/{event['id']}/occurrences/2030-01-16T09:00",
            json={"scope": "following", "start": "2030-01-16T10:00", "title": "Later standup"},
            headers=ada,
        )
        assert response.status_code == 200, response.text
        tail = response.json()
        assert tail["id"] != event["id"]
        assert tail["series_id"] == event["id"]
        assert tail["recurrence"]["count"] == 3
        assert tail["alerts"] == [5]
        result = view(client, cal, ada, "2030-01-13", "2030-01-25")
        assert [(o["title"], o["start"]) for o in result["occurrences"]] == [
            ("Standup", "2030-01-14T09:00:00"),
            ("Standup", "2030-01-15T09:00:00"),
            ("Later standup", "2030-01-16T10:00:00"),
            ("Later standup", "2030-01-17T10:00:00"),
            ("Later standup", "2030-01-18T10:00:00"),
        ]
        head = client.get(f"{cal}/events/{event['id']}", headers=ada).json()
        assert head["recurrence"]["until"] == "2030-01-15" and head["recurrence"]["count"] is None

    def test_delete_this_and_following(self, client: TestClient, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, recurrence=DAILY)
        client.delete(
            f"{cal}/events/{event['id']}/occurrences/2030-01-16T09:00",
            params={"scope": "following"},
            headers=ada,
        )
        assert starts(view(client, cal, ada, "2030-01-13", "2030-02-13")) == [
            "2030-01-14T09:00:00",
            "2030-01-15T09:00:00",
        ]

    def test_move_the_whole_series_from_an_occurrence(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        event = create(client, cal, ada, recurrence={"frequency": "weekly", "weekdays": ["mon"]})
        # Drag the 21st (a Monday) to Tuesday 22nd 10:00 for the whole series.
        response = client.patch(
            f"{cal}/events/{event['id']}/occurrences/2030-01-21T09:00",
            json={"scope": "series", "start": "2030-01-22T10:00", "end": "2030-01-22T11:00"},
            headers=ada,
        )
        assert response.status_code == 200, response.text
        moved = response.json()
        assert moved["start"] == "2030-01-15T10:00:00"
        assert moved["end"] == "2030-01-15T11:00:00"
        assert moved["recurrence"]["weekdays"] == ["tue"]

    def test_changing_series_timing_resets_exceptions(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        event = create(client, cal, ada, recurrence=DAILY)
        client.delete(f"{cal}/events/{event['id']}/occurrences/2030-01-15T09:00", headers=ada)
        client.patch(
            f"{cal}/events/{event['id']}",
            json={"start": "2030-01-14T08:00", "end": "2030-01-14T08:30"},
            headers=ada,
        )
        assert starts(view(client, cal, ada, "2030-01-14", "2030-01-17")) == [
            "2030-01-14T08:00:00",
            "2030-01-15T08:00:00",
            "2030-01-16T08:00:00",
        ]

    def test_series_keeps_local_time_across_dst(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        create(
            client,
            cal,
            ada,
            start="2030-03-29T09:00",
            end="2030-03-29T10:00",
            timezone="Europe/Paris",
            recurrence=DAILY,
        )
        # Paris moves to summer time on 31 March 2030.
        result = view(client, cal, ada, "2030-03-30", "2030-04-02")
        assert [o["start_at"] for o in result["occurrences"]] == [
            "2030-03-30T08:00:00Z",
            "2030-03-31T07:00:00Z",
            "2030-04-01T07:00:00Z",
        ]


class TestTasks:
    def test_scheduling_a_task(self, client: TestClient, ws: str, cal: str, ada: Headers) -> None:
        task = client.post(f"{ws}/tasks", json={"title": "Write report"}, headers=ada).json()
        assert task["scheduled_start"] is None
        unscheduled = client.get(f"{ws}/tasks", params={"scheduled": "false"}, headers=ada).json()
        assert [t["id"] for t in unscheduled["tasks"]] == [task["id"]]

        response = client.patch(
            f"{ws}/tasks/{task['id']}",
            json={
                "scheduled_start": "2030-01-14T13:00:00Z",
                "scheduled_end": "2030-01-14T15:00:00Z",
            },
            headers=ada,
        )
        assert response.status_code == 200, response.text
        assert response.json()["scheduled_start"] == "2030-01-14T13:00:00Z"
        result = view(client, cal, ada, "2030-01-14", "2030-01-15")
        assert [t["id"] for t in result["scheduled_tasks"]] == [task["id"]]
        assert (
            client.get(f"{ws}/tasks", params={"scheduled": "false"}, headers=ada).json()["total"]
            == 0
        )

        client.post(f"{ws}/tasks/{task['id']}/complete", headers=ada)
        shown = view(client, cal, ada, "2030-01-14", "2030-01-15")
        assert shown["scheduled_tasks"][0]["status"] == "completed"
        hidden = view(client, cal, ada, "2030-01-14", "2030-01-15", include_completed_tasks=False)
        assert hidden["scheduled_tasks"] == []

        cleared = client.patch(
            f"{ws}/tasks/{task['id']}",
            json={"scheduled_start": None, "scheduled_end": None},
            headers=ada,
        ).json()
        assert cleared["scheduled_start"] is None and cleared["scheduled_end"] is None

    @pytest.mark.parametrize(
        "body",
        [
            {"scheduled_start": "2030-01-14T13:00:00Z"},
            {"scheduled_start": "2030-01-14T13:00:00Z", "scheduled_end": "2030-01-14T12:00:00Z"},
            {"scheduled_start": "2030-01-14T13:00:00Z", "scheduled_end": "2030-01-24T12:00:00Z"},
            {"scheduled_start": "2030-01-14T13:00:00", "scheduled_end": "2030-01-14T14:00:00"},
        ],
    )
    def test_rejects_bad_schedules(
        self, client: TestClient, ws: str, ada: Headers, body: Json
    ) -> None:
        task = client.post(f"{ws}/tasks", json={"title": "Task"}, headers=ada).json()
        assert client.patch(f"{ws}/tasks/{task['id']}", json=body, headers=ada).status_code == 422

    def test_due_tasks_show_on_their_date(
        self, client: TestClient, ws: str, cal: str, ada: Headers
    ) -> None:
        task = client.post(
            f"{ws}/tasks", json={"title": "Pay rent", "due_date": "2030-01-15"}, headers=ada
        ).json()
        result = view(client, cal, ada, "2030-01-15", "2030-01-16")
        assert [t["id"] for t in result["due_tasks"]] == [task["id"]]
        assert view(client, cal, ada, "2030-01-16", "2030-01-17")["due_tasks"] == []

    def test_linking_tasks_to_events(
        self, client: TestClient, ws: str, cal: str, ada: Headers
    ) -> None:
        task = client.post(f"{ws}/tasks", json={"title": "Prep slides"}, headers=ada).json()
        event = create(client, cal, ada, task_ids=[task["id"]])
        assert [t["id"] for t in event["tasks"]] == [task["id"]]
        url = f"{cal}/events/{event['id']}/tasks/{task['id']}"
        assert client.delete(url, headers=ada).status_code == 204
        assert client.put(url, headers=ada).status_code == 204
        assert client.put(url, headers=ada).status_code == 204  # Idempotent.
        # Deleting the task removes the link, not the event.
        client.delete(f"{ws}/tasks/{task['id']}", headers=ada)
        assert client.get(f"{cal}/events/{event['id']}", headers=ada).json()["tasks"] == []


class TestNotes:
    def test_meeting_notes(self, client: TestClient, ws: str, cal: str, ada: Headers) -> None:
        event = create(client, cal, ada, title="Design review", recurrence=DAILY)
        response = client.post(
            f"{cal}/events/{event['id']}/notes",
            json={"occurrence_start": "2030-01-16T09:00"},
            headers=ada,
        )
        assert response.status_code == 201, response.text
        note = response.json()
        assert note["title"] == "Design review · 16 Jan 2030"
        assert client.get(f"{ws}/notes/{note['id']}", headers=ada).status_code == 200

        # Renaming the event keeps the link; the note's own title is unchanged.
        client.patch(f"{cal}/events/{event['id']}", json={"title": "Product review"}, headers=ada)
        notes = client.get(f"{cal}/events/{event['id']}", headers=ada).json()["notes"]
        assert [(n["id"], n["title"]) for n in notes] == [
            (note["id"], "Design review · 16 Jan 2030")
        ]

    def test_link_existing_note(self, client: TestClient, ws: str, cal: str, ada: Headers) -> None:
        note = client.post(f"{ws}/notes", json={"title": "Agenda"}, headers=ada).json()
        event = create(client, cal, ada)
        url = f"{cal}/events/{event['id']}/notes/{note['id']}"
        assert client.put(url, headers=ada).status_code == 204
        assert [
            n["id"] for n in client.get(f"{cal}/events/{event['id']}", headers=ada).json()["notes"]
        ] == [note["id"]]
        assert client.delete(url, headers=ada).status_code == 204
        assert client.get(f"{cal}/events/{event['id']}", headers=ada).json()["notes"] == []
        missing = client.put(f"{cal}/events/{event['id']}/notes/{uuid.uuid4()}", headers=ada)
        assert missing.status_code == 422


def _db(client: TestClient) -> Any:
    app: Any = client.app
    return app.state.settings.sqlite_path


def managed_reminders(client: TestClient, ws: str, ada: Headers) -> list[Json]:
    reminders: list[Json] = client.get(f"{ws}/reminders", headers=ada).json()["reminders"]
    return [r for r in reminders if r["commitment"] and r["commitment"]["kind"] == "calendar_alert"]


class TestAlerts:
    def test_alerts_become_managed_reminders(
        self, client: TestClient, ws: str, cal: str, ada: Headers
    ) -> None:
        event = create(client, cal, ada, alerts=[15, 60])
        reminders = managed_reminders(client, ws, ada)
        assert sorted(r["next_occurrence_at"] for r in reminders) == [
            "2030-01-14T08:00:00Z",
            "2030-01-14T08:45:00Z",
        ]
        assert {r["title"] for r in reminders} == {"Standup"}
        # The reminders API refuses to change them.
        managed = reminders[0]["id"]
        assert (
            client.patch(f"{ws}/reminders/{managed}", json={"title": "X"}, headers=ada).status_code
            == 409
        )
        assert client.delete(f"{ws}/reminders/{managed}", headers=ada).status_code == 409

        # Moving the event re-points its alerts.
        client.patch(
            f"{cal}/events/{event['id']}",
            json={"start": "2030-02-01T10:00", "end": "2030-02-01T11:00", "alerts": [5]},
            headers=ada,
        )
        assert [r["next_occurrence_at"] for r in managed_reminders(client, ws, ada)] == [
            "2030-02-01T09:55:00Z"
        ]

    def test_cancel_and_delete_remove_alerts(
        self, client: TestClient, ws: str, cal: str, ada: Headers
    ) -> None:
        event = create(client, cal, ada, alerts=[10])
        client.patch(f"{cal}/events/{event['id']}", json={"status": "cancelled"}, headers=ada)
        assert managed_reminders(client, ws, ada) == []
        client.patch(f"{cal}/events/{event['id']}", json={"status": "confirmed"}, headers=ada)
        assert len(managed_reminders(client, ws, ada)) == 1
        client.delete(f"{cal}/events/{event['id']}", headers=ada)
        assert managed_reminders(client, ws, ada) == []
        assert query(_db(client), "SELECT COUNT(*) FROM reminder_occurrences") == [(0,)]

    def test_recurring_alerts_skip_skipped_occurrences(
        self, client: TestClient, ws: str, cal: str, ada: Headers
    ) -> None:
        event = create(client, cal, ada, recurrence=DAILY, alerts=[0])
        assert [r["next_occurrence_at"] for r in managed_reminders(client, ws, ada)] == [
            "2030-01-14T09:00:00Z"
        ]
        client.delete(f"{cal}/events/{event['id']}/occurrences/2030-01-14T09:00", headers=ada)
        assert [r["next_occurrence_at"] for r in managed_reminders(client, ws, ada)] == [
            "2030-01-15T09:00:00Z"
        ]
        client.patch(
            f"{cal}/events/{event['id']}/occurrences/2030-01-15T09:00",
            json={"start": "2030-01-15T07:00", "end": "2030-01-15T07:30"},
            headers=ada,
        )
        assert [r["next_occurrence_at"] for r in managed_reminders(client, ws, ada)] == [
            "2030-01-15T07:00:00Z"
        ]


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
async def test_worker_delivers_an_alert_and_moves_to_the_next_occurrence(
    client: TestClient, ws: str, cal: str, ada: Headers, database: Database
) -> None:
    create(client, cal, ada, recurrence=DAILY, alerts=[15])
    clock = Clock(datetime(2030, 1, 14, 8, 45, 30, tzinfo=UTC))
    worker = ReminderWorker(database, clock=clock)

    report = await worker.run_once()
    assert report.results["delivered"] == 1
    inbox = client.get("/api/v1/me/notifications", headers=ada).json()
    assert [n["title"] for n in inbox["notifications"]] == ["Standup"]
    assert "09:00 to 09:30 (UTC)" in inbox["notifications"][0]["body"]
    assert [r["next_occurrence_at"] for r in managed_reminders(client, ws, ada)] == [
        "2030-01-15T08:45:00Z"
    ]

    # Running again delivers nothing new: no duplicate notifications.
    assert (await worker.run_once()).claimed == 0
    clock.now += timedelta(days=1)
    assert (await worker.run_once()).results["delivered"] == 1
    assert client.get("/api/v1/me/notifications", headers=ada).json()["total"] == 2


class TestViews:
    def test_range_limits(self, client: TestClient, cal: str, ada: Headers) -> None:
        params = {"start": "2030-01-01", "end": "2030-06-01"}
        assert client.get(f"{cal}/range", params=params, headers=ada).status_code == 422
        params = {"start": "2030-01-02", "end": "2030-01-01"}
        assert client.get(f"{cal}/range", params=params, headers=ada).status_code == 422

    def test_day_boundaries_follow_the_viewer(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        # 23:30 UTC on the 14th is the 15th in Tokyo.
        create(client, cal, ada, start="2030-01-14T23:30", end="2030-01-14T23:45")

        def count(timezone: str, day: str, following: str) -> int:
            response = client.get(
                f"{cal}/range",
                params={"start": day, "end": following, "timezone": timezone},
                headers=ada,
            )
            return len(response.json()["occurrences"])

        assert count("UTC", "2030-01-14", "2030-01-15") == 1
        assert count("Asia/Tokyo", "2030-01-14", "2030-01-15") == 0
        assert count("Asia/Tokyo", "2030-01-15", "2030-01-16") == 1

    def test_hidden_categories(self, client: TestClient, cal: str, ada: Headers) -> None:
        work = client.get(f"{cal}/categories", headers=ada).json()["categories"][1]
        create(client, cal, ada, category_id=work["id"])
        client.patch(f"{cal}/categories/{work['id']}", json={"is_visible": False}, headers=ada)
        assert view(client, cal, ada, "2030-01-14", "2030-01-15")["occurrences"] == []

    def test_agenda_pages(self, client: TestClient, ws: str, cal: str, ada: Headers) -> None:
        create(client, cal, ada, recurrence={"frequency": "daily", "count": 5})
        task = client.post(
            f"{ws}/tasks",
            json={
                "title": "Focus",
                "scheduled_start": "2030-01-15T12:00:00Z",
                "scheduled_end": "2030-01-15T13:00:00Z",
            },
            headers=ada,
        ).json()
        params: dict[str, Any] = {"start": "2030-01-14T00:00:00Z", "limit": 4}
        first = client.get(f"{cal}/agenda", params=params, headers=ada).json()
        assert [(i["kind"], i["start_at"]) for i in first["items"]] == [
            ("event", "2030-01-14T09:00:00Z"),
            ("event", "2030-01-15T09:00:00Z"),
            ("task", "2030-01-15T12:00:00Z"),
            ("event", "2030-01-16T09:00:00Z"),
        ]
        assert first["items"][2]["task"]["id"] == task["id"]
        second = client.get(
            f"{cal}/agenda", params={**params, "cursor": first["next_cursor"]}, headers=ada
        ).json()
        assert [i["start_at"] for i in second["items"]] == [
            "2030-01-17T09:00:00Z",
            "2030-01-18T09:00:00Z",
        ]
        assert second["next_cursor"] is None
        bad = client.get(f"{cal}/agenda", params={"cursor": "nonsense"}, headers=ada)
        assert bad.status_code == 422


class TestCategories:
    def test_create_rename_conflict_and_delete(
        self, client: TestClient, cal: str, ada: Headers
    ) -> None:
        created = client.post(
            f"{cal}/categories", json={"name": "Gym", "color": "orange"}, headers=ada
        )
        assert created.status_code == 201
        gym = created.json()
        duplicate = client.post(f"{cal}/categories", json={"name": " gym "}, headers=ada)
        assert duplicate.status_code == 409
        renamed = client.patch(f"{cal}/categories/{gym['id']}", json={"name": "Work"}, headers=ada)
        assert renamed.status_code == 409
        bad_color = client.post(
            f"{cal}/categories", json={"name": "X", "color": "red;"}, headers=ada
        )
        assert bad_color.status_code == 422

        event = create(client, cal, ada, category_id=gym["id"])
        assert client.delete(f"{cal}/categories/{gym['id']}", headers=ada).status_code == 204
        assert client.get(f"{cal}/events/{event['id']}", headers=ada).json()["category_id"] is None
        assert client.delete(f"{cal}/categories/{gym['id']}", headers=ada).status_code == 404


class TestPreferences:
    def test_defaults_then_saved(self, client: TestClient, ada: Headers) -> None:
        url = "/api/v1/me/calendar-preferences"
        defaults = client.get(url, headers=ada).json()
        assert defaults["default_view"] == "month" and defaults["updated_at"] is None
        body = {
            "default_view": "week",
            "week_start": 1,
            "working_hours_start": "08:00",
            "working_hours_end": "18:00",
            "show_completed_tasks": False,
            "show_unscheduled_tasks": True,
            "show_due_tasks": True,
        }
        saved = client.put(url, json=body, headers=ada)
        assert saved.status_code == 200, saved.text
        assert client.get(url, headers=ada).json()["week_start"] == 1
        bad = client.put(url, json={**body, "working_hours_end": "07:00"}, headers=ada)
        assert bad.status_code == 422


class TestIsolation:
    def test_other_users_cannot_reach_events(
        self, client: TestClient, ws: str, cal: str, ada: Headers, grace: Headers
    ) -> None:
        event = create(client, cal, ada)
        # Grace using Ada's workspace URL.
        assert client.get(f"{cal}/events/{event['id']}", headers=grace).status_code == 404
        assert (
            client.get(
                f"{cal}/range", params={"start": "2030-01-14", "end": "2030-01-15"}, headers=grace
            ).status_code
            == 404
        )
        # Grace's own workspace doesn't contain Ada's event.
        theirs = f"{personal(client, grace)}/calendar"
        assert client.get(f"{theirs}/events/{event['id']}", headers=grace).status_code == 404
        assert (
            client.patch(
                f"{theirs}/events/{event['id']}", json={"title": "X"}, headers=grace
            ).status_code
            == 404
        )
        assert client.delete(f"{theirs}/events/{event['id']}", headers=grace).status_code == 404
        assert view(client, theirs, grace, "2030-01-14", "2030-01-15")["occurrences"] == []

    def test_cannot_link_another_workspaces_task_note_or_category(
        self, client: TestClient, cal: str, ada: Headers, grace: Headers
    ) -> None:
        theirs = personal(client, grace)
        task = client.post(f"{theirs}/tasks", json={"title": "Theirs"}, headers=grace).json()
        note = client.post(f"{theirs}/notes", json={"title": "Theirs"}, headers=grace).json()
        category = client.get(f"{theirs}/calendar/categories", headers=grace).json()["categories"][
            0
        ]
        event = create(client, cal, ada)
        assert (
            client.put(f"{cal}/events/{event['id']}/tasks/{task['id']}", headers=ada).status_code
            == 422
        )
        assert (
            client.put(f"{cal}/events/{event['id']}/notes/{note['id']}", headers=ada).status_code
            == 422
        )
        response = client.patch(
            f"{cal}/events/{event['id']}", json={"category_id": category["id"]}, headers=ada
        )
        assert response.status_code == 422
