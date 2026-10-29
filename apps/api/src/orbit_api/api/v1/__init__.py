"""Version 1 of the HTTP API, mounted under `/api/v1`."""

from fastapi import APIRouter

from orbit_api.api.v1 import health

router = APIRouter(prefix="/api/v1")
router.include_router(health.router)
