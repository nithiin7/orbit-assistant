"""Application factory and ASGI entry point."""

import asyncio
import logging
from collections.abc import AsyncGenerator, Sequence
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from orbit_api import __version__
from orbit_api.api.auth import Authenticator, LocalAuthenticator, SupabaseAuthenticator
from orbit_api.api.v1 import router as v1_router
from orbit_api.auth.passwords import Argon2PasswordHasher
from orbit_api.auth.supabase import SupabaseTokenVerifier
from orbit_api.config import Settings, get_settings
from orbit_api.db.database import open_database
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.system.file_manager import SystemFileRevealer

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
        stop = asyncio.Event()
        worker = None
        if settings.scheduler_embedded:
            worker = asyncio.create_task(
                ReminderWorker(database).run(stop, settings.scheduler_poll_seconds)
            )
        try:
            yield
        finally:
            # Let a poll in progress finish its transactions before closing the database.
            stop.set()
            if worker is not None:
                await worker
            await database.dispose()

    app = FastAPI(
        title="Orbit API",
        version=__version__,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.authenticator = _create_authenticator(settings)
    app.state.password_hasher = Argon2PasswordHasher()
    app.state.file_revealer = SystemFileRevealer()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for error in DATABASE_UNAVAILABLE_ERRORS:
        app.add_exception_handler(error, _database_unavailable)
    app.add_exception_handler(RequestValidationError, _validation_failed)
    app.include_router(v1_router)
    return app


def _create_authenticator(settings: Settings) -> Authenticator:
    """Local accounts in local mode, Supabase Auth in cloud mode. Never both."""
    if settings.storage_mode == "cloud":
        return SupabaseAuthenticator(SupabaseTokenVerifier(settings.supabase_base_url))
    return LocalAuthenticator()


async def _validation_failed(request: Request, exc: Exception) -> JSONResponse:
    # FastAPI's default response echoes the submitted values, which may include passwords.
    # Report where and why validation failed, never what was sent.
    errors: Sequence[dict[str, Any]] = (
        exc.errors() if isinstance(exc, RequestValidationError) else ()
    )
    detail = [{key: error.get(key) for key in ("loc", "msg", "type")} for error in errors]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(detail)})


async def _database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    # Deliberate boundary: log the cause server-side and return a generic 503 so connection
    # details never reach the client.
    logger.error(
        "Database unavailable during %s %s", request.method, request.url.path, exc_info=exc
    )
    return JSONResponse(status_code=503, content={"detail": "The database is unavailable."})


app = create_app()
