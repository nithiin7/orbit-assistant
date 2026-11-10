"""Bookmarks and their collections. Every query is filtered by workspace, so callers cannot reach
other workspaces' rows."""

import uuid
from typing import Any, cast

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    BookmarkCollectionModel,
    BookmarkModel,
    BookmarkPreviewModel,
    BookmarkSettingsModel,
)
from orbit_api.repositories.transaction import flush
from orbit_api.services.bookmarks.models import (
    Bookmark,
    BookmarkCollection,
    BookmarkKind,
    BookmarkStatus,
    CollectionColor,
    CollectionOverview,
    PreviewFile,
)
from orbit_api.services.bookmarks.service import normalize_collection_name

type Previews = dict[str, PreviewFile]


def _to_bookmark(model: BookmarkModel, previews: Previews | None = None) -> Bookmark:
    previews = previews or {}
    return Bookmark(
        id=model.id,
        workspace_id=model.workspace_id,
        collection_id=model.collection_id,
        url=model.url,
        title=model.title,
        note=model.note,
        # The table's CHECK constraints limit `kind` and `status` to these values.
        kind=cast(BookmarkKind, model.kind),
        status=cast(BookmarkStatus, model.status),
        tags=tuple(str(tag) for tag in model.tags),
        pinned=model.pinned,
        open_count=model.open_count,
        last_opened_at=model.last_opened_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
        preview_description=model.preview_description,
        previewed_at=model.previewed_at,
        image=previews.get("image"),
        icon=previews.get("icon"),
    )


def _fields(bookmark: Bookmark) -> dict[str, Any]:
    """The columns a bookmark's fields set, apart from its identity."""
    return {
        "collection_id": bookmark.collection_id,
        "url": bookmark.url,
        "title": bookmark.title,
        "note": bookmark.note,
        "kind": bookmark.kind,
        "status": bookmark.status,
        "tags": list(bookmark.tags),
        "pinned": bookmark.pinned,
        "open_count": bookmark.open_count,
        "last_opened_at": bookmark.last_opened_at,
        "preview_description": bookmark.preview_description,
        "previewed_at": bookmark.previewed_at,
        "updated_at": bookmark.updated_at,
    }


