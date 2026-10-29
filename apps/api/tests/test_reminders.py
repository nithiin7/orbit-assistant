"""Reminder API: CRUD, validation, task association, scheduling state, and isolation.

Reminders are created in 2030 so they are in the future whenever the tests run; delivery is
tested with a controllable clock in `test_reminder_worker.py`.
"""

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
DAY = "2030-01-15"
# 09:00 in Paris on DAY (UTC+1 in winter).
DAY_AT_NINE_PARIS = "2030-01-15T08:00:00Z"

Headers = dict[str, str]


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


def workspace_url(client: TestClient, headers: Headers) -> str:
    workspace: dict[str, Any] = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    assert workspace["is_personal"]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def home(client: TestClient, ada: Headers) -> str:
    """Ada's personal workspace."""
    return workspace_url(client, ada)


def create(client: TestClient, home: str, headers: Headers, **fields: Any) -> dict[str, Any]:
    body = {
        "title": "Reminder",
        "start_date": DAY,
        "time_of_day": "09:00",
        "timezone": "Europe/Paris",
        **fields,
    }
    response = client.post(f"{home}/reminders", json=body, headers=headers)
    assert response.status_code == 201, response.text
    reminder: dict[str, Any] = response.json()
    return reminder


def create_task(client: TestClient, home: str, headers: Headers, title: str = "Task") -> str:
    response = client.post(f"{home}/tasks", json={"title": title}, headers=headers)
    assert response.status_code == 201, response.text
    task_id: str = response.json()["id"]
    return task_id


