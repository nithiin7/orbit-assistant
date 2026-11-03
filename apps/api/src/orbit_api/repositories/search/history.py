"""Recent and saved searches. Every query filters by both the user and the workspace."""

import uuid
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import RecentSearchModel, SavedSearchModel
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.services.search.history import (
    RecentSearch,
    SavedSearch,
    SearchHistoryService,
    normalize_query,
)


def _recent(model: RecentSearchModel) -> RecentSearch:
    return RecentSearch(id=model.id, query=model.query, used_at=model.used_at)


def _saved(model: SavedSearchModel) -> SavedSearch:
    return SavedSearch(
        id=model.id,
        name=model.name,
        query=model.query,
        filters=dict(model.filters),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlRecentSearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def _owned(self, user_id: uuid.UUID, workspace_id: uuid.UUID):
        return (
            RecentSearchModel.user_id == user_id,
            RecentSearchModel.workspace_id == workspace_id,
        )

    async def list(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, limit: int
    ) -> list[RecentSearch]:
        models = await self._session.scalars(
            select(RecentSearchModel)
            .where(*self._owned(user_id, workspace_id))
            .order_by(RecentSearchModel.used_at.desc(), RecentSearchModel.id)
            .limit(limit)
        )
        return [_recent(model) for model in models]

    async def record(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        query: str,
        normalized: str,
        used_at: datetime,
    ) -> RecentSearch:
        model = await self._session.scalar(
            select(RecentSearchModel).where(
                *self._owned(user_id, workspace_id),
                RecentSearchModel.normalized_query == normalized,
            )
        )
        if model is None:
            model = RecentSearchModel(
                id=uuid.uuid4(),
                user_id=user_id,
                workspace_id=workspace_id,
                normalized_query=normalized,
                created_at=used_at,
            )
            self._session.add(model)
        model.query = query
        model.used_at = used_at
        await self._session.flush()
        return _recent(model)

    async def trim(self, user_id: uuid.UUID, workspace_id: uuid.UUID, keep: int) -> None:
        kept = (
            select(RecentSearchModel.id)
            .where(*self._owned(user_id, workspace_id))
            .order_by(RecentSearchModel.used_at.desc(), RecentSearchModel.id)
            .limit(keep)
        )
        await self._session.execute(
            delete(RecentSearchModel).where(
                *self._owned(user_id, workspace_id), RecentSearchModel.id.not_in(kept)
            )
        )

    async def delete(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.scalars(
            delete(RecentSearchModel)
            .where(*self._owned(user_id, workspace_id), RecentSearchModel.id == search_id)
            .returning(RecentSearchModel.id)
        )
        return deleted.first() is not None

    async def clear(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(RecentSearchModel).where(*self._owned(user_id, workspace_id))
        )


class SqlSavedSearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def _owned(self, user_id: uuid.UUID, workspace_id: uuid.UUID):
        return (
            SavedSearchModel.user_id == user_id,
            SavedSearchModel.workspace_id == workspace_id,
        )

    async def list(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> list[SavedSearch]:
        models = await self._session.scalars(
            select(SavedSearchModel)
            .where(*self._owned(user_id, workspace_id))
            .order_by(SavedSearchModel.normalized_name, SavedSearchModel.id)
        )
        return [_saved(model) for model in models]

    async def get(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> SavedSearch | None:
        model = await self._model(user_id, workspace_id, search_id)
        return None if model is None else _saved(model)

    async def count(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> int:
        total = await self._session.scalar(
            select(func.count())
            .select_from(SavedSearchModel)
            .where(*self._owned(user_id, workspace_id))
        )
        return total or 0

    async def add(self, user_id: uuid.UUID, workspace_id: uuid.UUID, search: SavedSearch) -> None:
        # Not flushed here: a duplicate name surfaces as a conflict on commit.
        self._session.add(
            SavedSearchModel(
                id=search.id,
                user_id=user_id,
                workspace_id=workspace_id,
                name=search.name,
                normalized_name=normalize_query(search.name),
                query=search.query,
                filters=dict(search.filters),
                created_at=search.created_at,
                updated_at=search.updated_at,
            )
        )

    async def save(self, user_id: uuid.UUID, workspace_id: uuid.UUID, search: SavedSearch) -> None:
        model = await self._model(user_id, workspace_id, search.id)
        if model is None:
            return
        model.name = search.name
        model.normalized_name = normalize_query(search.name)
        model.query = search.query
        model.filters = dict(search.filters)
        model.updated_at = search.updated_at

    async def delete(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.scalars(
            delete(SavedSearchModel)
            .where(*self._owned(user_id, workspace_id), SavedSearchModel.id == search_id)
            .returning(SavedSearchModel.id)
        )
        return deleted.first() is not None

    async def _model(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> SavedSearchModel | None:
        return await self._session.scalar(
            select(SavedSearchModel).where(
                *self._owned(user_id, workspace_id), SavedSearchModel.id == search_id
            )
        )


def build_search_history(session: AsyncSession) -> SearchHistoryService:
    return SearchHistoryService(
        SqlRecentSearchRepository(session),
        SqlSavedSearchRepository(session),
        SqlTransaction(session),
    )
