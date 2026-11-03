"""Liveness and readiness endpoints, for deployment monitoring. None of them needs a session,
and none reveals configuration, paths, or connection details.

- `/health/live` (and `/health`): the process is serving requests. Restart it if this fails.
- `/health/ready`: it can do useful work: the database answers and its schema is the one this
  version expects. Send it traffic only while this succeeds.
- `/health/database`: the database answers a query.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from orbit_api import __version__
from orbit_api.api.dependencies import SessionDep
from orbit_api.config import StorageMode
from orbit_api.db.database import (
    Database,
    DatabaseSchemaError,
    DatabaseStartupError,
    check_connection,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Reports that the API process is running and able to serve requests."""

    status: Literal["ok"] = Field(description="Always `ok` when the API is serving requests.")
    service: Literal["orbit-api"] = Field(description="Name of the responding service.")
    version: str = Field(description="Version of the running API.")


class DatabaseHealthResponse(BaseModel):
    """Reports that the configured database is reachable."""

    status: Literal["ok"] = Field(description="Always `ok` when the database answered a query.")
    storage_mode: StorageMode = Field(
        description="`local` (SQLite on this machine) or `cloud` (hosted PostgreSQL)."
    )


CheckStatus = Literal["ok", "unavailable", "outdated"]


class ReadinessResponse(BaseModel):
    """Whether the API can serve requests that need its dependencies."""

    status: Literal["ok", "unavailable"]
    database: CheckStatus = Field(
        description="`ok`, `unavailable` (no answer), or `outdated` (needs `pnpm db:migrate`)."
    )


@router.get("/health", summary="Check API health")
def health() -> HealthResponse:
    """Return a minimal status payload. Contains no configuration or secrets."""
    return HealthResponse(status="ok", service="orbit-api", version=__version__)


@router.get("/health/live", summary="Check that the API process is alive")
def liveness() -> HealthResponse:
    """The same as `/health`: succeeds whenever the process can answer at all."""
    return health()


@router.get(
    "/health/ready",
    summary="Check that the API is ready to serve requests",
    response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse, "description": "A dependency is not ready."}},
)
async def readiness(request: Request) -> ReadinessResponse | JSONResponse:
    database: Database = request.app.state.database
    try:
        await database.verify()
    except DatabaseSchemaError:
        logger.warning("Not ready: the database schema is not at this version's revision.")
        return _not_ready("outdated")
    except DatabaseStartupError:
        logger.warning("Not ready: the database is unavailable.", exc_info=True)
        return _not_ready("unavailable")
    return ReadinessResponse(status="ok", database="ok")


def _not_ready(database: CheckStatus) -> JSONResponse:
    body = ReadinessResponse(status="unavailable", database=database)
    return JSONResponse(status_code=503, content=body.model_dump())


@router.get(
    "/health/database",
    summary="Check database connectivity",
    responses={503: {"description": "The database is unavailable."}},
)
async def database_health(request: Request, session: SessionDep) -> DatabaseHealthResponse:
    """Query the database. Reports the storage mode, never paths or connection details."""
    await check_connection(session)
    database: Database = request.app.state.database
    return DatabaseHealthResponse(status="ok", storage_mode=database.mode)