def titles(client: TestClient, home: str, headers: Headers, **params: Any) -> list[str]:
    response = client.get(f"{home}/reminders", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [reminder["title"] for reminder in response.json()["reminders"]]


def get(client: TestClient, home: str, headers: Headers, reminder_id: str) -> dict[str, Any]:
    response = client.get(f"{home}/reminders/{reminder_id}", headers=headers)
    assert response.status_code == 200, response.text
    reminder: dict[str, Any] = response.json()
    return reminder


# Create and read


def test_create_one_time_reminder(client: TestClient, ada: Headers, home: str) -> None:
    reminder = create(client, home, ada, title="  Call the dentist ")

    assert reminder["title"] == "Call the dentist"
    assert reminder["description"] == ""
    assert reminder["task"] is None
    assert reminder["enabled"] is True
    assert reminder["start_date"] == DAY
    assert reminder["time_of_day"] == "09:00:00"
    assert reminder["timezone"] == "Europe/Paris"
    assert reminder["recurrence"] is None
    assert reminder["status"] == "scheduled"
    assert reminder["next_occurrence_at"] == DAY_AT_NINE_PARIS
    assert reminder["last_occurrence_at"] is None
    assert reminder["last_outcome"] is None
    assert reminder["created_at"] == reminder["updated_at"]
    assert get(client, home, ada, reminder["id"]) == reminder


def test_create_recurring_reminder(client: TestClient, ada: Headers, home: str) -> None:
    # 2030-01-15 is a Tuesday, so the first Thursday is the 17th.
    reminder = create(
        client, home, ada, recurrence={"frequency": "weekly", "weekdays": ["thu", "mon"]}
    )

    assert reminder["recurrence"] == {"frequency": "weekly", "weekdays": ["mon", "thu"]}
    assert reminder["next_occurrence_at"] == "2030-01-17T08:00:00Z"


def test_recurring_reminder_may_start_in_the_past(
    client: TestClient, ada: Headers, home: str
) -> None:
    reminder = create(client, home, ada, start_date="2020-01-01", recurrence={"frequency": "daily"})

    assert reminder["status"] == "scheduled"
    assert reminder["next_occurrence_at"] > "2026-01-01"


def test_one_time_reminder_in_the_past_is_rejected(
    client: TestClient, ada: Headers, home: str
) -> None:
    response = client.post(
        f"{home}/reminders",
        json={"title": "Too late", "start_date": "2020-01-01", "time_of_day": "09:00"},
        headers=ada,
    )

    assert response.status_code == 422
    assert "already passed" in response.json()["detail"]


def test_disabled_one_time_reminder_may_be_in_the_past(
    client: TestClient, ada: Headers, home: str
) -> None:
    reminder = create(client, home, ada, start_date="2020-01-01", enabled=False)

    assert reminder["status"] == "disabled"
    assert reminder["next_occurrence_at"] is None


def test_time_zone_defaults_to_the_users_preference(
    client: TestClient, ada: Headers, home: str
) -> None:
    without = create(client, home, ada, timezone=None)
    assert without["timezone"] == "UTC"
    assert without["next_occurrence_at"] == "2030-01-15T09:00:00Z"

    response = client.patch("/api/v1/me", json={"timezone": "Asia/Tokyo"}, headers=ada)
    assert response.status_code == 200
    assert response.json()["timezone"] == "Asia/Tokyo"

    with_preference = create(client, home, ada, timezone=None)
    assert with_preference["timezone"] == "Asia/Tokyo"
    assert with_preference["next_occurrence_at"] == "2030-01-15T00:00:00Z"


@pytest.mark.parametrize(
    "fields",
    [
        {"title": ""},
        {"title": "Line\nbreak"},
        {"title": "x" * 201},
        {"description": "x" * 2001},
        {"description": "Bell\x07"},
        {"start_date": "2030-02-30"},
        {"start_date": "1999-12-31"},
        {"start_date": "2201-01-01"},
        {"time_of_day": "25:00"},
        {"time_of_day": "09:00:30"},
        {"time_of_day": "09:00:00+01:00"},
        {"timezone": "Mars/Olympus_Mons"},
        {"timezone": "europe/paris"},
        {"timezone": "x" * 65},
        {"recurrence": {"frequency": "hourly"}},
        {"recurrence": {"frequency": "weekly"}},
        {"recurrence": {"frequency": "weekly", "weekdays": []}},
        {"recurrence": {"frequency": "weekly", "weekdays": ["mon", "mon"]}},
        {"recurrence": {"frequency": "weekly", "weekdays": ["funday"]}},
        {"recurrence": {"frequency": "daily", "weekdays": ["mon"]}},
        {"recurrence": {"frequency": "daily", "cron": "* * * * *"}},
        {"recurrence": "FREQ=DAILY"},
        {"task_id": "not-a-uuid"},
        {"workspace_id": str(uuid.uuid4())},
        {"status": "completed"},
        {"next_occurrence_at": "2030-01-01T00:00:00Z"},
    ],
)
def test_reminder_input_is_validated(
    client: TestClient, ada: Headers, home: str, fields: dict[str, Any]
) -> None:
    body = {"title": "R", "start_date": DAY, "time_of_day": "09:00", **fields}

    response = client.post(f"{home}/reminders", json=body, headers=ada)

    assert response.status_code == 422, response.text
    assert client.get(f"{home}/reminders", headers=ada).json()["total"] == 0


def test_required_fields(client: TestClient, ada: Headers, home: str) -> None:
    for missing in ("title", "start_date", "time_of_day"):
        body = {"title": "R", "start_date": DAY, "time_of_day": "09:00"}
        del body[missing]
        assert client.post(f"{home}/reminders", json=body, headers=ada).status_code == 422


# List and upcoming


def test_list_is_soonest_first_and_paged(client: TestClient, ada: Headers, home: str) -> None:
    create(client, home, ada, title="Later", start_date="2030-03-01")
    create(client, home, ada, title="Off", enabled=False)
    create(client, home, ada, title="Sooner", start_date="2030-02-01")

    assert titles(client, home, ada) == ["Sooner", "Later", "Off"]
    page = client.get(f"{home}/reminders", params={"limit": 1, "offset": 1}, headers=ada).json()
    assert [r["title"] for r in page["reminders"]] == ["Later"]
    assert page["total"] == 3


def test_list_filters_by_status_and_task(client: TestClient, ada: Headers, home: str) -> None:
    task_id = create_task(client, home, ada)
    create(client, home, ada, title="About the task", task_id=task_id)
    create(client, home, ada, title="Standalone")
    create(client, home, ada, title="Off", enabled=False)

    assert titles(client, home, ada, status="disabled") == ["Off"]
    assert sorted(titles(client, home, ada, status="scheduled")) == ["About the task", "Standalone"]
    assert titles(client, home, ada, task_id=task_id) == ["About the task"]
    assert titles(client, home, ada, status="overdue") == []
    response = client.get(f"{home}/reminders", params={"status": "late"}, headers=ada)
    assert response.status_code == 422


def test_upcoming_lists_active_reminders_soonest_first(
    client: TestClient, ada: Headers, home: str
) -> None:
    for day in ("2030-03-01", "2030-01-01", "2030-02-01"):
        create(client, home, ada, title=day, start_date=day)
    create(client, home, ada, title="Off", enabled=False)
    done = create_task(client, home, ada)
    create(client, home, ada, title="Done task", task_id=done)
    assert client.post(f"{home}/tasks/{done}/complete", headers=ada).status_code == 200

    response = client.get(f"{home}/reminders/upcoming", params={"limit": 2}, headers=ada)

    assert response.status_code == 200
    assert [r["title"] for r in response.json()["reminders"]] == ["2030-01-01", "2030-02-01"]
    everything = client.get(f"{home}/reminders/upcoming", params={"limit": 50}, headers=ada)
    assert len(everything.json()["reminders"]) == 3
    assert (
        client.get(f"{home}/reminders/upcoming", params={"limit": 51}, headers=ada).status_code
        == 422
    )


# Update, enable and disable, delete


def test_editing_text_keeps_the_schedule(client: TestClient, ada: Headers, home: str) -> None:
    reminder = create(client, home, ada)

    response = client.patch(
        f"{home}/reminders/{reminder['id']}",
        json={"title": "Renamed", "description": "Bring the forms."},
        headers=ada,
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["title"] == "Renamed"
    assert updated["description"] == "Bring the forms."
    assert updated["next_occurrence_at"] == reminder["next_occurrence_at"]
    assert updated["updated_at"] > reminder["updated_at"]


def test_changing_the_schedule_replaces_the_next_occurrence(
    client: TestClient, ada: Headers, home: str, migrated_settings: Settings
) -> None:
    reminder = create(client, home, ada)
    url = f"{home}/reminders/{reminder['id']}"

    moved = client.patch(url, json={"time_of_day": "17:30", "timezone": "UTC"}, headers=ada)
    assert moved.json()["next_occurrence_at"] == "2030-01-15T17:30:00Z"

    repeating = client.patch(url, json={"recurrence": {"frequency": "monthly"}}, headers=ada)
    assert repeating.json()["recurrence"] == {"frequency": "monthly", "weekdays": []}

    one_time = client.patch(url, json={"recurrence": None}, headers=ada)
    assert one_time.json()["recurrence"] is None
    # Only the latest schedule is pending; replaced occurrences are gone.
    assert pending(migrated_settings, reminder["id"]) == ["2030-01-15 17:30:00.000000"]


def test_disable_and_enable(
    client: TestClient, ada: Headers, home: str, migrated_settings: Settings
) -> None:
    reminder = create(client, home, ada)
    url = f"{home}/reminders/{reminder['id']}"

    disabled = client.patch(url, json={"enabled": False}, headers=ada).json()
    assert disabled["status"] == "disabled"
    assert disabled["next_occurrence_at"] is None
    assert pending(migrated_settings, reminder["id"]) == []

    enabled = client.patch(url, json={"enabled": True}, headers=ada).json()
    assert enabled["status"] == "scheduled"
    assert enabled["next_occurrence_at"] == DAY_AT_NINE_PARIS
    assert len(pending(migrated_settings, reminder["id"])) == 1


def test_a_past_one_time_reminder_cannot_be_re_enabled(
    client: TestClient, ada: Headers, home: str
) -> None:
    reminder = create(client, home, ada, start_date="2020-01-01", enabled=False)

    response = client.patch(
        f"{home}/reminders/{reminder['id']}", json={"enabled": True}, headers=ada
    )

    assert response.status_code == 422
    assert get(client, home, ada, reminder["id"])["enabled"] is False


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": None},
        {"enabled": None},
        {"start_date": None},
        {"time_of_day": None},
        {"timezone": None},
        {"timezone": "Nowhere/Special"},
        {"status": "disabled"},
    ],
)
def test_update_input_is_validated(
    client: TestClient, ada: Headers, home: str, body: dict[str, Any]
) -> None:
    reminder = create(client, home, ada)

    response = client.patch(f"{home}/reminders/{reminder['id']}", json=body, headers=ada)

    assert response.status_code == 422
    assert get(client, home, ada, reminder["id"]) == reminder


