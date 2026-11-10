from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.system.file_manager import FileManagerUnavailableError
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

STORAGE = "/api/v1/storage"
REVEAL = "/api/v1/storage/reveal"


def backups_of(client: TestClient, headers: dict[str, str]) -> tuple[str, str]:
    """The workspace's ID and its backups URL."""
    workspace_id = client.get("/api/v1/workspaces", headers=headers).json()["workspaces"][0]["id"]
    return workspace_id, f"/api/v1/workspaces/{workspace_id}/backups"


class FakeRevealer:
    def __init__(self, *, available: bool = True) -> None:
        self.revealed: list[Path] = []
        self.opened: list[Path] = []
        self.available = available

    def reveal(self, path: Path) -> None:
        if not self.available:
            raise FileManagerUnavailableError
        self.revealed.append(path)

    def open_folder(self, folder: Path) -> None:
        if not self.available:
            raise FileManagerUnavailableError
        self.opened.append(folder)


@pytest.fixture
def revealer(app: FastAPI) -> FakeRevealer:
    """Never launch a real file manager from tests."""
    fake = FakeRevealer()
    app.state.file_revealer = fake
    return fake


def test_local_mode_reports_the_database_path(
    client: TestClient, migrated_settings: Settings
) -> None:
    ada = bearer(sign_up(client))

    response = client.get(STORAGE, headers=ada)

    assert response.status_code == 200
    assert response.json() == {
        "storage_mode": "local",
        "database_path": str(migrated_settings.sqlite_path),
        "can_reveal": True,
    }


def test_reveal_opens_the_configured_database_location(
    client: TestClient, revealer: FakeRevealer, migrated_settings: Settings
) -> None:
    ada = bearer(sign_up(client))

    response = client.post(REVEAL, headers=ada)

    assert response.status_code == 204
    assert revealer.revealed == [migrated_settings.sqlite_path]


def test_reveal_reports_a_missing_file_manager(client: TestClient, revealer: FakeRevealer) -> None:
    ada = bearer(sign_up(client))
    revealer.available = False

    response = client.post(REVEAL, headers=ada)

    assert response.status_code == 503
    assert "file manager" in response.json()["detail"]


@pytest.fixture
def production_client(migrated_settings: Settings) -> Iterator[tuple[TestClient, FakeRevealer]]:
    settings = migrated_settings.model_copy(
        update={
            "env": "production",
            "cors_origins": ["https://orbit.example"],
            "local_open_registration": True,
        }
    )
    app = create_app(settings)
    app.state.password_hasher = FAST_PASSWORD_HASHER
    fake = FakeRevealer()
    app.state.file_revealer = fake
    with TestClient(app) as client:
        yield client, fake


def test_production_never_exposes_or_opens_the_database_location(
    production_client: tuple[TestClient, FakeRevealer],
) -> None:
    client, revealer = production_client
    ada = bearer(sign_up(client))

    info = client.get(STORAGE, headers=ada).json()
    reveal = client.post(REVEAL, headers=ada)

    assert info == {"storage_mode": "local", "database_path": None, "can_reveal": False}
    assert reveal.status_code == 404
    assert revealer.revealed == []


def test_backup_overview_reports_the_workspace_backup_folder(
    client: TestClient, migrated_settings: Settings
) -> None:
    ada = bearer(sign_up(client))
    workspace_id, backups = backups_of(client, ada)

    overview = client.get(backups, headers=ada).json()

    assert overview["folder"] == str(migrated_settings.backups_dir / workspace_id)
    assert overview["can_reveal_folder"] is True


def test_reveal_opens_and_creates_the_workspace_backup_folder(
    client: TestClient, revealer: FakeRevealer, migrated_settings: Settings
) -> None:
    ada = bearer(sign_up(client))
    workspace_id, backups = backups_of(client, ada)
    folder = migrated_settings.backups_dir / workspace_id

    response = client.post(f"{backups}/reveal", headers=ada)

    assert response.status_code == 204
    assert revealer.opened == [folder]
    assert folder.is_dir()
    assert folder.stat().st_mode & 0o777 == 0o700


def test_reveal_backups_reports_a_missing_file_manager(
    client: TestClient, revealer: FakeRevealer
) -> None:
    ada = bearer(sign_up(client))
    revealer.available = False
    _, backups = backups_of(client, ada)

    response = client.post(f"{backups}/reveal", headers=ada)

    assert response.status_code == 503
    assert "file manager" in response.json()["detail"]


def test_production_never_exposes_or_opens_the_backup_folder(
    production_client: tuple[TestClient, FakeRevealer],
) -> None:
    client, revealer = production_client
    ada = bearer(sign_up(client))
    _, backups = backups_of(client, ada)

    overview = client.get(backups, headers=ada).json()
    reveal = client.post(f"{backups}/reveal", headers=ada)

    assert (overview["folder"], overview["can_reveal_folder"]) == (None, False)
    assert reveal.status_code == 404
    assert revealer.opened == []
