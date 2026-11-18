"""Repeating tasks: when the next occurrence falls due, and how completion hands it over."""

from collections.abc import Iterator
from datetime import date

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.tasks.models import (
    InvalidTaskRecurrenceError,
    TaskRecurrence,
    TaskRepeat,
    TaskRepeatFrequency,
)
from orbit_api.services.tasks.recurrence import (
    next_due_date,
    recurrence_from_json,
    recurrence_to_json,
)
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"
TODAY = "2026-03-10"

Headers = dict[str, str]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


def personal_id(client: TestClient, headers: Headers) -> str:
    workspaces = client.get(WORKSPACES, headers=headers).json()["workspaces"]
    return next(w["id"] for w in workspaces if w["is_personal"])


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


@pytest.fixture
def tasks_url(client: TestClient, ada: Headers) -> str:
    return f"{WORKSPACES}/{personal_id(client, ada)}/tasks"


def rule(frequency: TaskRepeatFrequency, anchor: date, interval: int = 1) -> TaskRecurrence:
    return TaskRecurrence(TaskRepeat(frequency, interval), anchor)


@pytest.mark.parametrize(
    ("recurrence", "due", "today", "expected"),
    [
        (rule("daily", date(2026, 3, 1)), date(2026, 3, 1), date(2026, 3, 1), date(2026, 3, 2)),
        (rule("weekly", date(2026, 3, 2)), date(2026, 3, 2), date(2026, 3, 2), date(2026, 3, 9)),
        (
            rule("weekly", date(2026, 3, 2), 2),
            date(2026, 3, 2),
            date(2026, 3, 2),
            date(2026, 3, 16),
        ),
        (rule("yearly", date(2026, 3, 2)), date(2026, 3, 2), date(2026, 3, 2), date(2027, 3, 2)),
        # Finished early: the next one stays a full period after the due date.
        (rule("weekly", date(2026, 3, 6)), date(2026, 3, 6), date(2026, 3, 4), date(2026, 3, 13)),
        # Finished late: missed occurrences are skipped.
        (rule("monthly", date(2026, 1, 1)), date(2026, 1, 1), date(2026, 3, 15), date(2026, 4, 1)),
        # Finished late, on a date in the series: the next is after today.
        (rule("daily", date(2026, 3, 1)), date(2026, 3, 1), date(2026, 3, 5), date(2026, 3, 6)),
        # Month ends clamp to shorter months and return to the anchor day.
        (
            rule("monthly", date(2026, 1, 31)),
            date(2026, 1, 31),
            date(2026, 1, 31),
            date(2026, 2, 28),
        ),
        (
            rule("monthly", date(2026, 1, 31)),
            date(2026, 2, 28),
            date(2026, 2, 28),
            date(2026, 3, 31),
        ),
        # Leap days fall on the last day of February in other years.
        (
            rule("yearly", date(2028, 2, 29)),
            date(2028, 2, 29),
            date(2028, 2, 29),
            date(2029, 2, 28),
        ),
    ],
)
def test_next_due_date(recurrence: TaskRecurrence, due: date, today: date, expected: date) -> None:
    assert next_due_date(recurrence, due, today) == expected


def test_stored_recurrence_round_trips() -> None:
    recurrence = rule("monthly", date(2026, 1, 31), 3)

    assert recurrence_from_json(recurrence_to_json(recurrence)) == recurrence
    assert recurrence_from_json(None) is None


@pytest.mark.parametrize(
    "stored",
    [
        "weekly",
        {"version": 2, "frequency": "daily", "interval": 1, "anchor": "2026-01-01"},
        {"version": 1, "frequency": "hourly", "interval": 1, "anchor": "2026-01-01"},
        {"version": 1, "frequency": "daily", "interval": 0, "anchor": "2026-01-01"},
        {"version": 1, "frequency": "daily", "interval": 1, "anchor": "soon"},
    ],
)
def test_malformed_stored_recurrence_is_rejected(stored: object) -> None:
    with pytest.raises(InvalidTaskRecurrenceError):
        recurrence_from_json(stored)


# Through the API


def repeating(
    client: TestClient, url: str, headers: Headers, frequency: str = "weekly", interval: int = 1
) -> dict[str, object]:
    response = client.post(
        url,
        headers=headers,
        json={
            "title": "Water the plants",
            "description": "The balcony too",
            "priority": "high",
            "due_date": TODAY,
            "recurrence": {"frequency": frequency, "interval": interval},
        },
    )
    assert response.status_code == 201
    return response.json()


def open_tasks(client: TestClient, url: str, headers: Headers) -> list[dict[str, object]]:
    return client.get(url, headers=headers, params={"status": "open"}).json()["tasks"]


def complete(client: TestClient, url: str, headers: Headers, task: dict[str, object]) -> None:
    response = client.post(f"{url}/{task['id']}/complete", headers=headers, params={"today": TODAY})
    assert response.status_code == 200


def test_completing_creates_the_next_occurrence(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada)
    assert task["recurrence"] == {"frequency": "weekly", "interval": 1}

    done = client.post(f"{tasks_url}/{task['id']}/complete", headers=ada, params={"today": TODAY})

    assert done.json()["status"] == "completed"
    assert done.json()["recurrence"] is None
    [following] = open_tasks(client, tasks_url, ada)
    assert following["id"] != task["id"]
    assert following["due_date"] == "2026-03-17"
    assert following["recurrence"] == {"frequency": "weekly", "interval": 1}
    assert (following["title"], following["description"], following["priority"]) == (
        "Water the plants",
        "The balcony too",
        "high",
    )


