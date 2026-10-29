import uuid
from collections.abc import Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"

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


def personal_id(client: TestClient, headers: Headers) -> str:
    workspace: dict[str, Any] = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    assert workspace["is_personal"]
    return workspace["id"]


@pytest.fixture
def tasks_url(client: TestClient, ada: Headers) -> str:
    """The task collection in Ada's personal workspace."""
    return f"{WORKSPACES}/{personal_id(client, ada)}/tasks"


def create(client: TestClient, url: str, headers: Headers, **fields: Any) -> dict[str, Any]:
    response = client.post(url, json={"title": "Task", **fields}, headers=headers)
    assert response.status_code == 201, response.text
    task: dict[str, Any] = response.json()
    return task


def titles(client: TestClient, url: str, headers: Headers, **params: Any) -> list[str]:
    response = client.get(url, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [task["title"] for task in response.json()["tasks"]]


# Create and read


def test_create_task_with_defaults(client: TestClient, ada: Headers, tasks_url: str) -> None:
    response = client.post(tasks_url, json={"title": "  Water the plants "}, headers=ada)

    assert response.status_code == 201
    task = response.json()
    assert task["title"] == "Water the plants"
    assert task["description"] == ""
    assert task["status"] == "open"
    assert task["priority"] == "none"
    assert task["due_date"] is None
    assert task["completed_at"] is None
    assert task["workspace_id"] == tasks_url.split("/")[-2]
    assert task["created_at"] == task["updated_at"]


def test_create_task_with_every_field(client: TestClient, ada: Headers, tasks_url: str) -> None:
    task = create(
        client,
        tasks_url,
        ada,
        title="File taxes",
        description="Forms are in the drawer.\n\tBring receipts.",
        priority="high",
        due_date="2026-11-15",
    )

    assert task["description"] == "Forms are in the drawer.\n\tBring receipts."
    assert task["priority"] == "high"
    assert task["due_date"] == "2026-11-15"
    fetched = client.get(f"{tasks_url}/{task['id']}", headers=ada)
    assert fetched.status_code == 200
    assert fetched.json() == task


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 201},
        {"title": "Tab\there"},
        {"title": "Line\nbreak"},
        {"title": "Task", "description": "x" * 5001},
        {"title": "Task", "description": "Bell\x07"},
        {"title": "Task", "priority": "urgent"},
        {"title": "Task", "priority": None},
        {"title": "Task", "due_date": "tomorrow"},
        {"title": "Task", "due_date": "2026-02-30"},
        {"title": "Task", "status": "completed"},
        {"title": "Task", "completed_at": "2026-10-29T12:00:00Z"},
        {"title": "Task", "workspace_id": "00000000-0000-0000-0000-000000000001"},
        {"title": "Task", "id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_task_input_is_validated(
    client: TestClient, ada: Headers, tasks_url: str, body: dict[str, Any]
) -> None:
    response = client.post(tasks_url, json=body, headers=ada)

    assert response.status_code == 422
    # Rejected values are never echoed back.
    assert all("input" not in error for error in response.json()["detail"])


