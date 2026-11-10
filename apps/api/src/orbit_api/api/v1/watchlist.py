"""The watchlist in a workspace. Every route authorizes the workspace through `WorkspaceDep`
first."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import WatchlistServiceDep
from orbit_api.schemas.watchlist import (
    CreateWatchItemRequest,
    PosterParams,
    TitleMatchesResponse,
    TitleMatchResponse,
    TitleSearchParams,
    UpdateWatchItemRequest,
    WatchItemResponse,
    WatchItemsResponse,
    WatchlistKeyRequest,
    WatchlistLookupRequest,
    WatchlistLookupResponse,
)
from orbit_api.services.ai.models import CredentialsUnavailableError
from orbit_api.services.watchlist.models import (
    CatalogAuthError,
    CatalogError,
    CatalogNotFoundError,
    DuplicateTitleError,
    InvalidWatchItemError,
    Poster,
    WatchItemNotFoundError,
)
from orbit_api.services.watchlist.service import LookupUnavailableError

router = APIRouter(
    prefix="/workspaces/{workspace_id}/watchlist",
    tags=["watchlist"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or title does not exist or is not accessible."},
    },
)

ItemId = Annotated[uuid.UUID, Path(description="The title's ID.")]

_IMAGE_CONTENT: dict[str, Any] = {"image/jpeg": {}, "image/png": {}}
_LOOKUP: dict[int | str, dict[str, Any]] = {
    409: {"description": "Title lookup is off for this workspace or server."},
    503: {"description": "TMDB couldn't be reached."},
}


@contextmanager
def _errors() -> Generator[None]:
    """Map service errors to safe HTTP responses."""
    try:
        yield
    except WatchItemNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Title not found.") from None
    except InvalidWatchItemError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except DuplicateTitleError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This title is already on your watchlist."
        ) from None
    except LookupUnavailableError as error:
        message = (
            "Title lookup is off. Turn it on in Settings → Watchlist."
            if error.configured
            else "Add a TMDB API key in Settings → Watchlist to look titles up."
        )
        raise HTTPException(status.HTTP_409_CONFLICT, message) from None
    except CredentialsUnavailableError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This server can't store API keys. Set ORBIT_AI_SECRET_KEY, then add the key again.",
        ) from None
    except CatalogAuthError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "TMDB didn't accept this API key. Check it and try again.",
        ) from None
    except CatalogNotFoundError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "TMDB doesn't have that title."
        ) from None
    except CatalogError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "TMDB couldn't be reached. Try again."
        ) from None


def _image(poster: Poster, cache: str) -> Response:
    return Response(
        content=poster.data,
        media_type=poster.content_type,
        headers={
            "Cache-Control": cache,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )


# Lookup


@router.get("/lookup", summary="Get the title lookup settings")
async def get_lookup(
    workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchlistLookupResponse:
    return WatchlistLookupResponse.of(await watchlist.lookup(workspace.id))


@router.put(
    "/lookup",
    summary="Turn title lookup on or off",
    responses={409: {"description": "No TMDB API key is saved yet."}},
)
async def update_lookup(
    body: WatchlistLookupRequest, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchlistLookupResponse:
    """With lookup on, this workspace sends search phrases and TMDB IDs to TMDB. Posters are
    downloaded by the server, never by the browser."""
    with _errors():
        return WatchlistLookupResponse.of(await watchlist.set_lookup(workspace.id, body.enabled))


@router.put(
    "/lookup/key",
    summary="Save the TMDB API key",
    responses={
        409: {"description": "The server can't store API keys."},
        422: {"description": "TMDB refused the key."},
        503: {"description": "TMDB couldn't be reached."},
    },
)
async def save_lookup_key(
    body: WatchlistKeyRequest, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchlistLookupResponse:
    """Checks the key with TMDB, stores it encrypted, and turns lookup on. The key is never
    returned."""
    with _errors():
        return WatchlistLookupResponse.of(await watchlist.save_key(workspace.id, body.api_key))


@router.delete("/lookup/key", summary="Remove the TMDB API key")
async def remove_lookup_key(
    workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchlistLookupResponse:
    """Turns lookup off. Titles and posters already added stay."""
    return WatchlistLookupResponse.of(await watchlist.remove_key(workspace.id))


@router.get("/search", summary="Find a movie or series at TMDB", responses=_LOOKUP)
async def search_titles(
    params: Annotated[TitleSearchParams, Query()],
    workspace: WorkspaceDep,
    watchlist: WatchlistServiceDep,
) -> TitleMatchesResponse:
    """Only the search phrase leaves the server."""
    with _errors():
        found = await watchlist.search(workspace.id, params.q)
    return TitleMatchesResponse(
        results=[TitleMatchResponse.of(match, existing) for match, existing in found]
    )


@router.get(
    "/search/poster",
    summary="Get a search result's poster thumbnail",
    response_class=Response,
    responses={200: {"content": _IMAGE_CONTENT, "description": "The thumbnail."}, **_LOOKUP},
)
async def search_poster(
    params: Annotated[PosterParams, Query()],
    workspace: WorkspaceDep,
    watchlist: WatchlistServiceDep,
) -> Response:
    """Fetched through the server, so the browser never contacts TMDB."""
    try:
        with _errors():
            poster = await watchlist.search_poster(workspace.id, params.path)
    except HTTPException as error:
        if error.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Poster not found.") from None
        raise
    return _image(poster, "private, max-age=86400")


# Titles


@router.get("/items", summary="List the watchlist")
async def list_items(workspace: WorkspaceDep, watchlist: WatchlistServiceDep) -> WatchItemsResponse:
    items = await watchlist.items(workspace.id)
    return WatchItemsResponse(items=[WatchItemResponse.of(item) for item in items])


@router.post(
    "/items",
    status_code=status.HTTP_201_CREATED,
    summary="Add a title",
    responses={
        409: {"description": "Already added, or lookup is off."},
        503: {"description": "TMDB couldn't be reached."},
    },
)
async def add_item(
    body: CreateWatchItemRequest, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchItemResponse:
    """With `source_id`, the title, details, and poster come from TMDB; otherwise from the
    request."""
    with _errors():
        if body.source_id is not None:
            item = await watchlist.add_from_lookup(
                workspace.id, body.kind, body.source_id, body.to_draft()
            )
        else:
            item = await watchlist.add(workspace.id, body.to_draft())
    return WatchItemResponse.of(item)


@router.get("/items/{item_id}", summary="Get a title")
async def get_item(
    item_id: ItemId, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchItemResponse:
    with _errors():
        return WatchItemResponse.of(await watchlist.get(workspace.id, item_id))


@router.patch("/items/{item_id}", summary="Update a title")
async def update_item(
    item_id: ItemId,
    body: UpdateWatchItemRequest,
    workspace: WorkspaceDep,
    watchlist: WatchlistServiceDep,
) -> WatchItemResponse:
    with _errors():
        return WatchItemResponse.of(
            await watchlist.update(workspace.id, item_id, body.to_changes())
        )


@router.post("/items/{item_id}/next-episode", summary="Log the next episode of a series")
async def next_episode(
    item_id: ItemId, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchItemResponse:
    """Starts the series if it hasn't started; logging its last known episode marks it
    watched."""
    with _errors():
        return WatchItemResponse.of(await watchlist.next_episode(workspace.id, item_id))


@router.post("/items/{item_id}/move-to-top", summary="Make a title the next to watch")
async def move_to_top(
    item_id: ItemId, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchItemResponse:
    with _errors():
        return WatchItemResponse.of(await watchlist.move_to_top(workspace.id, item_id))


@router.post("/items/{item_id}/refresh", summary="Fetch a title's details again", responses=_LOOKUP)
async def refresh_item(
    item_id: ItemId, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> WatchItemResponse:
    """For a series that gained a season. Only for titles added from a search."""
    with _errors():
        return WatchItemResponse.of(await watchlist.refresh(workspace.id, item_id))


@router.get(
    "/items/{item_id}/poster",
    summary="Get a title's poster",
    response_class=Response,
    responses={
        200: {"content": _IMAGE_CONTENT, "description": "The poster."},
        204: {"description": "The title has no poster."},
    },
)
async def get_poster(
    item_id: ItemId, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> Response:
    with _errors():
        poster = await watchlist.poster(workspace.id, item_id)
    if poster is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return _image(poster, "private, max-age=604800")


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove a title")
async def delete_item(
    item_id: ItemId, workspace: WorkspaceDep, watchlist: WatchlistServiceDep
) -> Response:
    """Permanently remove a title and its poster."""
    with _errors():
        await watchlist.delete(workspace.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
