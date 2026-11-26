from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"

Headers = dict[str, str]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
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
    return f"{WORKSPACES}/{workspace['id']}"


def create_task(client: TestClient, headers: Headers, title: str = "Write the report") -> str:
    response = client.post(
        f"{workspace_url(client, headers)}/tasks", json={"title": title}, headers=headers
    )
    assert response.status_code == 201, response.text
    task_id: str = response.json()["id"]
    return task_id


def session(minutes: int = 25, *, ago: timedelta = timedelta(0), **fields: Any) -> dict[str, Any]:
    ended = datetime.now(UTC) - ago
    started = ended - timedelta(minutes=minutes)
    return {
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "focused_seconds": minutes * 60,
        "day": started.date().isoformat(),
        "completed": True,
        **fields,
    }


def record(client: TestClient, headers: Headers, task_id: str, body: dict[str, Any]) -> Any:
    return client.post(
        f"{workspace_url(client, headers)}/tasks/{task_id}/focus-sessions",
        json=body,
        headers=headers,
    )


def test_records_a_session_and_sums_it_per_task(client: TestClient, ada: Headers) -> None:
    report = create_task(client, ada)
    slides = create_task(client, ada, "Make the slides")

    response = record(client, ada, report, session(25))
    assert response.status_code == 201, response.text
    assert response.json()["task_id"] == report
    assert response.json()["focused_seconds"] == 1500
    assert record(client, ada, report, session(10, completed=False)).status_code == 201
    assert record(client, ada, slides, session(5)).status_code == 201

    today = datetime.now(UTC).date().isoformat()
    summary = client.get(
        f"{workspace_url(client, ada)}/focus/summary", params={"today": today}, headers=ada
    ).json()
    assert summary["today_seconds"] == 40 * 60
    assert summary["today_sessions"] == 3
    assert summary["tasks"] == [
        {"task_id": report, "focused_seconds": 35 * 60, "sessions": 2},
        {"task_id": slides, "focused_seconds": 5 * 60, "sessions": 1},
    ]


def test_summary_counts_only_the_given_day_as_today(client: TestClient, ada: Headers) -> None:
    task = create_task(client, ada)
    assert record(client, ada, task, session(25)).status_code == 201

    tomorrow = (datetime.now(UTC).date() + timedelta(days=2)).isoformat()
    summary = client.get(
        f"{workspace_url(client, ada)}/focus/summary", params={"today": tomorrow}, headers=ada
    ).json()
    assert summary["today_seconds"] == 0
    assert summary["today_sessions"] == 0
    assert summary["tasks"][0]["focused_seconds"] == 1500


def test_pauses_may_shorten_focus_time(client: TestClient, ada: Headers) -> None:
    task = create_task(client, ada)
    response = record(client, ada, task, session(30, focused_seconds=20 * 60))
    assert response.status_code == 201, response.text


@pytest.mark.parametrize(
    "fields",
    [
        pytest.param({"focused_seconds": 30}, id="under a minute"),
        pytest.param({"focused_seconds": 5 * 60 * 60}, id="over four hours"),
        pytest.param({"focused_seconds": 26 * 60}, id="longer than the session"),
        pytest.param({"day": "2001-01-01"}, id="day far from the start"),
        pytest.param({"ended_at": "2026-01-01T10:00:00"}, id="naive time"),
        pytest.param({"extra": True}, id="unknown field"),
    ],
)
def test_rejects_sessions_that_dont_add_up(
    client: TestClient, ada: Headers, fields: dict[str, Any]
) -> None:
    task = create_task(client, ada)
    response = record(client, ada, task, session(25, **fields))
    assert response.status_code == 422


def test_rejects_sessions_in_the_future_or_long_ago(client: TestClient, ada: Headers) -> None:
    task = create_task(client, ada)
    assert record(client, ada, task, session(25, ago=-timedelta(hours=1))).status_code == 422
    assert record(client, ada, task, session(25, ago=timedelta(days=3))).status_code == 422


def test_rejects_a_session_that_ends_before_it_starts(client: TestClient, ada: Headers) -> None:
    task = create_task(client, ada)
    body = session(25)
    body["started_at"], body["ended_at"] = body["ended_at"], body["started_at"]
    assert record(client, ada, task, body).status_code == 422


def test_unknown_and_other_peoples_tasks_look_the_same(
    client: TestClient, ada: Headers, grace: Headers
) -> None:
    graces_task = create_task(client, grace)
    url = f"{workspace_url(client, ada)}/tasks/{graces_task}/focus-sessions"

    assert client.post(url, json=session(), headers=ada).status_code == 404
    missing = f"{workspace_url(client, ada)}/tasks/00000000-0000-0000-0000-000000000000"
    assert client.post(f"{missing}/focus-sessions", json=session(), headers=ada).status_code == 404
    graces_url = f"{workspace_url(client, grace)}/tasks/{graces_task}/focus-sessions"
    assert client.post(graces_url, json=session(), headers=ada).status_code == 404


def test_deleting_a_task_deletes_its_sessions(client: TestClient, ada: Headers) -> None:
    task = create_task(client, ada)
    assert record(client, ada, task, session(25)).status_code == 201

    assert (
        client.delete(f"{workspace_url(client, ada)}/tasks/{task}", headers=ada).status_code == 204
    )
    summary = client.get(f"{workspace_url(client, ada)}/focus/summary", headers=ada).json()
    assert summary["tasks"] == []


def test_finished_sessions_unlock_focus_achievements(client: TestClient, ada: Headers) -> None:
    task = create_task(client, ada)
    # A stopped session counts towards focus time, not finished sessions.
    assert record(client, ada, task, session(10, completed=False)).status_code == 201
    first = client.post("/api/v1/me/achievements/check", headers=ada).json()
    assert "first_focus" not in first["new_unlocks"]

    assert record(client, ada, task, session(25)).status_code == 201
    second = client.post("/api/v1/me/achievements/check", headers=ada).json()
    assert "first_focus" in second["new_unlocks"]
    progress = {item["key"]: item for item in second["achievements"]}
    assert progress["focus_hours_10"]["current"] == 35
    assert progress["focus_streak_7"]["current"] == 1
