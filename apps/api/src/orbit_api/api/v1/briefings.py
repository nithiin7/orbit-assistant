"""Daily briefings: a structured snapshot of the signed-in person's day in a workspace."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import AiServicesDep, BriefingServiceDep
from orbit_api.api.v1.ai import ai_errors
from orbit_api.schemas.briefings import (
    BriefingDateParams,
    BriefingHistoryParams,
    BriefingHistoryResponse,
    BriefingParams,
    BriefingRegenerateRequest,
    BriefingResponse,
    BriefingSettingsBody,
)
from orbit_api.services.accounts.models import User
from orbit_api.services.briefings.models import BriefingNotFoundError, NothingToNarrateError
from orbit_api.services.briefings.narrative import BriefingNarrator

router = APIRouter(
    prefix="/workspaces/{workspace_id}/briefings",
    tags=["briefings"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace does not exist or is not accessible."},
    },
)


def _timezone(requested: str | None, user: User) -> str:
    return requested or user.timezone or "UTC"


@router.get("", summary="Earlier briefings, newest first")
async def history(
    params: Annotated[BriefingHistoryParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    briefings: BriefingServiceDep,
) -> BriefingHistoryResponse:
    """The person's briefings in this workspace, without their content."""
    page = await briefings.history(workspace.id, user.id, params.limit, params.offset)
    return BriefingHistoryResponse.of(page)


@router.get("/settings", summary="How your briefing is prepared")
async def get_settings(
    workspace: WorkspaceDep, user: CurrentUserDep, briefings: BriefingServiceDep
) -> BriefingSettingsBody:
    """Your settings in this workspace, or the defaults (7 days ahead, every module, prepared
    when opened)."""
    return BriefingSettingsBody.of(await briefings.settings(workspace.id, user.id))


@router.put("/settings", summary="Change how your briefing is prepared")
async def put_settings(
    body: BriefingSettingsBody,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    briefings: BriefingServiceDep,
) -> BriefingSettingsBody:
    """Applies from the next briefing prepared; regenerate today's to see it now. A
    preparation time uses your time zone preference, else UTC."""
    settings = await briefings.update_settings(workspace.id, user.id, body.to_settings())
    return BriefingSettingsBody.of(settings)


@router.get("/today", summary="Today's briefing, prepared if there isn't one yet")
async def today(
    params: Annotated[BriefingParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    briefings: BriefingServiceDep,
) -> BriefingResponse:
    """Today in the given time zone. The first request of the day prepares the briefing from
    each module; later ones return that same snapshot until it is regenerated. A module that
    can't be read is listed in `content.unavailable`, and the briefing is `partial`."""
    briefing = await briefings.today(workspace.id, user.id, _timezone(params.timezone, user))
    return BriefingResponse.of(briefing)


@router.post("/today/regenerate", summary="Prepare today's briefing again")
async def regenerate(
    body: BriefingRegenerateRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    briefings: BriefingServiceDep,
) -> BriefingResponse:
    """Replace today's snapshot with one read from the records as they are now. Earlier days
    can't be regenerated: they are kept as they were."""
    briefing = await briefings.regenerate(workspace.id, user.id, _timezone(body.timezone, user))
    return BriefingResponse.of(briefing)


@router.get(
    "/{briefing_date}",
    summary="The briefing prepared for a date",
    responses={404: {"description": "No briefing was prepared for that date."}},
)
async def on_date(
    briefing_date: date,
    params: Annotated[BriefingDateParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    briefings: BriefingServiceDep,
) -> BriefingResponse:
    """A stored briefing, exactly as it was prepared: the one for `timezone`, or without it the
    date's most recently prepared. Nothing is prepared here; use `/today`."""
    try:
        briefing = await briefings.get(workspace.id, user.id, briefing_date, params.timezone)
    except BriefingNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Briefing not found.") from None
    return BriefingResponse.of(briefing)


@router.post(
    "/{briefing_date}/narrative",
    summary="Write a summary of a briefing with AI",
    responses={
        404: {"description": "No briefing was prepared for that date."},
        409: {"description": "AI is off or not set up."},
        403: {"description": "AI may not read any of the briefing's modules."},
    },
)
async def narrate(
    briefing_date: date,
    params: Annotated[BriefingDateParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    briefings: BriefingServiceDep,
    ai: AiServicesDep,
) -> BriefingResponse:
    """A headline, a few sentences, and up to three priorities, written by your AI provider
    from the stored snapshot alone. The provider sees only modules Settings → AI allows, and
    never money amounts, health measurements, descriptions, or note content. The summary is
    kept with the briefing until it is regenerated."""
    narrator = BriefingNarrator(config=ai.config)
    try:
        with ai_errors():
            briefing = await briefings.narrate(
                workspace.id, user.id, briefing_date, params.timezone, narrator
            )
    except BriefingNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Briefing not found.") from None
    except NothingToNarrateError:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "AI isn't allowed to read any of this briefing's modules. Change it in Settings → AI.",
        ) from None
    return BriefingResponse.of(briefing)