def test_title_and_description_limits_are_inclusive(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = create(client, tasks_url, ada, title="x" * 200, description="y" * 5000)

    assert len(task["title"]) == 200
    assert len(task["description"]) == 5000


def test_titles_accept_emoji_sequences_and_non_breaking_spaces(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    title = "Family dinner \U0001f468\u200d\U0001f469\u200d\U0001f467 at\u00a07"

    assert create(client, tasks_url, ada, title=title)["title"] == title


def test_unknown_and_invalid_task_ids(client: TestClient, ada: Headers, tasks_url: str) -> None:
    missing = client.get(f"{tasks_url}/{uuid.uuid4()}", headers=ada)

    assert (missing.status_code, missing.json()) == (404, {"detail": "Task not found."})
    assert client.get(f"{tasks_url}/not-a-uuid", headers=ada).status_code == 422


# List: filtering, searching, sorting, paging


def test_list_defaults_to_newest_first(client: TestClient, ada: Headers, tasks_url: str) -> None:
    for title in ("First", "Second", "Third"):
        create(client, tasks_url, ada, title=title)

    response = client.get(tasks_url, headers=ada)

    assert response.status_code == 200
    assert [t["title"] for t in response.json()["tasks"]] == ["Third", "Second", "First"]
    assert response.json()["total"] == 3
    assert titles(client, tasks_url, ada, sort="created_at", order="asc") == [
        "First",
        "Second",
        "Third",
    ]


def test_list_is_empty_for_a_new_workspace(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    assert client.get(tasks_url, headers=ada).json() == {"tasks": [], "total": 0}


def test_filter_by_status(client: TestClient, ada: Headers, tasks_url: str) -> None:
    done = create(client, tasks_url, ada, title="Done")
    create(client, tasks_url, ada, title="Pending")
    client.post(f"{tasks_url}/{done['id']}/complete", headers=ada)

    assert titles(client, tasks_url, ada, status="open") == ["Pending"]
    assert titles(client, tasks_url, ada, status="completed") == ["Done"]
    assert sorted(titles(client, tasks_url, ada)) == ["Done", "Pending"]


def test_filter_by_one_or_several_priorities(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    for priority in ("none", "low", "medium", "high"):
        create(client, tasks_url, ada, title=priority, priority=priority)

    assert titles(client, tasks_url, ada, priority="high") == ["high"]
    assert sorted(titles(client, tasks_url, ada, priority=["low", "medium"])) == ["low", "medium"]


def test_filters_combine(client: TestClient, ada: Headers, tasks_url: str) -> None:
    create(client, tasks_url, ada, title="Call the bank", priority="high")
    create(client, tasks_url, ada, title="Call mum", priority="low")
    done = create(client, tasks_url, ada, title="Call the dentist", priority="high")
    client.post(f"{tasks_url}/{done['id']}/complete", headers=ada)

    result = client.get(
        tasks_url, params={"status": "open", "priority": "high", "q": "call"}, headers=ada
    ).json()

    assert [t["title"] for t in result["tasks"]] == ["Call the bank"]
    assert result["total"] == 1


def test_search_titles_and_descriptions_case_insensitively(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    create(client, tasks_url, ada, title="Buy GROCERIES")
    create(client, tasks_url, ada, title="Errands", description="Pick up groceries on the way")
    create(client, tasks_url, ada, title="Gym")

    assert sorted(titles(client, tasks_url, ada, q="groceries")) == ["Buy GROCERIES", "Errands"]
    assert titles(client, tasks_url, ada, q="  gym ") == ["Gym"]
    assert titles(client, tasks_url, ada, q="nothing like this") == []
    # A blank search is no search.
    assert len(titles(client, tasks_url, ada, q="   ")) == 3


def test_search_matches_wildcard_characters_literally(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    create(client, tasks_url, ada, title="Give 100% effort")
    create(client, tasks_url, ada, title="Give 1000 effort")
    create(client, tasks_url, ada, title="snake_case")
    create(client, tasks_url, ada, title="snakeXcase")
    create(client, tasks_url, ada, title="C:\\temp")

    assert titles(client, tasks_url, ada, q="100%") == ["Give 100% effort"]
    assert titles(client, tasks_url, ada, q="e_c") == ["snake_case"]
    assert titles(client, tasks_url, ada, q="%") == ["Give 100% effort"]
    assert titles(client, tasks_url, ada, q="\\") == ["C:\\temp"]


def test_sort_by_due_date_puts_undated_tasks_last(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    create(client, tasks_url, ada, title="Undated")
    create(client, tasks_url, ada, title="Later", due_date="2026-12-01")
    create(client, tasks_url, ada, title="Soon", due_date="2026-11-01")
    create(client, tasks_url, ada, title="Same day, low", due_date="2026-11-02", priority="low")
    create(client, tasks_url, ada, title="Same day, high", due_date="2026-11-02", priority="high")

    assert titles(client, tasks_url, ada, sort="due_date") == [
        "Soon",
        "Same day, high",
        "Same day, low",
        "Later",
        "Undated",
    ]
    assert titles(client, tasks_url, ada, sort="due_date", order="desc") == [
        "Later",
        "Same day, high",
        "Same day, low",
        "Soon",
        "Undated",
    ]


def test_sort_by_priority(client: TestClient, ada: Headers, tasks_url: str) -> None:
    create(client, tasks_url, ada, title="Low", priority="low")
    create(client, tasks_url, ada, title="None")
    create(client, tasks_url, ada, title="High, later", priority="high", due_date="2026-12-01")
    create(client, tasks_url, ada, title="High, sooner", priority="high", due_date="2026-11-01")
    create(client, tasks_url, ada, title="Medium", priority="medium")

    assert titles(client, tasks_url, ada, sort="priority") == [
        "High, sooner",
        "High, later",
        "Medium",
        "Low",
        "None",
    ]
    assert titles(client, tasks_url, ada, sort="priority", order="asc")[:2] == ["None", "Low"]


def test_pagination_reports_the_total(client: TestClient, ada: Headers, tasks_url: str) -> None:
    for index in range(5):
        create(client, tasks_url, ada, title=f"Task {index}")

    page = client.get(
        tasks_url,
        params={"sort": "created_at", "order": "asc", "limit": 2, "offset": 2},
        headers=ada,
    ).json()

    assert [t["title"] for t in page["tasks"]] == ["Task 2", "Task 3"]
    assert page["total"] == 5


@pytest.mark.parametrize(
    "params",
    [
        {"status": "done"},
        {"priority": "urgent"},
        {"sort": "title"},
        {"order": "sideways"},
        {"limit": 0},
        {"limit": 501},
        {"offset": -1},
        {"q": "x" * 201},
        {"workspace_id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_list_parameters_are_validated(
    client: TestClient, ada: Headers, tasks_url: str, params: dict[str, Any]
) -> None:
    assert client.get(tasks_url, params=params, headers=ada).status_code == 422


# Update, complete, reopen, delete


def test_update_changes_only_the_given_fields(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = create(client, tasks_url, ada, title="Draft", description="Notes", due_date="2026-11-01")

    response = client.patch(
        f"{tasks_url}/{task['id']}", json={"title": " Final ", "priority": "medium"}, headers=ada
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["title"] == "Final"
    assert updated["priority"] == "medium"
    assert updated["description"] == "Notes"
    assert updated["due_date"] == "2026-11-01"
    assert datetime.fromisoformat(updated["updated_at"]) > datetime.fromisoformat(
        task["updated_at"]
    )
    assert client.get(f"{tasks_url}/{task['id']}", headers=ada).json() == updated


def test_update_clears_the_due_date_and_description(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = create(client, tasks_url, ada, description="Notes", due_date="2026-11-01")

    updated = client.patch(
        f"{tasks_url}/{task['id']}", json={"due_date": None, "description": ""}, headers=ada
    ).json()

    assert updated["due_date"] is None
    assert updated["description"] == ""


def test_an_update_that_changes_nothing_keeps_the_timestamp(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = create(client, tasks_url, ada, title="Same")

    updated = client.patch(f"{tasks_url}/{task['id']}", json={"title": "Same"}, headers=ada).json()

    assert updated == task


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": None},
        {"title": ""},
        {"description": None},
        {"priority": None},
        {"priority": "urgent"},
        {"status": "completed"},
        {"completed_at": None},
        {"workspace_id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_updates_are_validated(
    client: TestClient, ada: Headers, tasks_url: str, body: dict[str, Any]
) -> None:
    task = create(client, tasks_url, ada, title="Keep me")

    response = client.patch(f"{tasks_url}/{task['id']}", json=body, headers=ada)

    assert response.status_code == 422
    assert client.get(f"{tasks_url}/{task['id']}", headers=ada).json() == task


def test_complete_and_reopen(client: TestClient, ada: Headers, tasks_url: str) -> None:
    task = create(client, tasks_url, ada)

    completed = client.post(f"{tasks_url}/{task['id']}/complete", headers=ada)
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None

    reopened = client.post(f"{tasks_url}/{task['id']}/reopen", headers=ada)
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"
    assert reopened.json()["completed_at"] is None


def test_completing_twice_keeps_the_first_completion_time(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    task = create(client, tasks_url, ada)
    first = client.post(f"{tasks_url}/{task['id']}/complete", headers=ada).json()

    again = client.post(f"{tasks_url}/{task['id']}/complete", headers=ada).json()

    assert again == first
    assert client.post(f"{tasks_url}/{task['id']}/reopen", headers=ada).status_code == 200
    reopened_again = client.post(f"{tasks_url}/{task['id']}/reopen", headers=ada)
    assert reopened_again.status_code == 200
    assert reopened_again.json()["status"] == "open"


def test_delete_task(client: TestClient, ada: Headers, tasks_url: str) -> None:
    task = create(client, tasks_url, ada)
    kept = create(client, tasks_url, ada, title="Kept")

    response = client.delete(f"{tasks_url}/{task['id']}", headers=ada)

    assert response.status_code == 204
    assert client.get(f"{tasks_url}/{task['id']}", headers=ada).status_code == 404
    assert client.delete(f"{tasks_url}/{task['id']}", headers=ada).status_code == 404
    assert titles(client, tasks_url, ada) == [kept["title"]]


@pytest.mark.parametrize("action", ["complete", "reopen"])
def test_completion_of_missing_tasks(
    client: TestClient, ada: Headers, tasks_url: str, action: str
) -> None:
    response = client.post(f"{tasks_url}/{uuid.uuid4()}/{action}", headers=ada)

    assert (response.status_code, response.json()) == (404, {"detail": "Task not found."})


# Summary


def test_summary_counts_tasks_relative_to_the_clients_date(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    create(client, tasks_url, ada, title="Overdue", due_date="2026-10-28")
    create(client, tasks_url, ada, title="Today", due_date="2026-10-29")
    create(client, tasks_url, ada, title="Today too", due_date="2026-10-29")
    create(client, tasks_url, ada, title="Later", due_date="2026-11-30")
    create(client, tasks_url, ada, title="Undated")
    done = create(client, tasks_url, ada, title="Done, was overdue", due_date="2026-10-01")
    client.post(f"{tasks_url}/{done['id']}/complete", headers=ada)

    response = client.get(f"{tasks_url}/summary", params={"today": "2026-10-29"}, headers=ada)

    assert response.status_code == 200
    assert response.json() == {"open": 5, "completed": 1, "overdue": 1, "due_today": 2}
    # The same tasks, a day later in the client's time zone.
    later = client.get(f"{tasks_url}/summary", params={"today": "2026-10-30"}, headers=ada)
    assert later.json() == {"open": 5, "completed": 1, "overdue": 3, "due_today": 0}


def test_summary_of_an_empty_workspace(client: TestClient, ada: Headers, tasks_url: str) -> None:
    response = client.get(f"{tasks_url}/summary", headers=ada)

    assert response.json() == {"open": 0, "completed": 0, "overdue": 0, "due_today": 0}
    assert client.get(
        f"{tasks_url}/summary", params={"today": "soon"}, headers=ada
    ).status_code == (422)


# Workspace isolation and authorization


def test_tasks_are_scoped_to_their_workspace(
    client: TestClient, ada: Headers, tasks_url: str
) -> None:
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()
    lab_url = f"{WORKSPACES}/{lab['id']}/tasks"
    home_task = create(client, tasks_url, ada, title="Home task")
    lab_task = create(client, lab_url, ada, title="Lab task")

    assert titles(client, tasks_url, ada) == ["Home task"]
    assert titles(client, lab_url, ada) == ["Lab task"]
    assert client.get(f"{tasks_url}/summary", headers=ada).json()["open"] == 1
    # A task ID only resolves inside its own workspace, even for the same user.
    assert client.get(f"{lab_url}/{home_task['id']}", headers=ada).status_code == 404
    assert client.patch(
        f"{tasks_url}/{lab_task['id']}", json={"title": "x"}, headers=ada
    ).status_code == (404)
    assert client.delete(f"{tasks_url}/{lab_task['id']}", headers=ada).status_code == 404
    assert client.get(f"{lab_url}/{lab_task['id']}", headers=ada).json()["title"] == "Lab task"


def test_other_users_cannot_reach_tasks_through_the_owners_workspace(
    client: TestClient, ada: Headers, grace: Headers, tasks_url: str
) -> None:
    task = create(client, tasks_url, ada, title="Ada's secret", description="Private")
    task_url = f"{tasks_url}/{task['id']}"
    not_found = {"detail": "Workspace not found."}

    attempts = [
        client.get(tasks_url, headers=grace),
        client.get(tasks_url, params={"q": "secret"}, headers=grace),
        client.get(f"{tasks_url}/summary", headers=grace),
        client.post(tasks_url, json={"title": "Planted by Grace"}, headers=grace),
        client.get(task_url, headers=grace),
        client.patch(task_url, json={"title": "Mine now"}, headers=grace),
        client.post(f"{task_url}/complete", headers=grace),
        client.post(f"{task_url}/reopen", headers=grace),
        client.delete(task_url, headers=grace),
    ]

    for response in attempts:
        assert (response.status_code, response.json()) == (404, not_found)
    # Ada's data is untouched, and nothing was added to her workspace.
    assert client.get(task_url, headers=ada).json() == task
    assert titles(client, tasks_url, ada) == ["Ada's secret"]


def test_other_users_cannot_reach_tasks_through_their_own_workspace(
    client: TestClient, ada: Headers, grace: Headers, tasks_url: str
) -> None:
    """Grace's workspace is authorized for her, but Ada's task ID must not resolve inside it."""
    task = create(client, tasks_url, ada, title="Ada's task")
    graces_url = f"{WORKSPACES}/{personal_id(client, grace)}/tasks"
    task_url = f"{graces_url}/{task['id']}"
    not_found = {"detail": "Task not found."}

    attempts = [
        client.get(task_url, headers=grace),
        client.patch(task_url, json={"title": "Mine now"}, headers=grace),
        client.post(f"{task_url}/complete", headers=grace),
        client.post(f"{task_url}/reopen", headers=grace),
        client.delete(task_url, headers=grace),
    ]

    for response in attempts:
        assert (response.status_code, response.json()) == (404, not_found)
    assert client.get(graces_url, headers=grace).json() == {"tasks": [], "total": 0}
    assert client.get(f"{graces_url}/summary", headers=grace).json()["open"] == 0
    assert client.get(f"{tasks_url}/{task['id']}", headers=ada).json() == task


def test_deleting_a_workspace_deletes_its_tasks(
    client: TestClient, ada: Headers, migrated_settings: Settings
) -> None:
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()
    create(client, f"{WORKSPACES}/{lab['id']}/tasks", ada, title="Lab task")
    kept = create(client, f"{WORKSPACES}/{personal_id(client, ada)}/tasks", ada, title="Kept")

    assert client.delete(f"{WORKSPACES}/{lab['id']}", headers=ada).status_code == 204

    rows = query(migrated_settings.sqlite_path, "SELECT title FROM tasks")
    assert rows == [(kept["title"],)]


@pytest.mark.parametrize(
    ("method", "suffix"),
    [
        ("GET", ""),
        ("POST", ""),
        ("GET", "/summary"),
        ("GET", f"/{uuid.uuid4()}"),
        ("PATCH", f"/{uuid.uuid4()}"),
        ("DELETE", f"/{uuid.uuid4()}"),
        ("POST", f"/{uuid.uuid4()}/complete"),
        ("POST", f"/{uuid.uuid4()}/reopen"),
    ],
)
def test_every_task_endpoint_requires_authentication(
    client: TestClient, tasks_url: str, method: str, suffix: str
) -> None:
    response = client.request(method, f"{tasks_url}{suffix}", json={"title": "x"})

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
