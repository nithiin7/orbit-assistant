"""Watchlist titles and the workspace's lookup settings. Every query is filtered by workspace, so
callers cannot reach other workspaces' rows."""

import uuid
from typing import Any, cast

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import WatchItemModel, WatchlistSettingsModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.watchlist.models import (
    LookupState,
    Progress,
    WatchItem,
    WatchItemNotFoundError,
    WatchKind,
    WatchStatus,
)


def _to_item(model: WatchItemModel) -> WatchItem:
    progress = None
    if model.progress_season is not None and model.progress_episode is not None:
        progress = Progress(season=model.progress_season, episode=model.progress_episode)
    seasons = model.season_episodes
    return WatchItem(
        id=model.id,
        workspace_id=model.workspace_id,
        # The table's CHECK constraints limit `kind` and `status` to these values.
        kind=cast(WatchKind, model.kind),
        title=model.title,
        release_year=model.release_year,
        overview=model.overview,
        genres=tuple(str(genre) for genre in model.genres),
        runtime_minutes=model.runtime_minutes,
        season_episodes=tuple(int(count) for count in seasons) if seasons is not None else None,
        status=cast(WatchStatus, model.status),
        progress=progress,
        rating=model.rating,
        notes=model.notes,
        platform=model.platform,
        recommended_by=model.recommended_by,
        source_id=model.source_id,
        poster_blob_id=model.poster_blob_id,
        position=model.position,
        started_at=model.started_at,
        finished_at=model.finished_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _fields(item: WatchItem) -> dict[str, Any]:
    """The columns an item's fields set, apart from its identity."""
    return {
        "kind": item.kind,
        "title": item.title,
        "release_year": item.release_year,
        "overview": item.overview,
        "genres": list(item.genres),
        "runtime_minutes": item.runtime_minutes,
        "season_episodes": list(item.season_episodes) if item.season_episodes is not None else None,
        "status": item.status,
        "progress_season": item.progress.season if item.progress else None,
        "progress_episode": item.progress.episode if item.progress else None,
        "rating": item.rating,
        "notes": item.notes,
        "platform": item.platform,
        "recommended_by": item.recommended_by,
        "source_id": item.source_id,
        "poster_blob_id": item.poster_blob_id,
        "position": item.position,
        "started_at": item.started_at,
        "finished_at": item.finished_at,
        "updated_at": item.updated_at,
    }


class SqlWatchItemRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, item: WatchItem) -> None:
        self._session.add(
            WatchItemModel(
                id=item.id,
                workspace_id=item.workspace_id,
                created_at=item.created_at,
                **_fields(item),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem | None:
        model = await self._get_model(workspace_id, item_id)
        return _to_item(model) if model else None

    async def all(self, workspace_id: uuid.UUID) -> list[WatchItem]:
        models = await self._session.scalars(
            select(WatchItemModel)
            .where(WatchItemModel.workspace_id == workspace_id)
            .order_by(WatchItemModel.position, WatchItemModel.created_at, WatchItemModel.id)
        )
        return [_to_item(model) for model in models]

    async def find_source(
        self, workspace_id: uuid.UUID, kind: WatchKind, source_id: int
    ) -> uuid.UUID | None:
        return await self._session.scalar(
            select(WatchItemModel.id).where(
                WatchItemModel.workspace_id == workspace_id,
                WatchItemModel.kind == kind,
                WatchItemModel.source_id == source_id,
            )
        )

    async def source_ids(self, workspace_id: uuid.UUID) -> dict[tuple[WatchKind, int], uuid.UUID]:
        rows = await self._session.execute(
            select(WatchItemModel.kind, WatchItemModel.source_id, WatchItemModel.id).where(
                WatchItemModel.workspace_id == workspace_id,
                WatchItemModel.source_id.is_not(None),
            )
        )
        return {
            (cast(WatchKind, kind), source_id): item_id
            for kind, source_id, item_id in rows
            if source_id is not None
        }

    async def position_bounds(self, workspace_id: uuid.UUID) -> tuple[int, int] | None:
        row = (
            await self._session.execute(
                select(func.min(WatchItemModel.position), func.max(WatchItemModel.position)).where(
                    WatchItemModel.workspace_id == workspace_id
                )
            )
        ).one()
        lowest, highest = cast(tuple[int | None, int | None], tuple(row))
        if lowest is None or highest is None:
            return None
        return lowest, highest

    async def save(self, item: WatchItem) -> None:
        model = await self._get_model(item.workspace_id, item.id)
        if model is None:
            raise WatchItemNotFoundError
        for name, value in _fields(item).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> WatchItem | None:
        model = await self._get_model(workspace_id, item_id)
        if model is None:
            return None
        item = _to_item(model)
        await self._session.execute(
            delete(WatchItemModel).where(
                WatchItemModel.id == item_id, WatchItemModel.workspace_id == workspace_id
            )
        )
        return item

    async def _get_model(
        self, workspace_id: uuid.UUID, item_id: uuid.UUID
    ) -> WatchItemModel | None:
        return await self._session.scalar(
            select(WatchItemModel).where(
                WatchItemModel.id == item_id, WatchItemModel.workspace_id == workspace_id
            )
        )


class SqlLookupSettings:
    """The workspace's watchlist lookup settings; no row means no key and lookup off."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, workspace_id: uuid.UUID) -> LookupState:
        model = await self._session.get(WatchlistSettingsModel, workspace_id)
        if model is None:
            return LookupState(enabled=False, encrypted_key=None)
        return LookupState(enabled=model.lookup_enabled, encrypted_key=model.tmdb_api_key)

    async def put(self, workspace_id: uuid.UUID, state: LookupState) -> None:
        model = await self._session.get(WatchlistSettingsModel, workspace_id)
        if model is None:
            self._session.add(
                WatchlistSettingsModel(
                    workspace_id=workspace_id,
                    lookup_enabled=state.enabled,
                    tmdb_api_key=state.encrypted_key,
                )
            )
        else:
            model.lookup_enabled = state.enabled
            model.tmdb_api_key = state.encrypted_key
        await flush(self._session)
