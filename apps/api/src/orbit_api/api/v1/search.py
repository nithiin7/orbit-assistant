"""Search across a workspace's modules."""

from typing import Annotated

from fastapi import APIRouter, Query

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import SearchServiceDep
from orbit_api.schemas.search import SearchParams, SearchResponse

router = APIRouter(
    prefix="/workspaces/{workspace_id}/search",
    tags=["search"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace does not exist or is not accessible."},
    },
)


@router.get("", summary="Search tasks, notes, events, documents, habits, and transactions")
async def search(
    params: Annotated[SearchParams, Query()], workspace: WorkspaceDep, search: SearchServiceDep
) -> SearchResponse:
    """Each module's own substring search, grouped by module. Hits carry titles and an
    identifying line only: no amounts, document metadata, or document contents. Health
    records are not searched."""
    results = await search.search(workspace.id, params.q, params.limit, params.module or None)
    return SearchResponse.of(results)
