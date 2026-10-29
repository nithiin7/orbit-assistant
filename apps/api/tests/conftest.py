from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.migrate import upgrade
from orbit_api.main import create_app


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
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(migrated_settings)) as test_client:
        yield test_client
