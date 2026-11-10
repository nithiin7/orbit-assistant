"""Bookmarks ("Saved" in the app) in a workspace. Every route authorizes the workspace through
`WorkspaceDep` first."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import BookmarkServiceDep
from orbit_api.schemas.bookmarks import (
    BookmarkCollectionResponse,
    BookmarkCollectionsResponse,
    BookmarkResponse,
    BookmarksResponse,
    CreateBookmarkCollectionRequest,
    CreateBookmarkRequest,
    UpdateBookmarkCollectionRequest,
    UpdateBookmarkRequest,
)
from orbit_api.services.bookmarks.models import (
    MAX_COLLECTIONS,
    BookmarkNotFoundError,
    CollectionNameTakenError,
    CollectionNotFoundError,
    DuplicateBookmarkError,
    TooManyCollectionsError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/bookmarks",
    tags=["bookmarks"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace, bookmark, or collection is not accessible."},
    },
)

BookmarkId = Annotated[uuid.UUID, Path(description="The bookmark's ID.")]
CollectionId = Annotated[uuid.UUID, Path(description="The collection's ID.")]


@contextmanager
def _bookmark_errors() -> Generator[None]:
    """Map service errors from bookmark routes to safe HTTP responses."""
    try:
        yield
    except BookmarkNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bookmark not found.") from None
    except DuplicateBookmarkError:
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already saved this link.") from None
    except CollectionNotFoundError:
        # The collection was named in the body, so it's a bad request rather than a missing
        # resource.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "That collection doesn't exist in this workspace.",
        ) from None


@contextmanager
def _collection_errors() -> Generator[None]:
    try:
        yield
    except CollectionNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found.") from None
    except CollectionNameTakenError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another collection already has that name."
        ) from None
    except TooManyCollectionsError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A workspace can have at most {MAX_COLLECTIONS} collections.",
        ) from None


# Bookmarks


@router.get("/items", summary="List bookmarks")
async def list_bookmarks(
    workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> BookmarksResponse:
    items = await bookmarks.bookmarks(workspace.id)
    return BookmarksResponse(bookmarks=[BookmarkResponse.of(item) for item in items])


@router.post(
    "/items",
    status_code=status.HTTP_201_CREATED,
    summary="Save a link",
    responses={409: {"description": "This URL is already saved."}},
)
async def create_bookmark(
    body: CreateBookmarkRequest, workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> BookmarkResponse:
    """Orbit never fetches the page: a missing title, kind, or status is worked out from the URL
    alone."""
    with _bookmark_errors():
        return BookmarkResponse.of(await bookmarks.add(workspace.id, body.to_draft()))


@router.get("/items/{bookmark_id}", summary="Get a bookmark")
async def get_bookmark(
    bookmark_id: BookmarkId, workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> BookmarkResponse:
    with _bookmark_errors():
        return BookmarkResponse.of(await bookmarks.get(workspace.id, bookmark_id))


@router.patch(
    "/items/{bookmark_id}",
    summary="Update a bookmark",
    responses={409: {"description": "Another bookmark has this URL."}},
)
async def update_bookmark(
    bookmark_id: BookmarkId,
    body: UpdateBookmarkRequest,
    workspace: WorkspaceDep,
    bookmarks: BookmarkServiceDep,
) -> BookmarkResponse:
    with _bookmark_errors():
        return BookmarkResponse.of(
            await bookmarks.update(workspace.id, bookmark_id, body.to_changes())
        )


@router.post("/items/{bookmark_id}/opened", summary="Record that a bookmark was opened")
async def record_open(
    bookmark_id: BookmarkId, workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> BookmarkResponse:
    """Counts opens so the most used bookmarks can be listed first."""
    with _bookmark_errors():
        return BookmarkResponse.of(await bookmarks.record_open(workspace.id, bookmark_id))


@router.delete(
    "/items/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a bookmark"
)
async def delete_bookmark(
    bookmark_id: BookmarkId, workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> Response:
    with _bookmark_errors():
        await bookmarks.delete(workspace.id, bookmark_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Collections


@router.get("/collections", summary="List bookmark collections")
async def list_collections(
    workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> BookmarkCollectionsResponse:
    """The workspace's collections, oldest first, each with its number of bookmarks."""
    overview = await bookmarks.collections(workspace.id)
    return BookmarkCollectionsResponse(
        collections=[BookmarkCollectionResponse.of_overview(entry) for entry in overview]
    )


@router.post(
    "/collections",
    status_code=status.HTTP_201_CREATED,
    summary="Create a bookmark collection",
    responses={409: {"description": "The name is taken, or there are too many collections."}},
)
async def create_collection(
    body: CreateBookmarkCollectionRequest, workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> BookmarkCollectionResponse:
    with _collection_errors():
        collection = await bookmarks.create_collection(workspace.id, body.name, body.color)
    return BookmarkCollectionResponse.of(collection, bookmarks=0)


@router.patch(
    "/collections/{collection_id}",
    summary="Rename or recolor a bookmark collection",
    responses={409: {"description": "The name is taken."}},
)
async def update_collection(
    collection_id: CollectionId,
    body: UpdateBookmarkCollectionRequest,
    workspace: WorkspaceDep,
    bookmarks: BookmarkServiceDep,
) -> BookmarkCollectionResponse:
    with _collection_errors():
        collection = await bookmarks.update_collection(
            workspace.id, collection_id, body.to_changes()
        )
    overview = await bookmarks.collections(workspace.id)
    count = next((e.bookmarks for e in overview if e.collection.id == collection.id), 0)
    return BookmarkCollectionResponse.of(collection, count)


@router.delete(
    "/collections/{collection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a bookmark collection",
)
async def delete_collection(
    collection_id: CollectionId, workspace: WorkspaceDep, bookmarks: BookmarkServiceDep
) -> Response:
    """Its bookmarks are kept, in no collection."""
    with _collection_errors():
        await bookmarks.delete_collection(workspace.id, collection_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