def test_update_that_changes_nothing_keeps_updated_at(
    client: TestClient, ada: Headers, home: str
) -> None:
    reminder = create(client, home, ada)

    response = client.patch(
        f"{home}/reminders/{reminder['id']}", json={"title": "Reminder"}, headers=ada
    )

    assert response.json() == reminder


def test_delete_reminder(
    client: TestClient, ada: Headers, home: str, migrated_settings: Settings
) -> None:
    reminder = create(client, home, ada)
    url = f"{home}/reminders/{reminder['id']}"

    assert client.delete(url, headers=ada).status_code == 204
    assert client.get(url, headers=ada).status_code == 404
    assert client.delete(url, headers=ada).status_code == 404
    assert query(migrated_settings.sqlite_path, "SELECT id FROM reminder_occurrences") == []


def test_unknown_reminder_is_not_found(client: TestClient, ada: Headers, home: str) -> None:
    url = f"{home}/reminders/{uuid.uuid4()}"

    assert client.get(url, headers=ada).status_code == 404
    assert client.patch(url, json={"title": "X"}, headers=ada).status_code == 404
    assert client.delete(url, headers=ada).status_code == 404
    assert client.get(f"{home}/reminders/not-a-uuid", headers=ada).status_code == 422


# Tasks


def test_reminder_about_a_task(client: TestClient, ada: Headers, home: str) -> None:
    task_id = create_task(client, home, ada, title="File taxes")

    reminder = create(client, home, ada, task_id=task_id)

    assert reminder["task"] == {"id": task_id, "title": "File taxes", "status": "open"}
    detached = client.patch(
        f"{home}/reminders/{reminder['id']}", json={"task_id": None}, headers=ada
    )
    assert detached.json()["task"] is None


