"""Authorization checks over every operation the API publishes, not just the ones a module's own
tests remember to try. Operations come from the OpenAPI schema, so a new route is covered the
moment it exists: one that forgets `CurrentUserDep` or `WorkspaceDep` fails here.
"""

import re
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.support import bearer, sign_up

# Operations anyone may call. Adding to this list is a security decision; say why beside it.
PUBLIC_OPERATIONS = {
    # Liveness and readiness probes for deployment monitoring; they reveal no data.
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/health/live"),
    ("GET", "/api/v1/health/ready"),
    ("GET", "/api/v1/health/database"),
    # How to sign in, and signing in.
    ("GET", "/api/v1/auth/config"),
    ("POST", "/api/v1/auth/local/sign-up"),
    ("POST", "/api/v1/auth/local/sign-in"),
    # Provider push notifications, authenticated by per-channel secrets instead of a session.
    ("POST", "/api/v1/integrations/webhooks/google"),
    ("POST", "/api/v1/integrations/webhooks/microsoft"),
}

_PARAMETER = re.compile(r"\{([^}]+)\}")


def _operations(app: FastAPI) -> list[tuple[str, str]]:
    paths: dict[str, dict[str, Any]] = app.openapi()["paths"]
    return sorted((method.upper(), path) for path, item in paths.items() for method in item)


def _fill(path: str, workspace_id: uuid.UUID) -> str:
    """The path with `workspace_id` set and every other parameter a fresh, unknown UUID."""

    def value(match: re.Match[str]) -> str:
        return str(workspace_id) if match.group(1) == "workspace_id" else str(uuid.uuid4())

    return _PARAMETER.sub(value, path)


def test_the_public_allowlist_names_only_real_operations(app: FastAPI) -> None:
    operations = set(_operations(app))
    assert operations >= PUBLIC_OPERATIONS, PUBLIC_OPERATIONS - operations


def test_every_other_operation_requires_a_session(client: TestClient, app: FastAPI) -> None:
    open_operations = [
        (method, path)
        for method, path in _operations(app)
        if (method, path) not in PUBLIC_OPERATIONS
        and client.request(method, _fill(path, uuid.uuid4())).status_code != 401
    ]
    assert open_operations == []


def test_an_invalid_token_is_rejected_everywhere(client: TestClient, app: FastAPI) -> None:
    headers = bearer("not-a-session-token")
    accepted = [
        (method, path)
        for method, path in _operations(app)
        if (method, path) not in PUBLIC_OPERATIONS
        and client.request(method, _fill(path, uuid.uuid4()), headers=headers).status_code != 401
    ]
    assert accepted == []


@pytest.fixture
def victim(client: TestClient) -> tuple[dict[str, str], uuid.UUID]:
    headers = bearer(sign_up(client, "ada@example.com", display_name="Ada"))
    workspaces = client.get("/api/v1/workspaces", headers=headers).json()
    return headers, uuid.UUID(workspaces["workspaces"][0]["id"])


def test_no_workspace_operation_reaches_another_users_workspace(
    client: TestClient, app: FastAPI, victim: tuple[dict[str, str], uuid.UUID]
) -> None:
    """Every workspace-scoped operation answers another person's workspace with the same 404
    as a workspace that doesn't exist, before reading a body or touching any record."""
    ada, workspace_id = victim
    task = client.post(
        f"/api/v1/workspaces/{workspace_id}/tasks", json={"title": "Private"}, headers=ada
    )
    assert task.status_code == 201, task.text
    mallory = bearer(sign_up(client, "mallory@example.com", display_name="Mallory"))

    leaks = {
        (method, path): response.status_code
        for method, path in _operations(app)
        if "{workspace_id}" in path
        and (response := client.request(method, _fill(path, workspace_id), headers=mallory))
        and (response.status_code != 404 or response.json() != {"detail": "Workspace not found."})
    }
    assert leaks == {}

    # Nothing Mallory sent changed Ada's workspace.
    tasks = client.get(f"/api/v1/workspaces/{workspace_id}/tasks", headers=ada)
    assert [item["title"] for item in tasks.json()["tasks"]] == ["Private"]


def test_unknown_workspaces_look_the_same_as_other_peoples(
    client: TestClient, app: FastAPI, victim: tuple[dict[str, str], uuid.UUID]
) -> None:
    ada, _ = victim
    unknown = uuid.uuid4()
    different = {
        (method, path): response.status_code
        for method, path in _operations(app)
        if "{workspace_id}" in path
        and (response := client.request(method, _fill(path, unknown), headers=ada))
        and response.status_code != 404
    }
    assert different == {}
