from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.migrate import upgrade
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Local-mode settings backed by a fresh, unmigrated SQLite file in a temporary directory."""
    return Settings(
        env="test",
        storage_mode="local",
        sqlite_path=tmp_path / "orbit.sqlite3",
        database_url=None,
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )


@pytest.fixture
def migrated_settings(settings: Settings) -> Settings:
    upgrade(settings)
    return settings


@pytest.fixture
def app(migrated_settings: Settings) -> FastAPI:
    app = create_app(migrated_settings)
    # Production-strength Argon2 parameters make each hash take tens of milliseconds.
    app.state.password_hasher = FAST_PASSWORD_HASHER
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
