import sqlite3

from alembic import command
from alembic.script import ScriptDirectory

from orbit_api.config import Settings
from orbit_api.db.migrate import alembic_config, downgrade, head_revision, upgrade


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
