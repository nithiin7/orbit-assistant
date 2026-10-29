"""PostgreSQL integration tests. Opt-in: they need a disposable PostgreSQL database.

Run with `ORBIT_TEST_DATABASE_URL=postgresql://... uv run pytest -m postgres`. The database is
migrated up and back down to an empty schema, so never point this at real data.
"""

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from orbit_api.config import Settings
from orbit_api.db.engine import create_engine
from orbit_api.db.migrate import downgrade, upgrade
from orbit_api.main import create_app

TEST_DATABASE_URL = os.environ.get("ORBIT_TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="ORBIT_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def cloud_settings() -> Iterator[Settings]:
    settings = Settings(
        env="test",
        storage_mode="cloud",
        database_url=TEST_DATABASE_URL,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )
    upgrade(settings)
    yield settings
    downgrade(settings, "base")


PROTECTED_TABLES = (
    "users",
    "local_credentials",
    "local_sessions",
    "workspaces",
    "user_avatars",
    "tasks",
    "shopping_lists",
    "shopping_items",
    "dashboard_layouts",
    "reminders",
    "reminder_occurrences",
    "notifications",
)


@pytest.mark.anyio
async def test_every_table_enables_row_level_security(cloud_settings: Settings) -> None:
    engine = create_engine(cloud_settings)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(
                text("SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(:names)"),
                {"names": list(PROTECTED_TABLES)},
            )
            rows: dict[str, bool] = dict(result.all())
    finally:
        await engine.dispose()

    assert rows == dict.fromkeys(PROTECTED_TABLES, True)


@pytest.mark.anyio
async def test_row_level_security_denies_roles_without_policies(cloud_settings: Settings) -> None:
    """A role that does not own the tables, like Supabase's `anon` and `authenticated`, sees no
    rows: RLS is enabled and no policy grants access. Everything is rolled back afterwards."""
    engine = create_engine(cloud_settings)
    try:
        async with engine.connect() as connection:
            await connection.execute(
                text(
                    "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                    " created_at, updated_at) VALUES (gen_random_uuid(), 'local', 's',"
                    " 'a@example.com', 'A', now(), now())"
                )
            )
            owner_sees = await connection.scalar(text("SELECT count(*) FROM users"))
            await connection.execute(text("CREATE ROLE orbit_rls_probe NOLOGIN"))
            await connection.execute(text("GRANT SELECT ON users TO orbit_rls_probe"))
            await connection.execute(text("SET LOCAL ROLE orbit_rls_probe"))
            probe_sees = await connection.scalar(text("SELECT count(*) FROM users"))
            await connection.rollback()
    finally:
        await engine.dispose()

    assert (owner_sees, probe_sees) == (1, 0)


def test_cloud_mode_serves_requests_against_postgres(cloud_settings: Settings) -> None:
    with TestClient(create_app(cloud_settings)) as client:
        response = client.get("/api/v1/health/database")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "storage_mode": "cloud"}
