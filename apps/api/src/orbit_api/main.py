"""Application factory and ASGI entry point."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from orbit_api import __version__
from orbit_api.api.v1 import router as v1_router
from orbit_api.config import Settings, get_settings
from orbit_api.db.database import open_database

logger = logging.getLogger(__name__)

# Errors meaning the database could not be reached, as opposed to bugs in a query. asyncpg
# raises the built-in ConnectionError/TimeoutError (unwrapped by SQLAlchemy) when it cannot
# connect; the database is currently the API's only network dependency.
DATABASE_UNAVAILABLE_ERRORS = (
    OperationalError,
    InterfaceError,
    PoolTimeoutError,
    ConnectionError,
    TimeoutError,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application from the given (or environment) settings."""
    settings = settings or get_settings()
    # Interactive API docs are a development aid; they are not served in production.
    docs_enabled = not settings.is_production

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        # Fails startup if the selected database is unusable. There is deliberately no
        # fallback to another storage mode.
        database = await open_database(settings)
        app.state.database = database
        try:
            yield
        finally:
            await database.dispose()

    app = FastAPI(
        title="Orbit API",
        version=__version__,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for error in DATABASE_UNAVAILABLE_ERRORS:
        app.add_exception_handler(error, _database_unavailable)
    app.include_router(v1_router)
    return app


async def _database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    # Deliberate boundary: log the cause server-side and return a generic 503 so connection
    # details never reach the client.
    logger.error(
        "Database unavailable during %s %s", request.method, request.url.path, exc_info=exc
    )
    return JSONResponse(status_code=503, content={"detail": "The database is unavailable."})


app = create_app()
