"""Programmatic access to the Alembic migrations that define the database schema."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from orbit_api.config import Settings

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def alembic_config(settings: Settings | None = None) -> Config:
    """Build an Alembic config. `settings` selects the database; it defaults to the environment."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR).replace("%", "%%"))
    if settings is not None:
        config.attributes["settings"] = settings
    return config


def head_revision() -> str | None:
    """The newest migration revision, which a ready database must be at."""
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def upgrade(settings: Settings, revision: str = "head") -> None:
    """Apply migrations up to `revision`. Must not be called from a running event loop."""
    command.upgrade(alembic_config(settings), revision)


def downgrade(settings: Settings, revision: str) -> None:
    """Revert migrations down to `revision`. Must not be called from a running event loop."""
    command.downgrade(alembic_config(settings), revision)
