"""Version 1 of the HTTP API, mounted under `/api/v1`."""

from fastapi import APIRouter

from orbit_api.api.v1 import (
    agent,
    ai,
    auth,
    backups,
    budgets,
    calendar,
    commitments,
    dashboard,
    documents,
    finance,
    fitness,
    goals,
    habits,
    health,
    integrations,
    investments,
    me,
    networth,
    notes,
    notifications,
    planning,
    reminders,
    search,
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
router.include_router(backups.router)
router.include_router(tasks.router)
router.include_router(shopping.router)
router.include_router(reminders.router)
router.include_router(finance.router)
router.include_router(commitments.router)
router.include_router(investments.router)
router.include_router(networth.router)
router.include_router(budgets.router)
router.include_router(goals.router)
router.include_router(planning.router)
router.include_router(notes.router)
router.include_router(calendar.router)
router.include_router(calendar.preferences_router)
router.include_router(habits.router)
router.include_router(habits.routines_router)
router.include_router(documents.router)
router.include_router(fitness.router)
router.include_router(dashboard.router)
router.include_router(search.router)
router.include_router(storage.router)
router.include_router(agent.router)
router.include_router(ai.me_router)
router.include_router(ai.router)
router.include_router(integrations.router)
router.include_router(integrations.oauth_router)
router.include_router(integrations.webhook_router)
