"""SQLAlchemy engine construction for the configured storage mode."""

from pathlib import Path

from sqlalchemy import URL, event
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import ConnectionPoolEntry

from orbit_api.config import Settings

CONNECT_TIMEOUT_SECONDS = 10
# Recycle pooled PostgreSQL connections before typical server and pooler idle timeouts.
POSTGRES_POOL_RECYCLE_SECONDS = 1800


def create_engine(settings: Settings) -> AsyncEngine:
    """Create the engine for the selected storage mode. Never falls back to another mode."""
    if settings.storage_mode == "local":
        return _create_sqlite_engine(settings.sqlite_path)
    return _create_postgres_engine(settings)


def describe_target(settings: Settings) -> str:
    """A human-readable, credential-free description of where data is stored."""
    if settings.storage_mode == "local":
        return f"SQLite database at {settings.sqlite_path}"
    url = settings.postgres_url
    return f"PostgreSQL database '{url.database}' on {url.host}"


def _create_sqlite_engine(path: Path) -> AsyncEngine:
    _prepare_sqlite_file(path)
    engine = create_async_engine(
        URL.create("sqlite+aiosqlite", database=str(path)),
        # Keep bound values (user data) out of error messages and logs.
        hide_parameters=True,
    )
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    return engine


def _prepare_sqlite_file(path: Path) -> None:
    """Create the database file readable only by the current user, before SQLite does.

    SQLite gives its `-wal` and `-shm` files the same permissions as the database file.
    Existing directories and files keep their permissions.
    """
    if not path.parent.exists():
        path.parent.mkdir(mode=0o700, parents=True)
    path.touch(mode=0o600, exist_ok=True)


def _configure_sqlite_connection(
    dbapi_connection: DBAPIConnection, _record: ConnectionPoolEntry
) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL lets reads proceed during a write; NORMAL sync is durable in WAL mode.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute(f"PRAGMA busy_timeout={CONNECT_TIMEOUT_SECONDS * 1000}")
    finally:
        cursor.close()


def _create_postgres_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.postgres_url,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
        pool_recycle=POSTGRES_POOL_RECYCLE_SECONDS,
        connect_args={"timeout": CONNECT_TIMEOUT_SECONDS},
        hide_parameters=True,
    )
