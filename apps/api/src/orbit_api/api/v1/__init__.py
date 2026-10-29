"""Version 1 of the HTTP API, mounted under `/api/v1`."""

from fastapi import APIRouter

from orbit_api.api.v1 import (
    auth,
    health,
    me,
    notifications,
    reminders,
    shopping,
    storage,
    tasks,
    workspaces,
)

router = APIRouter(prefix="/api/v1")
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(me.router)
router.include_router(notifications.router)
router.include_router(workspaces.router)
router.include_router(tasks.router)
router.include_router(shopping.router)
router.include_router(reminders.router)
router.include_router(storage.router)
