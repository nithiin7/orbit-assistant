import stat
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from sqlalchemy import text
from sqlalchemy.pool import AsyncAdaptedQueuePool

from orbit_api.api.dependencies import get_session
from orbit_api.config import Settings
from orbit_api.db.database import DatabaseSchemaError, DatabaseUnavailableError, open_database

pytestmark = pytest.mark.anyio


async def test_opens_a_migrated_local_database(migrated_settings: Settings) -> None:
    database = await open_database(migrated_settings)
    try:
        assert database.mode == "local"
        assert str(migrated_settings.sqlite_path) in database.target
    finally:
        await database.dispose()


async def test_configures_sqlite_connections(migrated_settings: Settings) -> None:
    database = await open_database(migrated_settings)
    try:
        async with database.engine.connect() as connection:
            foreign_keys = await connection.scalar(text("PRAGMA foreign_keys"))
            journal_mode = await connection.scalar(text("PRAGMA journal_mode"))
        assert foreign_keys == 1
        assert journal_mode == "wal"
    finally:
        await database.dispose()


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file permissions")
async def test_creates_database_readable_only_by_owner(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "orbit.sqlite3"
    settings = Settings(env="test", sqlite_path=path, _env_file=None)  # pyright: ignore[reportCallIssue]

    with pytest.raises(DatabaseSchemaError):
        await open_database(settings)

    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700


async def test_refuses_to_start_on_an_unmigrated_database(settings: Settings) -> None:
    with pytest.raises(DatabaseSchemaError, match="pnpm db:migrate"):
        await open_database(settings)


async def test_fails_clearly_when_the_sqlite_file_cannot_be_opened(tmp_path: Path) -> None:
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("")
    settings = Settings(
        env="test",
        sqlite_path=blocker / "orbit.sqlite3",
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )

    with pytest.raises(DatabaseUnavailableError, match="Could not open the SQLite database"):
        await open_database(settings)


async def test_unreachable_cloud_database_fails_without_local_fallback(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "orbit.sqlite3"
    settings = Settings(
        env="test",
        storage_mode="cloud",
        # Port 1 on loopback refuses connections immediately.
        database_url="postgresql://orbit:hunter2-secret@127.0.0.1:1/orbit",
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        sqlite_path=sqlite_path,
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )

    with pytest.raises(DatabaseUnavailableError, match="cloud database") as error:
        await open_database(settings)

    assert "hunter2-secret" not in str(error.value)
    assert not sqlite_path.exists()


async def test_session_commits_persist_and_uncommitted_work_is_discarded(
    migrated_settings: Settings,
) -> None:
    database = await open_database(migrated_settings)
    try:
        async with database.session() as session:
            await session.execute(text("CREATE TABLE scratch (value TEXT)"))
            await session.execute(text("INSERT INTO scratch VALUES ('kept')"))
            await session.commit()

        async with database.session() as session:
            await session.execute(text("INSERT INTO scratch VALUES ('discarded')"))

        async with database.session() as session:
            values = (await session.scalars(text("SELECT value FROM scratch"))).all()
        assert values == ["kept"]
    finally:
        await database.dispose()


async def test_request_session_is_closed_after_the_request(migrated_settings: Settings) -> None:
    database = await open_database(migrated_settings)
    app = FastAPI()
    app.state.database = database
    request = Request({"type": "http", "app": app})
    try:
        sessions = get_session(request)
        session = await anext(sessions)
        await session.execute(text("SELECT 1"))
        assert session.in_transaction()

        with pytest.raises(StopAsyncIteration):
            await anext(sessions)

        assert not session.in_transaction()
        pool = database.engine.pool
        assert isinstance(pool, AsyncAdaptedQueuePool)
        assert pool.checkedout() == 0
    finally:
        await database.dispose()