def _to_collection(model: BookmarkCollectionModel) -> BookmarkCollection:
    return BookmarkCollection(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        # The table's CHECK constraint limits `color` to the palette.
        color=cast(CollectionColor, model.color),
        position=model.position,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlBookmarkRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def all(self, workspace_id: uuid.UUID) -> list[Bookmark]:
        models = await self._session.scalars(
            select(BookmarkModel)
            .where(BookmarkModel.workspace_id == workspace_id)
            .order_by(BookmarkModel.created_at.desc(), BookmarkModel.id)
        )
        previews = await self._previews(workspace_id, None)
        return [_to_bookmark(model, previews.get(model.id)) for model in models]

    async def get(self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID) -> Bookmark | None:
        model = await self._get_model(workspace_id, bookmark_id)
        if model is None:
            return None
        previews = await self._previews(workspace_id, bookmark_id)
        return _to_bookmark(model, previews.get(bookmark_id))

    async def _previews(
        self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID | None
    ) -> dict[uuid.UUID, Previews]:
        query = select(BookmarkPreviewModel).where(
            BookmarkPreviewModel.workspace_id == workspace_id
        )
        if bookmark_id is not None:
            query = query.where(BookmarkPreviewModel.bookmark_id == bookmark_id)
        found: dict[uuid.UUID, Previews] = {}
        for row in await self._session.scalars(query):
            found.setdefault(row.bookmark_id, {})[row.role] = PreviewFile(
                id=row.id, content_type=row.content_type
            )
        return found

    async def find_url(self, workspace_id: uuid.UUID, url: str) -> uuid.UUID | None:
        return await self._session.scalar(
            select(BookmarkModel.id)
            .where(BookmarkModel.workspace_id == workspace_id, BookmarkModel.url == url)
            .limit(1)
        )

    async def add(self, bookmark: Bookmark) -> None:
        self._session.add(
            BookmarkModel(
                id=bookmark.id,
                workspace_id=bookmark.workspace_id,
                created_at=bookmark.created_at,
                **_fields(bookmark),
            )
        )
        await flush(self._session)

    async def save(self, bookmark: Bookmark) -> None:
        model = await self._get_model(bookmark.workspace_id, bookmark.id)
        if model is None:
            return
        for name, value in _fields(bookmark).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID) -> Bookmark | None:
        bookmark = await self.get(workspace_id, bookmark_id)
        if bookmark is None:
            return None
        # Explicitly, rather than relying on ON DELETE CASCADE (SQLite only cascades with foreign
        # keys on).
        await self._session.execute(
            delete(BookmarkPreviewModel).where(
                BookmarkPreviewModel.bookmark_id == bookmark_id,
                BookmarkPreviewModel.workspace_id == workspace_id,
            )
        )
        await self._session.execute(
            delete(BookmarkModel).where(
                BookmarkModel.id == bookmark_id, BookmarkModel.workspace_id == workspace_id
            )
        )
        return bookmark

    async def replace_previews(self, bookmark: Bookmark) -> list[uuid.UUID]:
        await self.save(bookmark)
        rows = await self._session.scalars(
            select(BookmarkPreviewModel).where(
                BookmarkPreviewModel.bookmark_id == bookmark.id,
                BookmarkPreviewModel.workspace_id == bookmark.workspace_id,
            )
        )
        removed = [row.id for row in rows]
        await self._session.execute(
            delete(BookmarkPreviewModel).where(
                BookmarkPreviewModel.bookmark_id == bookmark.id,
                BookmarkPreviewModel.workspace_id == bookmark.workspace_id,
            )
        )
        for role, file in (("image", bookmark.image), ("icon", bookmark.icon)):
            if file is not None:
                self._session.add(
                    BookmarkPreviewModel(
                        id=file.id,
                        workspace_id=bookmark.workspace_id,
                        bookmark_id=bookmark.id,
                        role=role,
                        content_type=file.content_type,
                    )
                )
        await flush(self._session)
        return removed

    async def _get_model(
        self, workspace_id: uuid.UUID, bookmark_id: uuid.UUID
    ) -> BookmarkModel | None:
        return await self._session.scalar(
            select(BookmarkModel).where(
                BookmarkModel.id == bookmark_id, BookmarkModel.workspace_id == workspace_id
            )
        )

    # Collections

    async def collections(self, workspace_id: uuid.UUID) -> list[CollectionOverview]:
        count = (
            select(func.count())
            .where(
                BookmarkModel.workspace_id == workspace_id,
                BookmarkModel.collection_id == BookmarkCollectionModel.id,
            )
            .scalar_subquery()
        )
        rows = await self._session.execute(
            select(BookmarkCollectionModel, count)
            .where(BookmarkCollectionModel.workspace_id == workspace_id)
            .order_by(
                BookmarkCollectionModel.position,
                BookmarkCollectionModel.created_at,
                BookmarkCollectionModel.id,
            )
        )
        return [
            CollectionOverview(collection=_to_collection(model), bookmarks=bookmarks)
            for model, bookmarks in rows
        ]

    async def get_collection(
        self, workspace_id: uuid.UUID, collection_id: uuid.UUID
    ) -> BookmarkCollection | None:
        model = await self._get_collection_model(workspace_id, collection_id)
        return _to_collection(model) if model else None

    async def add_collection(self, collection: BookmarkCollection) -> None:
        self._session.add(
            BookmarkCollectionModel(
                id=collection.id,
                workspace_id=collection.workspace_id,
                name=collection.name,
                normalized_name=normalize_collection_name(collection.name),
                color=collection.color,
                position=collection.position,
                created_at=collection.created_at,
                updated_at=collection.updated_at,
            )
        )
        await flush(self._session)

    async def save_collection(self, collection: BookmarkCollection) -> None:
        model = await self._get_collection_model(collection.workspace_id, collection.id)
        if model is None:
            return
        model.name = collection.name
        model.normalized_name = normalize_collection_name(collection.name)
        model.color = collection.color
        model.position = collection.position
        model.updated_at = collection.updated_at
        await flush(self._session)

    async def delete_collection(self, workspace_id: uuid.UUID, collection_id: uuid.UUID) -> bool:
        # The foreign key has no ON DELETE action, so the bookmarks come out of it first.
        await self._session.execute(
            update(BookmarkModel)
            .where(
                BookmarkModel.workspace_id == workspace_id,
                BookmarkModel.collection_id == collection_id,
            )
            .values(collection_id=None)
        )
        deleted = await self._session.scalars(
            delete(BookmarkCollectionModel)
            .where(
                BookmarkCollectionModel.id == collection_id,
                BookmarkCollectionModel.workspace_id == workspace_id,
            )
            .returning(BookmarkCollectionModel.id)
        )
        return deleted.first() is not None

    async def _get_collection_model(
        self, workspace_id: uuid.UUID, collection_id: uuid.UUID
    ) -> BookmarkCollectionModel | None:
        return await self._session.scalar(
            select(BookmarkCollectionModel).where(
                BookmarkCollectionModel.id == collection_id,
                BookmarkCollectionModel.workspace_id == workspace_id,
            )
        )


class SqlBookmarkSettings:
    """A workspace's Saved settings; no row means previews are off."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def previews_enabled(self, workspace_id: uuid.UUID) -> bool:
        model = await self._session.get(BookmarkSettingsModel, workspace_id)
        return model is not None and model.previews_enabled

    async def set_previews_enabled(self, workspace_id: uuid.UUID, enabled: bool) -> None:
        model = await self._session.get(BookmarkSettingsModel, workspace_id)
        if model is None:
            self._session.add(
                BookmarkSettingsModel(workspace_id=workspace_id, previews_enabled=enabled)
            )
        else:
            model.previews_enabled = enabled
        await flush(self._session)