def test_completing_twice_creates_one_occurrence(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada)

    complete(client, tasks_url, ada, task)
    complete(client, tasks_url, ada, task)

    assert len(open_tasks(client, tasks_url, ada)) == 1


def test_the_next_occurrence_leaves_the_time_block_behind(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada)
    client.patch(
        f"{tasks_url}/{task['id']}",
        headers=ada,
        json={
            "scheduled_start": "2026-03-10T09:00:00Z",
            "scheduled_end": "2026-03-10T10:00:00Z",
        },
    )

    complete(client, tasks_url, ada, task)

    [following] = open_tasks(client, tasks_url, ada)
    assert (following["scheduled_start"], following["scheduled_end"]) == (None, None)


def test_undoing_a_completion_takes_the_next_occurrence_back(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada)
    complete(client, tasks_url, ada, task)

    reopened = client.post(f"{tasks_url}/{task['id']}/reopen", headers=ada).json()

    assert reopened["recurrence"] == {"frequency": "weekly", "interval": 1}
    assert [t["id"] for t in open_tasks(client, tasks_url, ada)] == [task["id"]]


def test_reopening_keeps_a_next_occurrence_that_was_edited(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada)
    complete(client, tasks_url, ada, task)
    [following] = open_tasks(client, tasks_url, ada)
    client.patch(f"{tasks_url}/{following['id']}", headers=ada, json={"title": "Water the ferns"})

    reopened = client.post(f"{tasks_url}/{task['id']}/reopen", headers=ada).json()

    assert reopened["recurrence"] is None
    remaining = {t["id"]: t["recurrence"] for t in open_tasks(client, tasks_url, ada)}
    assert remaining == {
        task["id"]: None,
        following["id"]: {"frequency": "weekly", "interval": 1},
    }


def test_reopening_an_older_occurrence_leaves_the_series_alone(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    first = repeating(client, tasks_url, ada)
    complete(client, tasks_url, ada, first)
    [second] = open_tasks(client, tasks_url, ada)
    complete(client, tasks_url, ada, second)
    [third] = open_tasks(client, tasks_url, ada)

    reopened = client.post(f"{tasks_url}/{first['id']}/reopen", headers=ada).json()

    assert reopened["recurrence"] is None
    assert {t["id"] for t in open_tasks(client, tasks_url, ada)} == {first["id"], third["id"]}


def test_a_task_can_start_and_stop_repeating(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    created = client.post(
        tasks_url, headers=ada, json={"title": "Backup", "due_date": TODAY}
    ).json()
    assert created["recurrence"] is None

    started = client.patch(
        f"{tasks_url}/{created['id']}",
        headers=ada,
        json={"recurrence": {"frequency": "monthly", "interval": 3}},
    )
    assert started.json()["recurrence"] == {"frequency": "monthly", "interval": 3}

    stopped = client.patch(f"{tasks_url}/{created['id']}", headers=ada, json={"recurrence": None})
    assert stopped.json()["recurrence"] is None

    complete(client, tasks_url, ada, created)
    assert open_tasks(client, tasks_url, ada) == []


def test_moving_the_due_date_restarts_the_series_there(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada, "monthly")
    client.patch(f"{tasks_url}/{task['id']}", headers=ada, json={"due_date": "2026-03-20"})

    complete(client, tasks_url, ada, task)

    assert open_tasks(client, tasks_url, ada)[0]["due_date"] == "2026-04-20"


def test_repeating_needs_a_due_date(client: TestClient, ada: Headers, tasks_url: str) -> None:
    rejected = client.post(
        tasks_url,
        headers=ada,
        json={"title": "No date", "recurrence": {"frequency": "daily"}},
    )
    assert rejected.status_code == 422
    assert rejected.json() == {"detail": "A repeating task needs a due date."}

    task = repeating(client, tasks_url, ada)
    cleared = client.patch(f"{tasks_url}/{task['id']}", headers=ada, json={"due_date": None})
    assert cleared.status_code == 422

    both = client.patch(
        f"{tasks_url}/{task['id']}", headers=ada, json={"due_date": None, "recurrence": None}
    )
    assert both.status_code == 200


def test_a_completed_task_cannot_start_repeating(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada)
    complete(client, tasks_url, ada, task)

    response = client.patch(
        f"{tasks_url}/{task['id']}", headers=ada, json={"recurrence": {"frequency": "daily"}}
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "recurrence",
    [
        {"frequency": "hourly"},
        {"frequency": "daily", "interval": 0},
        {"frequency": "daily", "interval": 100},
        {"frequency": "daily", "anchor": "2026-01-01"},
    ],
)
def test_invalid_repeats_are_rejected(
    client: TestClient, ada: Headers, tasks_url: str, recurrence: dict[str, object]
) -> None:
    response = client.post(
        tasks_url,
        headers=ada,
        json={"title": "Bad", "due_date": TODAY, "recurrence": recurrence},
    )

    assert response.status_code == 422


def test_another_person_cannot_complete_a_repeating_task(
    client: TestClient, ada: Headers, grace: Headers, tasks_url: str
) -> None:
    task = repeating(client, tasks_url, ada)
    grace_url = f"{WORKSPACES}/{personal_id(client, grace)}/tasks"

    foreign_task = client.post(f"{grace_url}/{task['id']}/complete", headers=grace)
    foreign_workspace = client.post(f"{tasks_url}/{task['id']}/complete", headers=grace)

    assert (foreign_task.status_code, foreign_task.json()) == (404, {"detail": "Task not found."})
    assert foreign_workspace.status_code == 404
    assert [t["id"] for t in open_tasks(client, tasks_url, ada)] == [task["id"]]
    assert client.get(grace_url, headers=grace).json()["total"] == 0
