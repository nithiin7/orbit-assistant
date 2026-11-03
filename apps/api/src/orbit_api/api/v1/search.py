"""Search across a workspace's modules: the grouped search, universal search, and each person's
recent and saved searches."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import SearchHistoryDep, SearchServiceDep, UniversalSearchDep
from orbit_api.schemas.search import (
    RecentSearchListResponse,
    RecentSearchRequest,
    RecentSearchResponse,
    SavedSearchCreateRequest,
    SavedSearchListResponse,
    SavedSearchResponse,
    SavedSearchUpdateRequest,
    SearchParams,
    SearchResponse,
    UniversalSearchParams,
    UniversalSearchResponse,
)
from orbit_api.services.search.history import (
    SAVED_LIMIT,
    DuplicateSavedSearchError,
    SavedSearchLimitError,
    SavedSearchNotFoundError,
)
from orbit_api.services.search.universal_models import SearchScope

router = APIRouter(
    prefix="/workspaces/{workspace_id}/search",
    tags=["search"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace does not exist or is not accessible."},
    },
)

# Results and history are personal: no shared or browser cache may keep them.
_PRIVATE = "private, no-store"

SavedSearchId = Annotated[uuid.UUID, Path(description="A saved search's ID.")]
RecentSearchId = Annotated[uuid.UUID, Path(description="A recent search's ID.")]


def _saved_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Saved search not found.")


@router.get("", summary="Search tasks, notes, events, documents, habits, and transactions")
async def search(
    params: Annotated[SearchParams, Query()], workspace: WorkspaceDep, search: SearchServiceDep
) -> SearchResponse:
    """Each module's own substring search, grouped by module. Hits carry titles and an
    identifying line only: no amounts, document metadata, or document contents. Health
    records are not searched. Universal search (`/search/results`) covers every module."""
    results = await search.search(workspace.id, params.q, params.limit, params.module or None)
    return SearchResponse.of(results)


@router.get("/results", summary="Search every module, ranked, filtered, and paged")
async def universal_search(
    params: Annotated[UniversalSearchParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    search: UniversalSearchDep,
    response: Response,
) -> UniversalSearchResponse:
    """One ranked list across tasks, notes, calendar, reminders, finance, habits, documents,
    and the signed-in person's own health records, with per-module counts. A module that fails
    is listed in `unavailable`; the rest still answer. Hits carry no amounts, balances,
    measurement values, or sensitive document metadata."""
    results = await search.search(
        SearchScope(workspace_id=workspace.id, user_id=user.id), params.to_query()
    )
    response.headers["Cache-Control"] = _PRIVATE
    return UniversalSearchResponse.of(results)


@router.get("/recent", summary="List my recent searches")
async def recent_searches(
    workspace: WorkspaceDep, user: CurrentUserDep, history: SearchHistoryDep, response: Response
) -> RecentSearchListResponse:
    """The signed-in person's last searches in this workspace, most recent first."""
    searches = await history.recent(user.id, workspace.id)
    response.headers["Cache-Control"] = _PRIVATE
    return RecentSearchListResponse(searches=[RecentSearchResponse.of(s) for s in searches])


@router.post("/recent", status_code=status.HTTP_201_CREATED, summary="Remember a search")
async def record_recent_search(
    body: RecentSearchRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    history: SearchHistoryDep,
) -> RecentSearchResponse:
    """Called when the person commits to a search (not as they type). An equal search moves to
    the top; only the last few are kept."""
    return RecentSearchResponse.of(await history.record(user.id, workspace.id, body.query))


@router.delete(
    "/recent", status_code=status.HTTP_204_NO_CONTENT, summary="Clear my recent searches"
)
async def clear_recent_searches(
    workspace: WorkspaceDep, user: CurrentUserDep, history: SearchHistoryDep
) -> Response:
    await history.clear(user.id, workspace.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/recent/{search_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Forget one recent search",
)
async def forget_recent_search(
    search_id: RecentSearchId,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    history: SearchHistoryDep,
) -> Response:
    """Idempotent: a search that is already gone is not an error."""
    await history.forget(user.id, workspace.id, search_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/saved", summary="List my saved searches")
async def saved_searches(
    workspace: WorkspaceDep, user: CurrentUserDep, history: SearchHistoryDep, response: Response
) -> SavedSearchListResponse:
    searches = await history.saved(user.id, workspace.id)
    response.headers["Cache-Control"] = _PRIVATE
    return SavedSearchListResponse(searches=[SavedSearchResponse.of(s) for s in searches])


@router.post(
    "/saved",
    status_code=status.HTTP_201_CREATED,
    summary="Save a search",
    responses={409: {"description": "A saved search has this name, or there are too many."}},
)
async def save_search(
    body: SavedSearchCreateRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    history: SearchHistoryDep,
) -> SavedSearchResponse:
    try:
        saved = await history.save(
            user.id,
            workspace.id,
            name=body.name,
            query=body.query,
            filters=body.filters.model_dump(mode="json"),
        )
    except DuplicateSavedSearchError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A saved search already has this name."
        ) from None
    except SavedSearchLimitError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"You can save up to {SAVED_LIMIT} searches."
        ) from None
    return SavedSearchResponse.of(saved)


@router.patch(
    "/saved/{search_id}",
    summary="Rename or change a saved search",
    responses={409: {"description": "Another saved search has this name."}},
)
async def update_saved_search(
    search_id: SavedSearchId,
    body: SavedSearchUpdateRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    history: SearchHistoryDep,
) -> SavedSearchResponse:
    try:
        saved = await history.update(
            user.id,
            workspace.id,
            search_id,
            name=body.name,
            query=body.query,
            filters=None if body.filters is None else body.filters.model_dump(mode="json"),
        )
    except SavedSearchNotFoundError:
        raise _saved_not_found() from None
    except DuplicateSavedSearchError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A saved search already has this name."
        ) from None
    return SavedSearchResponse.of(saved)


@router.delete(
    "/saved/{search_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a saved search"
)
async def delete_saved_search(
    search_id: SavedSearchId,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    history: SearchHistoryDep,
) -> Response:
    try:
        await history.delete(user.id, workspace.id, search_id)
    except SavedSearchNotFoundError:
        raise _saved_not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
