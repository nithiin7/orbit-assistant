"""The watchlist: movies and series a workspace wants to watch, is watching, or has watched.

Titles are entered by hand, or looked up at a title service (TMDB) once the workspace has saved a
TMDB API key (Settings → Watchlist, stored encrypted) and lookup is on. Only a search phrase or a
title's ID at that service leaves the server; posters are downloaded once, kept in the attachment
store, and served by the API, so the browser never contacts the service.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Literal, Protocol

import anyio

from orbit_api.services.transactions import Transaction
from orbit_api.services.watchlist.models import (
    CatalogError,
    DuplicateTitleError,
    InvalidWatchItemError,
    LookupState,
    Poster,
    TitleDetails,
    TitleMatch,
    WatchChanges,
    WatchDraft,
    WatchItem,
    WatchItemNotFoundError,
    WatchKind,
    WatchStatus,
)
from orbit_api.services.watchlist.progress import fits, is_finale, last_episode, next_episode
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

PosterSize = Literal["thumbnail", "full"]
MAX_POSTER_BYTES = 2 * 1024 * 1024


class WatchItemRepository(Protocol):
    async def add(self, item: WatchItem) -> None: ...

    async def get(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem | None:
        """The title, only if it belongs to `workspace_id`."""
        ...

    async def all(self, workspace_id: uuid.UUID) -> list[WatchItem]:
        """Every title in the workspace, in position order."""
        ...

    async def find_source(
        self, workspace_id: uuid.UUID, kind: WatchKind, source_id: int
    ) -> uuid.UUID | None:
        """The ID of the workspace's title looked up as `source_id`, if there is one."""
        ...

    async def source_ids(self, workspace_id: uuid.UUID) -> dict[tuple[WatchKind, int], uuid.UUID]:
        """Every looked-up title in the workspace, by kind and lookup ID."""
        ...

    async def position_bounds(self, workspace_id: uuid.UUID) -> tuple[int, int] | None:
        """The lowest and highest positions in use, or `None` for an empty watchlist."""
        ...

    async def save(self, item: WatchItem) -> None:
        """Store an existing title's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem | None:
        """Delete the title if it belongs to `workspace_id`, returning what was deleted."""
        ...


class LookupSettings(Protocol):
    async def get(self, workspace_id: uuid.UUID) -> LookupState: ...

    async def put(self, workspace_id: uuid.UUID, state: LookupState) -> None: ...


class SecretBox(Protocol):
    """Encrypts API keys at rest. Raises `CredentialsUnavailableError` when the server has no
    encryption key."""

    def encrypt(self, plaintext: str) -> str: ...

    def decrypt(self, token: str) -> str: ...


class TitleCatalog(Protocol):
    """The title lookup service. Raises `CatalogError` when it can't answer."""

    async def verify(self) -> None:
        """Check the key works; raises `CatalogAuthError` if the service refuses it."""
        ...

    async def search(self, query: str) -> list[TitleMatch]: ...

    async def details(self, kind: WatchKind, source_id: int) -> TitleDetails: ...

    async def poster(self, path: str, size: PosterSize) -> Poster: ...


class TitleCatalogs(Protocol):
    def catalog(self, api_key: str) -> TitleCatalog: ...


class PosterFiles(Protocol):
    """Where poster bytes live: the attachment store, by workspace and blob ID."""

    async def write(self, workspace_id: uuid.UUID, blob_id: uuid.UUID, data: bytes, /) -> None: ...

    async def locate(self, workspace_id: uuid.UUID, blob_id: uuid.UUID, /) -> Path | None: ...

    async def delete(self, workspace_id: uuid.UUID, blob_ids: Sequence[uuid.UUID], /) -> None: ...


class LookupUnavailableError(Exception):
    """Title lookup has no API key yet, or is turned off, in this workspace."""

    def __init__(self, *, configured: bool) -> None:
        super().__init__()
        self.configured = configured


