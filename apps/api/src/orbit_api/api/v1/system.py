"""The installation's status page and update notices, for people who self-host.

Server-wide rather than per workspace: any signed-in person can see them and turn update checks
on or off, which changes only whether the server asks GitHub for the latest release.
"""

from dataclasses import asdict
from datetime import timedelta

from fastapi import APIRouter, Request

from orbit_api.api.auth import CurrentUserDep
from orbit_api.api.dependencies import SettingsDep, SystemServiceDep
from orbit_api.db.database import Database
from orbit_api.db.migrate import head_revision
from orbit_api.schemas.system import (
    SystemDatabaseStatus,
    SystemFeatures,
    SystemSettingsRequest,
    SystemStatusResponse,
    SystemWorkerStatus,
    UpdateStatusResponse,
)
from orbit_api.services.system.models import ServerFeatures, UpdateStatus

router = APIRouter(
    prefix="/system", tags=["system"], responses={401: {"description": "Not signed in."}}
)


@router.get("/status", summary="Get the installation's status")
async def get_system_status(
    request: Request, _user: CurrentUserDep, settings: SettingsDep, system: SystemServiceDep
) -> SystemStatusResponse:
    """Version, database schema, reminder worker, and which optional parts are configured."""
    database: Database = request.app.state.database
    push_public_key: str | None = request.app.state.push_sender.public_key()
    status = await system.status(
        storage_mode=database.mode,
        started_at=request.app.state.started_at,
        expected_revision=head_revision(),
        worker_in_api=settings.scheduler_embedded,
        poll_interval=timedelta(seconds=settings.scheduler_poll_seconds),
        features=ServerFeatures(
            ai=settings.ai_enabled,
            agent=settings.agent_enabled,
            web_push=push_public_key is not None,
            google=settings.google_client_id is not None,
            microsoft=settings.microsoft_client_id is not None,
            online_maps=settings.online_maps_enabled,
        ),
    )
    return SystemStatusResponse(
        version=status.version,
        storage_mode=status.storage_mode,
        started_at=status.started_at,
        database=SystemDatabaseStatus(
            status=status.database.state,
            revision=status.database.revision,
            expected_revision=status.database.expected_revision,
        ),
        worker=SystemWorkerStatus(
            runs_in_api=status.worker.runs_in_api, status=status.worker.state
        ),
        features=SystemFeatures(**asdict(status.features)),
    )


@router.get("/update", summary="Get the update notice")
async def get_update_status(
    _user: CurrentUserDep, system: SystemServiceDep
) -> UpdateStatusResponse:
    """With update checks on, asks GitHub when the last answer is a day old (an hour after a
    failure). A failed check is reported in the result, not as an error."""
    return _update_response(await system.update_status())


@router.post("/update/check", summary="Check for updates now")
async def check_for_updates(
    _user: CurrentUserDep, system: SystemServiceDep
) -> UpdateStatusResponse:
    """Asks GitHub now, unless it was asked in the last minute. Does nothing while update
    checks are off."""
    return _update_response(await system.update_status(check_now=True))


@router.put("/settings", summary="Change the server-wide settings")
async def update_system_settings(
    body: SystemSettingsRequest, _user: CurrentUserDep, system: SystemServiceDep
) -> UpdateStatusResponse:
    """Turning update checks on asks GitHub right away; GitHub sees the server's address."""
    return _update_response(await system.set_update_check_enabled(body.update_check_enabled))


def _update_response(status: UpdateStatus) -> UpdateStatusResponse:
    return UpdateStatusResponse(**asdict(status))
