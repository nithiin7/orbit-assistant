"""Recent and saved searches, per user and workspace.

A recent search is recorded only when the person commits to it (opens a result, presses Enter,
or opens "See all results"), never for every keystroke, and only its text is kept. At most
`RECENT_LIMIT` are kept: recording another drops the oldest. Saved searches add a name and the
filters. Both belong to one user in one workspace: nobody else, including other members of a
workspace, can list them.
"""

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Final, Protocol

from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.clock import utc_now

RECENT_LIMIT: Final = 10
SAVED_LIMIT: Final = 50


class SavedSearchNotFoundError(Exception):
    pass


class SavedSearchLimitError(Exception):
    pass


class DuplicateSavedSearchError(Exception):
    pass


def normalize_query(text: str) -> str:
    """The form searches are compared in: case-folded and single-spaced."""
    return " ".join(text.casefold().split())


@dataclass(frozen=True, slots=True)
class RecentSearch:
    id: uuid.UUID
    query: str
    used_at: datetime


@dataclass(frozen=True, slots=True)
class SavedSearch:
    id: uuid.UUID
    name: str
    query: str
    # The validated filter document (see `schemas/search.py`); opaque here.
    filters: Mapping[str, Any]
    created_at: datetime
    updated_at: datetime


class RecentSearchRepository(Protocol):
    async def list(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, limit: int
    ) -> list[RecentSearch]: ...

    async def record(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        query: str,
        normalized: str,
        used_at: datetime,
    ) -> RecentSearch:
        """Adds the search, or moves an equal one to the top with this spelling."""
        ...

    async def trim(self, user_id: uuid.UUID, workspace_id: uuid.UUID, keep: int) -> None: ...

    async def delete(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> bool: ...

    async def clear(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> None: ...


class SavedSearchRepository(Protocol):
    async def list(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> list[SavedSearch]: ...

    async def get(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> SavedSearch | None: ...

    async def count(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> int: ...

    async def add(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search: SavedSearch
    ) -> None: ...

    async def save(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search: SavedSearch
    ) -> None: ...

    async def delete(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> bool: ...


class SearchHistoryService:
    def __init__(
        self,
        recent: RecentSearchRepository,
        saved: SavedSearchRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._recent = recent
        self._saved = saved
        self._transaction = transaction
        self._clock = clock

    # Recent

    async def recent(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> list[RecentSearch]:
        return await self._recent.list(user_id, workspace_id, RECENT_LIMIT)

    async def record(self, user_id: uuid.UUID, workspace_id: uuid.UUID, query: str) -> RecentSearch:
        text = " ".join(query.split())
        recent = await self._recent.record(
            user_id, workspace_id, text, normalize_query(text), self._clock()
        )
        await self._recent.trim(user_id, workspace_id, RECENT_LIMIT)
        await self._transaction.commit()
        return recent

    async def forget(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> None:
        """Removes one recent search. A missing one is already forgotten."""
        await self._recent.delete(user_id, workspace_id, search_id)
        await self._transaction.commit()

    async def clear(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
        await self._recent.clear(user_id, workspace_id)
        await self._transaction.commit()

    # Saved

    async def saved(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> list[SavedSearch]:
        return await self._saved.list(user_id, workspace_id)

    async def save(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        *,
        name: str,
        query: str,
        filters: Mapping[str, Any],
    ) -> SavedSearch:
        if await self._saved.count(user_id, workspace_id) >= SAVED_LIMIT:
            raise SavedSearchLimitError
        now = self._clock()
        search = SavedSearch(
            id=uuid.uuid4(),
            name=name,
            query=" ".join(query.split()),
            filters=dict(filters),
            created_at=now,
            updated_at=now,
        )
        await self._saved.add(user_id, workspace_id, search)
        await self._commit()
        return search

    async def update(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        search_id: uuid.UUID,
        *,
        name: str | None = None,
        query: str | None = None,
        filters: Mapping[str, Any] | None = None,
    ) -> SavedSearch:
        current = await self._saved.get(user_id, workspace_id, search_id)
        if current is None:
            raise SavedSearchNotFoundError
        changed = replace(
            current,
            name=current.name if name is None else name,
            query=current.query if query is None else " ".join(query.split()),
            filters=current.filters if filters is None else dict(filters),
        )
        if changed == current:
            return current
        changed = replace(changed, updated_at=self._clock())
        await self._saved.save(user_id, workspace_id, changed)
        await self._commit()
        return changed

    async def delete(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, search_id: uuid.UUID
    ) -> None:
        if not await self._saved.delete(user_id, workspace_id, search_id):
            raise SavedSearchNotFoundError
        await self._transaction.commit()

    async def _commit(self) -> None:
        try:
            await self._transaction.commit()
        except ConflictError as exc:
            # Names are unique per user and workspace, case-insensitively.
            raise DuplicateSavedSearchError from exc