class WatchlistService:
    def __init__(
        self,
        items: WatchItemRepository,
        settings: LookupSettings,
        files: PosterFiles,
        transaction: Transaction,
        secrets: SecretBox,
        catalogs: TitleCatalogs,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._items = items
        self._settings = settings
        self._files = files
        self._transaction = transaction
        self._secrets = secrets
        self._catalogs = catalogs
        self._clock = clock

    # Lookup

    async def lookup(self, workspace_id: uuid.UUID) -> LookupState:
        return await self._settings.get(workspace_id)

    async def set_lookup(self, workspace_id: uuid.UUID, enabled: bool) -> LookupState:
        state = await self._settings.get(workspace_id)
        if enabled and state.encrypted_key is None:
            raise LookupUnavailableError(configured=False)
        updated = replace(state, enabled=enabled)
        await self._settings.put(workspace_id, updated)
        await self._transaction.commit()
        return updated

    async def save_key(self, workspace_id: uuid.UUID, api_key: str) -> LookupState:
        """Check the key with TMDB, store it encrypted, and turn lookup on."""
        await self._catalogs.catalog(api_key).verify()
        state = LookupState(enabled=True, encrypted_key=self._secrets.encrypt(api_key))
        await self._settings.put(workspace_id, state)
        await self._transaction.commit()
        return state

    async def remove_key(self, workspace_id: uuid.UUID) -> LookupState:
        """Forget the key and turn lookup off. Titles and posters already added stay."""
        state = LookupState(enabled=False, encrypted_key=None)
        await self._settings.put(workspace_id, state)
        await self._transaction.commit()
        return state

    async def search(
        self, workspace_id: uuid.UUID, query: str
    ) -> list[tuple[TitleMatch, uuid.UUID | None]]:
        """Matching titles, each with the ID of the workspace's copy if it's already added."""
        catalog = await self._require_catalog(workspace_id)
        matches = await catalog.search(query)
        added = await self._items.source_ids(workspace_id)
        return [(match, added.get((match.kind, match.source_id))) for match in matches]

    async def search_poster(self, workspace_id: uuid.UUID, path: str) -> Poster:
        """A search result's poster thumbnail, fetched through the server."""
        catalog = await self._require_catalog(workspace_id)
        return await catalog.poster(path, "thumbnail")

    # Titles

    async def items(self, workspace_id: uuid.UUID) -> list[WatchItem]:
        return await self._items.all(workspace_id)

    async def get(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem:
        item = await self._items.get(workspace_id, item_id)
        if item is None:
            raise WatchItemNotFoundError
        return item

    async def add(self, workspace_id: uuid.UUID, draft: WatchDraft) -> WatchItem:
        """Add a title entered by hand."""
        item = await self._new_item(workspace_id, draft, source_id=None, poster_blob_id=None)
        await self._items.add(item)
        await self._transaction.commit()
        return item

    async def add_from_lookup(
        self,
        workspace_id: uuid.UUID,
        kind: WatchKind,
        source_id: int,
        personal: WatchDraft,
    ) -> WatchItem:
        """Add a looked-up title with its details and poster. `personal` supplies the status,
        platform, recommendation, and notes; its title and details are replaced. A poster that
        can't be downloaded is left out rather than failing the add."""
        catalog = await self._require_catalog(workspace_id)
        existing = await self._items.find_source(workspace_id, kind, source_id)
        if existing is not None:
            raise DuplicateTitleError(existing)
        details = await catalog.details(kind, source_id)
        poster_blob_id = await self._download_poster(workspace_id, catalog, details)
        draft = replace(
            personal,
            kind=details.kind,
            title=details.title,
            release_year=details.release_year,
            overview=details.overview,
            genres=details.genres,
            runtime_minutes=details.runtime_minutes,
            season_episodes=details.season_episodes,
        )
        item = await self._new_item(workspace_id, draft, source_id, poster_blob_id)
        try:
            await self._items.add(item)
            await self._transaction.commit()
        except BaseException:
            if poster_blob_id is not None:
                await self._files.delete(workspace_id, [poster_blob_id])
            raise
        return item

    async def refresh(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem:
        """Fetch a looked-up title's details again, for a series that gained a season. The
        poster is downloaded again only if the title has none."""
        catalog = await self._require_catalog(workspace_id)
        item = await self.get(workspace_id, item_id)
        if item.source_id is None:
            raise InvalidWatchItemError("Only titles added from a search can be refreshed.")
        details = await catalog.details(item.kind, item.source_id)
        poster_blob_id = item.poster_blob_id
        if poster_blob_id is None:
            poster_blob_id = await self._download_poster(workspace_id, catalog, details)
        updated = replace(
            item,
            title=details.title,
            release_year=details.release_year,
            overview=details.overview,
            genres=details.genres,
            runtime_minutes=details.runtime_minutes,
            season_episodes=details.season_episodes,
            poster_blob_id=poster_blob_id,
        )
        return await self._save_if_changed(item, updated)

    async def update(
        self, workspace_id: uuid.UUID, item_id: uuid.UUID, changes: WatchChanges
    ) -> WatchItem:
        item = await self.get(workspace_id, item_id)
        now = self._clock()
        kind = item.kind if changes.kind is UNSET else changes.kind
        progress = item.progress if changes.progress is UNSET else changes.progress
        if kind == "movie":
            if changes.progress is not UNSET and changes.progress is not None:
                raise InvalidWatchItemError("Only series have episode progress.")
            progress = None
        elif progress is not None and not fits(progress, item.season_episodes):
            raise InvalidWatchItemError("That episode isn't in the series.")
        updated = replace(
            item,
            title=item.title if changes.title is UNSET else changes.title,
            kind=kind,
            release_year=item.release_year
            if changes.release_year is UNSET
            else changes.release_year,
            runtime_minutes=item.runtime_minutes
            if changes.runtime_minutes is UNSET
            else changes.runtime_minutes,
            progress=progress,
            rating=item.rating if changes.rating is UNSET else changes.rating,
            notes=item.notes if changes.notes is UNSET else changes.notes,
            platform=item.platform if changes.platform is UNSET else changes.platform,
            recommended_by=item.recommended_by
            if changes.recommended_by is UNSET
            else changes.recommended_by,
            season_episodes=item.season_episodes if kind == "series" else None,
        )
        status = item.status if changes.status is UNSET else changes.status
        # Logging an episode of something not started yet starts it.
        if (
            changes.status is UNSET
            and changes.progress is not UNSET
            and progress is not None
            and status == "want"
        ):
            status = "watching"
        updated = _with_status(updated, status, now)
        return await self._save_if_changed(item, updated)

    async def next_episode(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem:
        """Log the next episode of a series. Logging its last known episode finishes it."""
        item = await self.get(workspace_id, item_id)
        if item.kind != "series":
            raise InvalidWatchItemError("Only series have episodes.")
        if is_finale(item.progress, item.season_episodes):
            return item
        progress = next_episode(item.progress, item.season_episodes)
        now = self._clock()
        status: WatchStatus = "watched" if is_finale(progress, item.season_episodes) else "watching"
        updated = _with_status(replace(item, progress=progress), status, now)
        return await self._save_if_changed(item, updated)

    async def move_to_top(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem:
        """Put the title first in its status, as the next one to watch."""
        item = await self.get(workspace_id, item_id)
        bounds = await self._items.position_bounds(workspace_id)
        lowest = bounds[0] if bounds else 0
        if item.position == lowest:
            return item
        return await self._save_if_changed(item, replace(item, position=lowest - 1))

    async def delete(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> None:
        deleted = await self._items.delete(workspace_id, item_id)
        if deleted is None:
            raise WatchItemNotFoundError
        await self._transaction.commit()
        if deleted.poster_blob_id is not None:
            await self._files.delete(workspace_id, [deleted.poster_blob_id])

    async def poster(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> Poster | None:
        """The title's stored poster, or `None` if it has none."""
        item = await self.get(workspace_id, item_id)
        if item.poster_blob_id is None:
            return None
        path = await self._files.locate(workspace_id, item.poster_blob_id)
        if path is None:
            return None
        data = await anyio.Path(path).read_bytes()
        return Poster(content_type=_image_type(data) or "image/jpeg", data=data)

    # Helpers

    async def _require_catalog(self, workspace_id: uuid.UUID) -> TitleCatalog:
        state = await self._settings.get(workspace_id)
        if state.encrypted_key is None:
            raise LookupUnavailableError(configured=False)
        if not state.enabled:
            raise LookupUnavailableError(configured=True)
        return self._catalogs.catalog(self._secrets.decrypt(state.encrypted_key))

    async def _download_poster(
        self, workspace_id: uuid.UUID, catalog: TitleCatalog, details: TitleDetails
    ) -> uuid.UUID | None:
        if details.poster_path is None:
            return None
        try:
            poster = await catalog.poster(details.poster_path, "full")
        except CatalogError:
            return None
        if len(poster.data) > MAX_POSTER_BYTES or _image_type(poster.data) is None:
            return None
        blob_id = uuid.uuid4()
        await self._files.write(workspace_id, blob_id, poster.data)
        return blob_id

    async def _new_item(
        self,
        workspace_id: uuid.UUID,
        draft: WatchDraft,
        source_id: int | None,
        poster_blob_id: uuid.UUID | None,
    ) -> WatchItem:
        now = self._clock()
        bounds = await self._items.position_bounds(workspace_id)
        item = WatchItem(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            kind=draft.kind,
            title=draft.title,
            release_year=draft.release_year,
            overview=draft.overview,
            genres=draft.genres,
            runtime_minutes=draft.runtime_minutes,
            season_episodes=draft.season_episodes if draft.kind == "series" else None,
            status="want",
            progress=None,
            rating=None,
            notes=draft.notes,
            platform=draft.platform,
            recommended_by=draft.recommended_by,
            source_id=source_id,
            poster_blob_id=poster_blob_id,
            position=bounds[1] + 1 if bounds else 0,
            started_at=None,
            finished_at=None,
            created_at=now,
            updated_at=now,
        )
        return _with_status(item, draft.status, now)

    async def _save_if_changed(self, item: WatchItem, updated: WatchItem) -> WatchItem:
        # A request that changes nothing leaves `updated_at` alone.
        if updated == item:
            return item
        updated = replace(updated, updated_at=self._clock())
        await self._items.save(updated)
        await self._transaction.commit()
        return updated


def _with_status(item: WatchItem, status: WatchStatus, now: datetime) -> WatchItem:
    """The title moved to `status`, with its watch dates and progress kept consistent."""
    if status == item.status:
        return item
    match status:
        case "want":
            return replace(item, status=status, progress=None, started_at=None, finished_at=None)
        case "watching":
            return replace(item, status=status, started_at=item.started_at or now, finished_at=None)
        case "watched":
            progress = item.progress
            if item.kind == "series":
                progress = last_episode(item.season_episodes) or progress
            return replace(
                item,
                status=status,
                progress=progress,
                started_at=item.started_at or now,
                finished_at=now,
            )
        case "dropped":
            return replace(item, status=status, finished_at=None)


def _image_type(data: bytes) -> Literal["image/jpeg", "image/png"] | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None
