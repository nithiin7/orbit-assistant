"""The SQLAlchemy implementation of the services' `Transaction` protocol."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.services.transactions import ConflictError


async def flush(session: AsyncSession) -> None:
    """Send pending writes, reporting constraint violations as `ConflictError`."""
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError from exc


class SqlTransaction:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def commit(self) -> None:
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ConflictError from exc

    async def rollback(self) -> None:
        await self._session.rollback()
