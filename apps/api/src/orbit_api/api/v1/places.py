"""Places in a workspace: where you've been and where you want to go. Every route authorizes the
workspace through `WorkspaceDep` first."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import PlaceServiceDep, SettingsDep
from orbit_api.schemas.places import (
    CreatePlaceRequest,
    PlaceMatchesResponse,
    PlaceMatchResponse,
    PlaceResponse,
    PlaceSearchRequest,
    PlaceSettingsRequest,
    PlaceSettingsResponse,
    PlacesResponse,
    UpdatePlaceRequest,
)
from orbit_api.services.places.models import (
    OnlineMapsOffError,
    PlaceNotFoundError,
    PlaceSearchError,
    VisitDateError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/places",
    tags=["places"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or place is not accessible."},
    },
)

PlaceId = Annotated[uuid.UUID, Path(description="The place's ID.")]


@contextmanager
def _place_errors() -> Generator[None]:
    """Map service errors from place routes to safe HTTP responses."""
    try:
        yield
    except PlaceNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Place not found.") from None
    except VisitDateError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Only visited places have a visit date.",
        ) from None
    except OnlineMapsOffError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Online maps are off. Turn them on in Settings → Places.",
        ) from None
    except PlaceSearchError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Place search isn't responding. Try again shortly."
        ) from None


# Settings


async def _settings(
    workspace_id: uuid.UUID, places: PlaceServiceDep, settings: SettingsDep
) -> PlaceSettingsResponse:
    online = await places.online_maps(workspace_id)
    return PlaceSettingsResponse(
        online_maps=online,
        online_maps_allowed=places.online_maps_allowed,
        map_style_url=str(settings.map_style_url) if online else None,
    )


@router.get("/settings", summary="Get the Places settings")
async def get_settings(
    workspace: WorkspaceDep, places: PlaceServiceDep, settings: SettingsDep
) -> PlaceSettingsResponse:
    return await _settings(workspace.id, places, settings)


@router.put(
    "/settings",
    summary="Change the Places settings",
    responses={409: {"description": "This server doesn't allow online maps."}},
)
async def update_settings(
    body: PlaceSettingsRequest,
    workspace: WorkspaceDep,
    places: PlaceServiceDep,
    settings: SettingsDep,
) -> PlaceSettingsResponse:
    """With online maps on, the browser loads map tiles from the map server (which sees the
    areas viewed), and place search sends the search phrase to the geocoder."""
    with _place_errors():
        await places.set_online_maps(workspace.id, body.online_maps)
    return await _settings(workspace.id, places, settings)


# Place search


@router.post(
    "/search",
    summary="Look up a place by name",
    responses={
        409: {"description": "Online maps are off for this workspace."},
        502: {"description": "The geocoder failed."},
    },
)
async def search_places(
    body: PlaceSearchRequest, workspace: WorkspaceDep, places: PlaceServiceDep
) -> PlaceMatchesResponse:
    """Sends only the search phrase to the geocoder. Results aren't saved; pick one to add it."""
    with _place_errors():
        matches = await places.search(workspace.id, body.query)
    return PlaceMatchesResponse(matches=[PlaceMatchResponse.of(match) for match in matches])


# Places


@router.get("/items", summary="List places")
async def list_places(workspace: WorkspaceDep, places: PlaceServiceDep) -> PlacesResponse:
    items = await places.places(workspace.id)
    return PlacesResponse(places=[PlaceResponse.of(item) for item in items])


@router.post("/items", status_code=status.HTTP_201_CREATED, summary="Add a place")
async def create_place(
    body: CreatePlaceRequest, workspace: WorkspaceDep, places: PlaceServiceDep
) -> PlaceResponse:
    with _place_errors():
        return PlaceResponse.of(await places.add(workspace.id, body.to_draft()))


@router.get("/items/{place_id}", summary="Get a place")
async def get_place(
    place_id: PlaceId, workspace: WorkspaceDep, places: PlaceServiceDep
) -> PlaceResponse:
    with _place_errors():
        return PlaceResponse.of(await places.get(workspace.id, place_id))


@router.patch("/items/{place_id}", summary="Update a place")
async def update_place(
    place_id: PlaceId, body: UpdatePlaceRequest, workspace: WorkspaceDep, places: PlaceServiceDep
) -> PlaceResponse:
    with _place_errors():
        return PlaceResponse.of(await places.update(workspace.id, place_id, body.to_changes()))


@router.delete(
    "/items/{place_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a place"
)
async def delete_place(
    place_id: PlaceId, workspace: WorkspaceDep, places: PlaceServiceDep
) -> Response:
    with _place_errors():
        await places.delete(workspace.id, place_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
