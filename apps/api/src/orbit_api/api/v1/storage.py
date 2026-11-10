"""Where the API stores data, and opening that folder on the API's machine (local mode)."""

from fastapi import APIRouter, HTTPException, Response, status

from orbit_api.api.auth import CurrentUserDep
from orbit_api.api.dependencies import FileRevealerDep, SettingsDep, exposes_local_paths
from orbit_api.schemas.storage import StorageLocationResponse
from orbit_api.system.file_manager import FileManagerUnavailableError

router = APIRouter(
    prefix="/storage", tags=["storage"], responses={401: {"description": "Not signed in."}}
)


@router.get("", summary="Get the storage location")
async def get_storage_location(
    _user: CurrentUserDep, settings: SettingsDep
) -> StorageLocationResponse:
    exposed = exposes_local_paths(settings)
    return StorageLocationResponse(
        storage_mode=settings.storage_mode,
        database_path=str(settings.sqlite_path) if exposed else None,
        can_reveal=exposed,
    )


@router.post(
    "/reveal",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Show the database in the file manager",
    responses={
        404: {"description": "Not available in cloud mode or in production."},
        503: {"description": "No file manager could be opened on the API's machine."},
    },
)
def reveal_storage_location(
    _user: CurrentUserDep,
    settings: SettingsDep,
    revealer: FileRevealerDep,
) -> Response:
    """Opens Finder, File Explorer, or the desktop file manager on the machine running the API,
    which in local mode is the user's own computer. Sync, so the spawn runs off the event loop."""
    if not exposes_local_paths(settings):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no local database folder to open.")
    try:
        revealer.reveal(settings.sqlite_path)
    except FileManagerUnavailableError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Could not open a file manager on the machine running the Orbit API.",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
