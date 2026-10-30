import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.services.dashboard.models import WIDGET_IDS
from tests.support import bearer, query, sign_up

DASHBOARD = "/api/v1/me/dashboard"
LAYOUT: list[dict[str, Any]] = [
    {"id": "tasks", "size": "half"},
    {"id": "shopping", "size": "half"},
    {"id": "modules", "size": "full"},
]


def test_no_layout_by_default(client: TestClient) -> None:
    ada = bearer(sign_up(client))

    response = client.get(DASHBOARD, headers=ada)

    assert response.status_code == 204
    assert response.content == b""


def test_save_replace_and_reset_layout(client: TestClient) -> None:
    ada = bearer(sign_up(client))

    saved = client.put(DASHBOARD, json={"widgets": LAYOUT}, headers=ada)
    assert saved.status_code == 200
    assert saved.json()["widgets"] == LAYOUT
    assert client.get(DASHBOARD, headers=ada).json() == saved.json()

    reordered = [LAYOUT[2], LAYOUT[0]]
    assert client.put(DASHBOARD, json={"widgets": reordered}, headers=ada).status_code == 200
    assert client.get(DASHBOARD, headers=ada).json()["widgets"] == reordered

    assert client.delete(DASHBOARD, headers=ada).status_code == 204
    assert client.get(DASHBOARD, headers=ada).status_code == 204
    # Resetting an unsaved layout is not an error.
    assert client.delete(DASHBOARD, headers=ada).status_code == 204


def test_accepts_every_widget_including_finance(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    every = [{"id": widget_id, "size": "half"} for widget_id in WIDGET_IDS]

    response = client.put(DASHBOARD, json={"widgets": every}, headers=ada)

    assert response.status_code == 200
    assert response.json()["widgets"] == every
    assert {"cash_flow", "upcoming_payments", "budget", "net_worth"} <= set(WIDGET_IDS)


def test_an_empty_dashboard_is_a_saved_layout(client: TestClient) -> None:
    ada = bearer(sign_up(client))

    client.put(DASHBOARD, json={"widgets": []}, headers=ada)

    response = client.get(DASHBOARD, headers=ada)
    assert response.status_code == 200
    assert response.json()["widgets"] == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"widgets": [{"id": "weather", "size": "full"}]},
        {"widgets": [{"id": "tasks", "size": "huge"}]},
        {"widgets": [{"id": "tasks"}]},
        {"widgets": [{"id": "tasks", "size": "full", "color": "red"}]},
        {"widgets": LAYOUT, "user_id": "someone-else"},
        # More widgets than exist.
        {"widgets": [{"id": "tasks", "size": "full"}] * (len(WIDGET_IDS) + 1)},
    ],
)
def test_rejects_invalid_layouts(client: TestClient, body: dict[str, Any]) -> None:
    ada = bearer(sign_up(client))

    assert client.put(DASHBOARD, json=body, headers=ada).status_code == 422
    assert client.get(DASHBOARD, headers=ada).status_code == 204


def test_rejects_repeated_widgets(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    twice = [{"id": "tasks", "size": "full"}, {"id": "tasks", "size": "half"}]

    response = client.put(DASHBOARD, json={"widgets": twice}, headers=ada)

    assert response.status_code == 422
    assert response.json() == {"detail": "Each widget can appear only once."}


def test_requires_sign_in(client: TestClient) -> None:
    assert client.get(DASHBOARD).status_code == 401
    assert client.put(DASHBOARD, json={"widgets": LAYOUT}).status_code == 401
    assert client.delete(DASHBOARD).status_code == 401


def test_layouts_are_private_to_their_owner(client: TestClient) -> None:
    ada = bearer(sign_up(client, email="ada@example.com"))
    grace = bearer(sign_up(client, email="grace@example.com"))
    client.put(DASHBOARD, json={"widgets": LAYOUT}, headers=ada)

    assert client.get(DASHBOARD, headers=grace).status_code == 204
    client.delete(DASHBOARD, headers=grace)
    assert client.get(DASHBOARD, headers=ada).json()["widgets"] == LAYOUT


def test_skips_stored_widgets_this_version_does_not_know(
    client: TestClient, migrated_settings: Settings
) -> None:
    ada = bearer(sign_up(client))
    client.put(DASHBOARD, json={"widgets": LAYOUT}, headers=ada)
    # As if a widget had been retired, or the row edited outside the API.
    stored = [{"id": "weather", "size": "full"}, {"id": "tasks", "size": "huge"}, "x", *LAYOUT]
    query(
        migrated_settings.sqlite_path,
        "UPDATE dashboard_layouts SET widgets = ?",
        json.dumps(stored),
    )

    response = client.get(DASHBOARD, headers=ada)

    assert response.status_code == 200
    assert response.json()["widgets"] == LAYOUT


def test_deleting_a_user_deletes_their_layout(
    client: TestClient, migrated_settings: Settings
) -> None:
    ada = bearer(sign_up(client))
    client.put(DASHBOARD, json={"widgets": LAYOUT}, headers=ada)
    database = migrated_settings.sqlite_path

    query(database, "DELETE FROM users")

    assert query(database, "SELECT * FROM dashboard_layouts") == []