def test_task_must_be_in_the_reminders_workspace(
    client: TestClient, ada: Headers, grace: Headers, home: str
) -> None:
    other = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()["id"]
    in_other_workspace = create_task(client, f"{WORKSPACES}/{other}", ada)
    graces_task = create_task(client, workspace_url(client, grace), grace)
    reminder = create(client, home, ada)

    for task_id in (in_other_workspace, graces_task, str(uuid.uuid4())):
        body = {"title": "R", "start_date": DAY, "time_of_day": "09:00", "task_id": task_id}
        created = client.post(f"{home}/reminders", json=body, headers=ada)
        assert created.status_code == 422
        assert created.json()["detail"] == "That task doesn't exist in this workspace."
        updated = client.patch(
            f"{home}/reminders/{reminder['id']}", json={"task_id": task_id}, headers=ada
        )
        assert updated.status_code == 422
    assert titles(client, home, ada) == ["Reminder"]


def test_completing_the_task_completes_its_reminders_until_reopened(
    client: TestClient, ada: Headers, home: str
) -> None:
    task_id = create_task(client, home, ada)
    reminder = create(client, home, ada, task_id=task_id, recurrence={"frequency": "daily"})

    client.post(f"{home}/tasks/{task_id}/complete", headers=ada)
    completed = get(client, home, ada, reminder["id"])
    assert completed["status"] == "completed"
    assert completed["task"]["status"] == "completed"
    # The schedule is kept, so reopening the task resumes it.
    assert completed["next_occurrence_at"] == reminder["next_occurrence_at"]

    client.post(f"{home}/tasks/{task_id}/reopen", headers=ada)
    assert get(client, home, ada, reminder["id"])["status"] == "scheduled"


