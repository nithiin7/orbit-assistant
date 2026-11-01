"""PostgreSQL integration tests. Opt-in: they need a disposable PostgreSQL database.

Run with `ORBIT_TEST_DATABASE_URL=postgresql://... uv run pytest -m postgres`. The database is
migrated up and back down to an empty schema, so never point this at real data.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from orbit_api.config import Settings
from orbit_api.db.database import open_database
from orbit_api.db.engine import create_engine
from orbit_api.db.migrate import downgrade, upgrade
from orbit_api.main import create_app
from orbit_api.repositories.calendar import build_calendar_service
from orbit_api.services.calendar.models import DateWindow, EventDraft, OccurrenceChanges
from orbit_api.services.calendar.recurrence import EventRecurrence

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
    "finance_accounts",
    "finance_categories",
    "finance_transactions",
    "finance_loans",
    "finance_loan_installments",
    "finance_recurring_payments",
    "finance_recurring_occurrences",
    "finance_investment_accounts",
    "finance_holdings",
    "finance_holding_prices",
    "finance_sip_plans",
    "finance_deposits",
    "finance_investment_transactions",
    "finance_assets",
    "finance_asset_valuations",
    "finance_net_worth_snapshots",
    "calendar_categories",
    "calendar_events",
    "calendar_event_exceptions",
    "calendar_event_alerts",
    "calendar_event_notes",
    "calendar_event_tasks",
    "calendar_preferences",
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


@pytest.mark.anyio
async def test_calendar_series_on_postgres(cloud_settings: Settings) -> None:
    """The calendar's SQL on PostgreSQL: naive local times, JSON rules, composite keys, row
    locks, alert reminders, and cascades. Driven through the service, since cloud mode's API needs
    Supabase tokens."""
    database = await open_database(cloud_settings)
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    try:
        async with database.session() as session:
            await session.execute(
                text(
                    "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                    " created_at, updated_at) VALUES (:id, 'local', :subject, 'c@example.com', 'C',"
                    " now(), now())"
                ),
                {"id": user_id, "subject": str(user_id)},
            )
            await session.execute(
                text(
                    "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at,"
                    " updated_at) VALUES (:id, :owner, 'Personal', true, now(), now())"
                ),
                {"id": workspace_id, "owner": user_id},
            )
            await session.commit()

            calendar = build_calendar_service(session)
            category = (await calendar.categories(workspace_id))[0]
            detail = await calendar.create_event(
                workspace_id,
                EventDraft(
                    title="Standup",
                    start=datetime(2030, 3, 29, 9, 0),
                    end=datetime(2030, 3, 29, 9, 30),
                    timezone="Europe/Paris",
                    category_id=category.id,
                    recurrence=EventRecurrence("daily", count=5),
                    alerts=(10,),
                ),
                default_timezone=None,
            )
            event_id = detail.event.id
            await calendar.update_occurrence(
                workspace_id,
                event_id,
                datetime(2030, 3, 30, 9, 0),
                "this",
                OccurrenceChanges(title="Moved", start=datetime(2030, 3, 30, 11, 0)),
            )
            await calendar.delete_occurrence(
                workspace_id, event_id, datetime(2030, 3, 31, 9, 0), "this"
            )
            tail = await calendar.update_occurrence(
                workspace_id,
                event_id,
                datetime(2030, 4, 1, 9, 0),
                "following",
                OccurrenceChanges(title="Later"),
            )
            result = await calendar.range(
                workspace_id, DateWindow(date(2030, 3, 29), date(2030, 4, 5), "Europe/Paris")
            )
            assert [(o.title, o.start_at.isoformat()) for o in result.occurrences] == [
                ("Standup", "2030-03-29T08:00:00+00:00"),
                ("Moved", "2030-03-30T10:00:00+00:00"),
                ("Later", "2030-04-01T07:00:00+00:00"),
                ("Later", "2030-04-02T07:00:00+00:00"),
            ]
            reminders = await session.scalar(
                text("SELECT count(*) FROM reminders WHERE calendar_event_alert_id IS NOT NULL")
            )
            assert reminders == 2  # One per series' alert.

            await calendar.delete_event(workspace_id, tail.event.id)
            await calendar.delete_category(workspace_id, category.id)
            left = await session.scalar(
                text("SELECT count(*) FROM reminders WHERE calendar_event_alert_id IS NOT NULL")
            )
            assert left == 1
            assert (await calendar.get_event(workspace_id, event_id)).event.category_id is None
    finally:
        async with database.session() as session:
            await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
            await session.commit()
        await database.dispose()
