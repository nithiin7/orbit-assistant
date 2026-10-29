"""Alembic migration environment.

Runs against the database selected by Orbit's settings: the `settings` attribute when invoked
through `orbit_api.db.migrate`, otherwise the `ORBIT_*` environment (`uv run alembic ...`).
"""

import asyncio

from alembic import context
from sqlalchemy import Connection

# Imported for its side effect: registering every ORM table on `Base.metadata`.
import orbit_api.db.models  # noqa: F401  # pyright: ignore[reportUnusedImport]
from orbit_api.config import Settings, get_settings
from orbit_api.db.base import Base
from orbit_api.db.engine import create_engine

config = context.config
target_metadata = Base.metadata


def _settings() -> Settings:
    settings = config.attributes.get("settings")
    return settings if isinstance(settings, Settings) else get_settings()


def _run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite cannot ALTER most constraints; batch mode recreates the table instead.
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_online() -> None:
    engine = create_engine(_settings())
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) migrations are not supported. Run against a database.")

asyncio.run(_run_online())
