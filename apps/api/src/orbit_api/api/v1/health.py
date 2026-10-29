"""Liveness and readiness endpoints."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from orbit_api import __version__
from orbit_api.api.dependencies import SessionDep
from orbit_api.config import StorageMode
from orbit_api.db.database import Database, check_connection

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


@router.get("/health", summary="Check API health")
def health() -> HealthResponse:
    """Return a minimal status payload. Contains no configuration or secrets."""
    return HealthResponse(status="ok", service="orbit-api", version=__version__)


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
