"""The dashboard's daily overview for a workspace. The layout itself is per user (`/me`)."""

from typing import Annotated

from fastapi import APIRouter, Query

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import DailyOverviewServiceDep
from orbit_api.schemas.dashboard import TodayOverviewParams, TodayOverviewResponse

router = APIRouter(
    prefix="/workspaces/{workspace_id}/dashboard",
    tags=["dashboard"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace does not exist or is not accessible."},
    },
)


@router.get("/today", summary="What needs attention today, across modules")
async def today(
    params: Annotated[TodayOverviewParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    overview: DailyOverviewServiceDep,
) -> TodayOverviewResponse:
    """Counts and the first few items from tasks, the calendar, reminders, habits, documents,
    and payments, for today in the user's time zone. A module that fails to load is listed in
    `unavailable` and the rest still answer. Amounts and health data are never included."""
    timezone = params.timezone or user.timezone or "UTC"
    result = await overview.today(workspace.id, timezone, params.section or None)
    return TodayOverviewResponse.of(result)
