import sqlite3
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from orbit_api.config import Settings
from orbit_api.db.migrate import alembic_config, downgrade, head_revision, upgrade
from tests.support import query


def recorded_revisions(settings: Settings) -> list[str]:
    with sqlite3.connect(settings.sqlite_path) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        if "alembic_version" not in tables:
            return []
        return [row[0] for row in connection.execute("SELECT version_num FROM alembic_version")]


def test_migration_history_is_linear() -> None:
    script = ScriptDirectory.from_config(alembic_config())

    assert len(script.get_heads()) == 1
    assert head_revision() is not None


def test_upgrade_records_the_head_revision(settings: Settings) -> None:
    upgrade(settings)

    assert recorded_revisions(settings) == [head_revision()]


def test_upgrade_is_idempotent(migrated_settings: Settings) -> None:
    upgrade(migrated_settings)

    assert recorded_revisions(migrated_settings) == [head_revision()]


def test_downgrade_to_base_and_upgrade_again(migrated_settings: Settings) -> None:
    downgrade(migrated_settings, "base")
    assert recorded_revisions(migrated_settings) == []

    upgrade(migrated_settings)
    assert recorded_revisions(migrated_settings) == [head_revision()]


def test_models_match_migrations(migrated_settings: Settings) -> None:
    """Fails when an ORM model changes without a migration. Fix with an Alembic revision."""
    command.check(alembic_config(migrated_settings))


IDENTITY_TABLES = {"users", "local_credentials", "local_sessions", "workspaces"}
NOW = "2026-10-29 12:00:00.000000"


def tables(settings: Settings) -> set[str]:
    rows = query(settings.sqlite_path, "SELECT name FROM sqlite_master WHERE type = 'table'")
    return {row[0] for row in rows}


def test_identity_migration_creates_and_drops_its_tables(migrated_settings: Settings) -> None:
    assert tables(migrated_settings) >= IDENTITY_TABLES

    downgrade(migrated_settings, "0001")

    assert not IDENTITY_TABLES & tables(migrated_settings)
    assert recorded_revisions(migrated_settings) == ["0001"]


def insert_user(database: Path, provider: str = "local", subject: str | None = None) -> str:
    user_id = uuid.uuid4().hex
    query(
        database,
        "INSERT INTO users (id, auth_provider, auth_subject, email, display_name, created_at,"
        " updated_at) VALUES (?, ?, ?, 'a@example.com', 'A', ?, ?)",
        user_id,
        provider,
        subject or user_id,
        NOW,
        NOW,
    )
    return user_id


def insert_workspace(database: Path, owner_id: str, *, is_personal: bool, name: str = "W") -> str:
    workspace_id = uuid.uuid4().hex
    query(
        database,
        "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        workspace_id,
        owner_id,
        name,
        is_personal,
        NOW,
        NOW,
    )
    return workspace_id


def test_database_allows_one_personal_workspace_per_user(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    insert_workspace(database, owner, is_personal=True)
    insert_workspace(database, owner, is_personal=False)

    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_workspace(database, owner, is_personal=True)


def test_database_requires_unique_identities(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    insert_user(database, "supabase", "subject-1")

    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_user(database, "supabase", "subject-1")


@pytest.mark.parametrize(
    ("statement", "params"),
    [
        ("UPDATE users SET auth_provider = 'github'", ()),
        ("UPDATE users SET display_name = ''", ()),
        ("UPDATE workspaces SET name = ''", ()),
        (
            "INSERT INTO local_credentials (user_id, email, password_hash, created_at,"
            " updated_at) SELECT id, 'Upper@Example.com', 'x', ?, ? FROM users",
            (NOW, NOW),
        ),
    ],
)
def test_database_enforces_check_constraints(
    migrated_settings: Settings, statement: str, params: tuple[str, ...]
) -> None:
    database = migrated_settings.sqlite_path
    insert_workspace(database, insert_user(database), is_personal=True)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        query(database, statement, *params)


def test_workspaces_require_an_existing_owner(migrated_settings: Settings) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_workspace(migrated_settings.sqlite_path, uuid.uuid4().hex, is_personal=True)


def test_deleting_a_user_deletes_their_workspaces(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    other = insert_user(database)
    insert_workspace(database, owner, is_personal=True)
    kept = insert_workspace(database, other, is_personal=True)

    query(database, "DELETE FROM users WHERE id = ?", owner)

    assert query(database, "SELECT id FROM workspaces") == [(kept,)]
