"""Bookmarks ("Saved" in the app): pages, videos, and reels saved for quick navigation or to
read and watch later, optionally grouped into collections and tagged.

Orbit never contacts a saved page; a missing title or kind is worked out from the URL alone.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it.
"""

import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from orbit_api.services.bookmarks.models import (
    MAX_COLLECTIONS,
    Bookmark,
    BookmarkChanges,
    BookmarkCollection,
    BookmarkDraft,
    BookmarkNotFoundError,
    CollectionChanges,
    CollectionColor,
    CollectionNameTakenError,
    CollectionNotFoundError,
    CollectionOverview,
    DuplicateBookmarkError,
    TooManyCollectionsError,
)
from orbit_api.services.bookmarks.urls import default_status, default_title, guess_kind
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now


class BookmarkRepository(Protocol):
    async def all(self, workspace_id: uuid.UUID) -> list[Bookmark]:
        """Every bookmark in the workspace, newest first."""
        ...

    async def get(self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID) -> Bookmark | None:
        """The bookmark, only if it belongs to `workspace_id`."""
        ...

    async def find_url(self, workspace_id: uuid.UUID, url: str) -> uuid.UUID | None:
        """The ID of the workspace's bookmark with exactly this URL, if there is one."""
        ...

    async def add(self, bookmark: Bookmark) -> None: ...

    async def save(self, bookmark: Bookmark) -> None:
        """Store an existing bookmark's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID) -> bool:
        """Delete the bookmark if it belongs to `workspace_id`; report whether it existed."""
        ...

    async def collections(self, workspace_id: uuid.UUID) -> list[CollectionOverview]:
        """The workspace's collections in `position` order, each with its bookmark count."""
        ...

    async def get_collection(
        self, workspace_id: uuid.UUID, collection_id: uuid.UUID
    ) -> BookmarkCollection | None: ...

    async def add_collection(self, collection: BookmarkCollection) -> None: ...

    async def save_collection(self, collection: BookmarkCollection) -> None: ...

    async def delete_collection(self, workspace_id: uuid.UUID, collection_id: uuid.UUID) -> bool:
        """Take the collection's bookmarks out of it, then delete it; report whether it
        existed."""
        ...


