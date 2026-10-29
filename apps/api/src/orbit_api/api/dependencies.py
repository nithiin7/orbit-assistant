"""FastAPI dependencies shared by routers."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.database import Database


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request, closed afterwards. Services commit explicitly; anything
    left uncommitted is rolled back when the session closes."""
    database: Database = request.app.state.database
    async with database.session() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