def test_rescheduling_the_task_leaves_its_reminders(
    client: TestClient, ada: Headers, home: str
) -> None:
    task_id = create_task(client, home, ada)
    reminder = create(client, home, ada, task_id=task_id)

    response = client.patch(f"{home}/tasks/{task_id}", json={"due_date": "2030-06-01"}, headers=ada)

    assert response.status_code == 200
    assert get(client, home, ada, reminder["id"]) == reminder


def test_deleting_the_task_deletes_its_reminders(
    client: TestClient, ada: Headers, home: str, migrated_settings: Settings
) -> None:
    task_id = create_task(client, home, ada)
    about_task = create(client, home, ada, task_id=task_id)
    create(client, home, ada, title="Standalone")

    assert client.delete(f"{home}/tasks/{task_id}", headers=ada).status_code == 204

    assert client.get(f"{home}/reminders/{about_task['id']}", headers=ada).status_code == 404
    assert titles(client, home, ada) == ["Standalone"]
    assert len(query(migrated_settings.sqlite_path, "SELECT id FROM reminder_occurrences")) == 1


# Isolation


def test_reminders_are_private_to_their_workspace(
    client: TestClient, ada: Headers, grace: Headers, home: str
) -> None:
    reminder = create(client, home, ada, title="Secret")
    url = f"{home}/reminders/{reminder['id']}"
    graces_home = workspace_url(client, grace)

    for response in (
        client.get(f"{home}/reminders", headers=grace),
        client.get(f"{home}/reminders/upcoming", headers=grace),
        client.post(
            f"{home}/reminders",
            json={"title": "Planted", "start_date": DAY, "time_of_day": "09:00"},
            headers=grace,
        ),
        client.get(url, headers=grace),
        client.patch(url, json={"enabled": False}, headers=grace),
        client.delete(url, headers=grace),
        # Ada's reminder ID under Grace's own workspace.
        client.get(f"{graces_home}/reminders/{reminder['id']}", headers=grace),
        client.delete(f"{graces_home}/reminders/{reminder['id']}", headers=grace),
    ):
        assert response.status_code == 404, response.text

    assert titles(client, graces_home, grace) == []
    assert get(client, home, ada, reminder["id"]) == reminder
    assert client.get(f"{home}/reminders").status_code == 401


def test_deleting_a_workspace_deletes_its_reminders(
    client: TestClient, ada: Headers, migrated_settings: Settings
) -> None:
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()["id"]
    create(client, f"{WORKSPACES}/{lab}", ada)

    assert client.delete(f"{WORKSPACES}/{lab}", headers=ada).status_code == 204

    assert query(migrated_settings.sqlite_path, "SELECT id FROM reminders") == []
    assert query(migrated_settings.sqlite_path, "SELECT id FROM reminder_occurrences") == []


# Time zone preference


def test_time_zone_preference(client: TestClient, ada: Headers) -> None:
    assert client.get("/api/v1/me", headers=ada).json()["timezone"] is None

    for body in ({"timezone": "Not/AZone"}, {"timezone": ""}, {"display_name": None}, {}):
        assert client.patch("/api/v1/me", json=body, headers=ada).status_code == 422

    set_zone = client.patch("/api/v1/me", json={"timezone": "America/Chicago"}, headers=ada)
    assert set_zone.json()["timezone"] == "America/Chicago"
    rename = client.patch("/api/v1/me", json={"display_name": "Ada L."}, headers=ada)
    assert rename.json()["timezone"] == "America/Chicago"
    cleared = client.patch("/api/v1/me", json={"timezone": None}, headers=ada)
    assert cleared.json()["timezone"] is None
    assert cleared.json()["display_name"] == "Ada L."


def pending(settings: Settings, reminder_id: str) -> list[str]:
    rows = query(
        settings.sqlite_path,
        "SELECT scheduled_for FROM reminder_occurrences"
        " WHERE reminder_id = ? AND status = 'pending'",
        uuid.UUID(reminder_id).hex,
    )
    return [row[0] for row in rows]
