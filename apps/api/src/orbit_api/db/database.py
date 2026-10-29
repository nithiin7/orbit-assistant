"""Opening, verifying, and closing the database for the selected storage mode."""

import logging

from alembic.runtime.migration import MigrationContext
from sqlalchemy import Connection, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from orbit_api.config import Settings, StorageMode
from orbit_api.db.engine import create_engine, describe_target
from orbit_api.db.migrate import head_revision

logger = logging.getLogger(__name__)


class DatabaseStartupError(RuntimeError):
    """The configured database cannot be used. The API must not start."""


class DatabaseUnavailableError(DatabaseStartupError):
    """The configured database could not be opened or reached."""


class DatabaseSchemaError(DatabaseStartupError):
    """The database schema is not at the revision this code expects."""


class Database:
    """The engine and session factory for one storage mode."""

    def __init__(self, engine: AsyncEngine, mode: StorageMode, target: str) -> None:
        self.engine = engine
        self.mode: StorageMode = mode
        self.target = target
        # Objects stay readable after commit; sessions are short-lived (one per request).
        self._sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    def session(self) -> AsyncSession:
        """A new session. Use it as `async with`; uncommitted work is rolled back on close."""
        return self._sessionmaker()

    async def verify(self) -> None:
        """Fail unless the database is reachable and its schema is fully migrated."""
        try:
            async with self.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
                current = await connection.run_sync(_current_revision)
        except (SQLAlchemyError, OSError) as exc:
            raise DatabaseUnavailableError(
                f"Could not connect to the {self.mode} database ({self.target})."
            ) from exc

        expected = head_revision()
        if current != expected:
            raise DatabaseSchemaError(
                f"The {self.mode} database ({self.target}) is at schema revision {current}, "
                f"but this version of Orbit expects {expected}. Run `pnpm db:migrate`."
            )

    async def dispose(self) -> None:
        await self.engine.dispose()


async def open_database(settings: Settings) -> Database:
    """Open and verify the database selected by `settings`, or raise `DatabaseStartupError`."""
    target = describe_target(settings)
    try:
        engine = create_engine(settings)
    except OSError as exc:
        raise DatabaseUnavailableError(f"Could not open the {target}.") from exc

    database = Database(engine, settings.storage_mode, target)
    try:
        await database.verify()
    except BaseException:
        await database.dispose()
        raise
    logger.info("Storage mode: %s. Using the %s.", settings.storage_mode, target)
    return database


async def check_connection(session: AsyncSession) -> None:
    """Run a trivial query, raising SQLAlchemy errors if the database is unreachable."""
    await session.execute(text("SELECT 1"))


def _current_revision(connection: Connection) -> str | None:
    return MigrationContext.configure(connection).get_current_revision()
