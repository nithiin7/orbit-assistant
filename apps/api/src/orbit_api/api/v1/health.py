"""Liveness endpoint."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from orbit_api import __version__

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Reports that the API process is running and able to serve requests."""

    status: Literal["ok"] = Field(description="Always `ok` when the API is serving requests.")
    service: Literal["orbit-api"] = Field(description="Name of the responding service.")
    version: str = Field(description="Version of the running API.")


@router.get("/health", summary="Check API health")
def health() -> HealthResponse:
    """Return a minimal status payload. Contains no configuration or secrets."""
    return HealthResponse(status="ok", service="orbit-api", version=__version__)