class BookmarkService:
    def __init__(
        self,
        bookmarks: BookmarkRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._bookmarks = bookmarks
        self._transaction = transaction
        self._clock = clock

    # Bookmarks

    async def bookmarks(self, workspace_id: uuid.UUID) -> list[Bookmark]:
        return await self._bookmarks.all(workspace_id)

    async def get(self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID) -> Bookmark:
        bookmark = await self._bookmarks.get(workspace_id, bookmark_id)
        if bookmark is None:
            raise BookmarkNotFoundError
        return bookmark

    async def add(self, workspace_id: uuid.UUID, draft: BookmarkDraft) -> Bookmark:
        """Save a URL. Raises `DuplicateBookmarkError` if the workspace already has it."""
        await self._check_unique(workspace_id, draft.url, None)
        await self._check_collection(workspace_id, draft.collection_id)
        kind = draft.kind or guess_kind(draft.url)
        now = self._clock()
        bookmark = Bookmark(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            collection_id=draft.collection_id,
            url=draft.url,
            title=draft.title or default_title(draft.url),
            note=draft.note,
            kind=kind,
            status=draft.status or default_status(kind),
            tags=_tags(draft.tags),
            pinned=draft.pinned,
            open_count=0,
            last_opened_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._bookmarks.add(bookmark)
        await self._transaction.commit()
        return bookmark

    async def update(
        self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID, changes: BookmarkChanges
    ) -> Bookmark:
        bookmark = await self.get(workspace_id, bookmark_id)
        if changes.url is not UNSET and changes.url != bookmark.url:
            await self._check_unique(workspace_id, changes.url, bookmark_id)
        if changes.collection_id is not UNSET:
            await self._check_collection(workspace_id, changes.collection_id)
        updated = replace(
            bookmark,
            url=bookmark.url if changes.url is UNSET else changes.url,
            title=bookmark.title if changes.title is UNSET else changes.title,
            note=bookmark.note if changes.note is UNSET else changes.note,
            kind=bookmark.kind if changes.kind is UNSET else changes.kind,
            status=bookmark.status if changes.status is UNSET else changes.status,
            tags=bookmark.tags if changes.tags is UNSET else _tags(changes.tags),
            pinned=bookmark.pinned if changes.pinned is UNSET else changes.pinned,
            collection_id=bookmark.collection_id
            if changes.collection_id is UNSET
            else changes.collection_id,
        )
        if updated == bookmark:
            return bookmark
        updated = replace(updated, updated_at=self._clock())
        await self._bookmarks.save(updated)
        await self._transaction.commit()
        return updated

    async def record_open(self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID) -> Bookmark:
        """Count an open, so the most used bookmarks can be listed first. Doesn't change
        `updated_at`: opening isn't editing."""
        bookmark = await self.get(workspace_id, bookmark_id)
        opened = replace(bookmark, open_count=bookmark.open_count + 1, last_opened_at=self._clock())
        await self._bookmarks.save(opened)
        await self._transaction.commit()
        return opened

    async def delete(self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID) -> None:
        if not await self._bookmarks.delete(workspace_id, bookmark_id):
            raise BookmarkNotFoundError
        await self._transaction.commit()

    async def _check_unique(
        self, workspace_id: uuid.UUID, url: str, own_id: uuid.UUID | None
    ) -> None:
        existing = await self._bookmarks.find_url(workspace_id, url)
        if existing is not None and existing != own_id:
            raise DuplicateBookmarkError(existing)

    async def _check_collection(
        self, workspace_id: uuid.UUID, collection_id: uuid.UUID | None
    ) -> None:
        if (
            collection_id is not None
            and await self._bookmarks.get_collection(workspace_id, collection_id) is None
        ):
            raise CollectionNotFoundError

    # Collections

    async def collections(self, workspace_id: uuid.UUID) -> list[CollectionOverview]:
        return await self._bookmarks.collections(workspace_id)

    async def create_collection(
        self, workspace_id: uuid.UUID, name: str, color: CollectionColor
    ) -> BookmarkCollection:
        existing = [entry.collection for entry in await self._bookmarks.collections(workspace_id)]
        if len(existing) >= MAX_COLLECTIONS:
            raise TooManyCollectionsError
        if _name_taken(existing, name, None):
            raise CollectionNameTakenError
        now = self._clock()
        collection = BookmarkCollection(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=name,
            color=color,
            position=max((entry.position for entry in existing), default=-1) + 1,
            created_at=now,
            updated_at=now,
        )
        await self._store_collection(self._bookmarks.add_collection, collection)
        return collection

    async def update_collection(
        self, workspace_id: uuid.UUID, collection_id: uuid.UUID, changes: CollectionChanges
    ) -> BookmarkCollection:
        collection = await self._bookmarks.get_collection(workspace_id, collection_id)
        if collection is None:
            raise CollectionNotFoundError
        if changes.name is not UNSET:
            existing = [
                entry.collection for entry in await self._bookmarks.collections(workspace_id)
            ]
            if _name_taken(existing, changes.name, collection_id):
                raise CollectionNameTakenError
        updated = replace(
            collection,
            name=collection.name if changes.name is UNSET else changes.name,
            color=collection.color if changes.color is UNSET else changes.color,
        )
        if updated == collection:
            return collection
        updated = replace(updated, updated_at=self._clock())
        await self._store_collection(self._bookmarks.save_collection, updated)
        return updated

    async def delete_collection(self, workspace_id: uuid.UUID, collection_id: uuid.UUID) -> None:
        """Delete the collection. Its bookmarks stay, in no collection."""
        if not await self._bookmarks.delete_collection(workspace_id, collection_id):
            raise CollectionNotFoundError
        await self._transaction.commit()

    async def _store_collection(
        self,
        store: Callable[[BookmarkCollection], Awaitable[None]],
        collection: BookmarkCollection,
    ) -> None:
        try:
            await store(collection)
            await self._transaction.commit()
        except ConflictError:
            # A concurrent request took the name first.
            await self._transaction.rollback()
            raise CollectionNameTakenError from None


def _tags(tags: Iterable[str]) -> tuple[str, ...]:
    """Tags with duplicates (ignoring case) removed, keeping the first spelling and order."""
    seen: set[str] = set()
    kept: list[str] = []
    for tag in tags:
        folded = tag.casefold()
        if folded not in seen:
            seen.add(folded)
            kept.append(tag)
    return tuple(kept)


def _name_taken(
    collections: Iterable[BookmarkCollection], name: str, own_id: uuid.UUID | None
) -> bool:
    folded = normalize_collection_name(name)
    return any(
        normalize_collection_name(entry.name) == folded and entry.id != own_id
        for entry in collections
    )


def normalize_collection_name(name: str) -> str:
    """Whitespace collapsed and case-folded: the form collection names are unique in."""
    return " ".join(name.split()).casefold()
