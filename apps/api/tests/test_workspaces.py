import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> dict[str, str]:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> dict[str, str]:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def personal(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    workspace: dict[str, Any] = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    assert workspace["is_personal"]
    return workspace


def test_create_list_and_get_workspaces(client: TestClient, ada: dict[str, str]) -> None:
    created = client.post(WORKSPACES, json={"name": "  Side project "}, headers=ada)

    assert created.status_code == 201
    workspace = created.json()
    assert workspace["name"] == "Side project"
    assert workspace["is_personal"] is False
    assert workspace["role"] == "owner"

    listed = client.get(WORKSPACES, headers=ada).json()["workspaces"]
    assert [w["name"] for w in listed] == ["Personal", "Side project"]

    fetched = client.get(f"{WORKSPACES}/{workspace['id']}", headers=ada)
    assert fetched.status_code == 200
    assert fetched.json() == workspace


def test_switching_workspaces_scopes_each_request(client: TestClient, ada: dict[str, str]) -> None:
    home = personal(client, ada)
    work = client.post(WORKSPACES, json={"name": "Work"}, headers=ada).json()

    assert client.get(f"{WORKSPACES}/{home['id']}", headers=ada).json()["name"] == "Personal"
    assert client.get(f"{WORKSPACES}/{work['id']}", headers=ada).json()["name"] == "Work"


def test_rename_workspace(client: TestClient, ada: dict[str, str]) -> None:
    workspace = personal(client, ada)

    response = client.patch(f"{WORKSPACES}/{workspace['id']}", json={"name": "Home"}, headers=ada)

    assert response.status_code == 200
    assert response.json()["name"] == "Home"
    assert response.json()["is_personal"] is True


def test_delete_workspace(client: TestClient, ada: dict[str, str]) -> None:
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()

    response = client.delete(f"{WORKSPACES}/{lab['id']}", headers=ada)

    assert response.status_code == 204
    assert client.get(f"{WORKSPACES}/{lab['id']}", headers=ada).status_code == 404
    names = [w["name"] for w in client.get(WORKSPACES, headers=ada).json()["workspaces"]]
    assert names == ["Personal"]


def test_personal_workspace_cannot_be_deleted(client: TestClient, ada: dict[str, str]) -> None:
    workspace = personal(client, ada)

    response = client.delete(f"{WORKSPACES}/{workspace['id']}", headers=ada)

    assert response.status_code == 409
    assert response.json() == {"detail": "Your personal workspace cannot be deleted."}
    assert client.get(f"{WORKSPACES}/{workspace['id']}", headers=ada).status_code == 200


def test_other_users_workspaces_look_like_missing_ones(
    client: TestClient, ada: dict[str, str], grace: dict[str, str]
) -> None:
    adas = personal(client, ada)
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()
    missing = str(uuid.uuid4())

    for workspace_id in (adas["id"], lab["id"], missing):
        read = client.get(f"{WORKSPACES}/{workspace_id}", headers=grace)
        rename = client.patch(f"{WORKSPACES}/{workspace_id}", json={"name": "Mine"}, headers=grace)
        delete = client.delete(f"{WORKSPACES}/{workspace_id}", headers=grace)
        assert (read.status_code, read.json()) == (404, {"detail": "Workspace not found."})
        assert (rename.status_code, rename.json()) == (404, {"detail": "Workspace not found."})
        assert (delete.status_code, delete.json()) == (404, {"detail": "Workspace not found."})

    assert client.get(f"{WORKSPACES}/{adas['id']}", headers=ada).json()["name"] == "Personal"
    assert client.get(f"{WORKSPACES}/{lab['id']}", headers=ada).json()["name"] == "Lab"
    graces = client.get(WORKSPACES, headers=grace).json()["workspaces"]
    assert adas["id"] not in {w["id"] for w in graces}


def test_created_workspaces_belong_to_the_authenticated_user_only(
    client: TestClient, ada: dict[str, str], grace: dict[str, str]
) -> None:
    client.post(WORKSPACES, json={"name": "Ada's lab"}, headers=ada)

    graces = client.get(WORKSPACES, headers=grace).json()["workspaces"]
    assert [w["name"] for w in graces] == ["Personal"]


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 101},
        {"name": "Tab\there"},
        {},
        {"name": "Work", "owner_id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_workspace_input_is_validated(
    client: TestClient, ada: dict[str, str], body: dict[str, str]
) -> None:
    assert client.post(WORKSPACES, json=body, headers=ada).status_code == 422


def test_invalid_workspace_ids_are_rejected(client: TestClient, ada: dict[str, str]) -> None:
    assert client.get(f"{WORKSPACES}/not-a-uuid", headers=ada).status_code == 422


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", WORKSPACES),
        ("POST", WORKSPACES),
        ("GET", f"{WORKSPACES}/{uuid.uuid4()}"),
        ("PATCH", f"{WORKSPACES}/{uuid.uuid4()}"),
        ("DELETE", f"{WORKSPACES}/{uuid.uuid4()}"),
        ("GET", "/api/v1/me"),
        ("PATCH", "/api/v1/me"),
        ("GET", "/api/v1/me/avatar"),
        ("PUT", "/api/v1/me/avatar"),
        ("DELETE", "/api/v1/me/avatar"),
        ("GET", "/api/v1/storage"),
        ("POST", "/api/v1/storage/reveal"),
    ],
)
def test_every_account_endpoint_requires_authentication(
    client: TestClient, method: str, path: str
) -> None:
    response = client.request(method, path, json={"name": "x", "display_name": "x"})

    assert response.status_code == 401


def test_update_profile(client: TestClient, ada: dict[str, str]) -> None:
    response = client.patch("/api/v1/me", json={"display_name": " Countess "}, headers=ada)

    assert response.status_code == 200
    assert response.json()["display_name"] == "Countess"
    assert client.get("/api/v1/me", headers=ada).json()["display_name"] == "Countess"


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": ""},
        {"display_name": "x" * 101},
        {"display_name": "Ada", "email": "eve@example.com"},
        {"display_name": "Ada", "id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_profile_updates_are_validated(
    client: TestClient, ada: dict[str, str], body: dict[str, str]
) -> None:
    assert client.patch("/api/v1/me", json=body, headers=ada).status_code == 422
