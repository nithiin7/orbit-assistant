import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import closing
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


def _local_settings(sqlite_path: Path) -> Settings:
    return Settings(
        env="test",
        storage_mode="local",
        sqlite_path=sqlite_path,
        database_url=None,
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Local-mode settings backed by a fresh, unmigrated SQLite file in a temporary directory."""
    return _local_settings(tmp_path / "orbit.sqlite3")


@pytest.fixture(scope="session")
def migrated_template(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A database migrated once per test run, by the real migrations, for tests to copy."""
    path = tmp_path_factory.mktemp("template") / "orbit.sqlite3"
    upgrade(_local_settings(path))
    # Fold the write-ahead log into the file, so copying the file alone copies everything.
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return path


@pytest.fixture
def migrated_settings(settings: Settings, migrated_template: Path) -> Settings:
    """`settings` with its own copy of a fully migrated database."""
    shutil.copyfile(migrated_template, settings.sqlite_path)
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
