"""SQL search providers: one per module, each running its sources one after another."""

from collections.abc import Callable, Sequence
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.repositories.search.catalog import SOURCES
from orbit_api.repositories.search.sources import EntitySource, search_source
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.services.search.ranking import RankingStrategy, recency_key, relevance_key
from orbit_api.services.search.universal import UniversalSearchService
from orbit_api.services.search.universal_models import (
    SearchScope,
    SourcePage,
    UniversalHit,
    UniversalModule,
    UniversalQuery,
)
from orbit_api.utils.clock import utc_now


class SqlModuleSearchProvider:
    def __init__(
        self,
        session: AsyncSession,
        module: UniversalModule,
        sources: Sequence[EntitySource],
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._session = session
        self._module: UniversalModule = module
        self._sources = sources
        self._clock = clock

    @property
    def module(self) -> UniversalModule:
        return self._module

    async def search(
        self, scope: SearchScope, query: UniversalQuery, window: int, ranking: RankingStrategy
    ) -> SourcePage:
        today = self._clock().date()
        hits: list[UniversalHit] = []
        total = 0
        for source in self._sources:
            page = await search_source(self._session, source, scope, query, window, ranking, today)
            hits.extend(page.hits)
            total += page.total
        hits.sort(key=relevance_key if query.sort == "relevance" else recency_key)
        return SourcePage(hits=hits[:window], total=total)


def build_universal_search(session: AsyncSession) -> UniversalSearchService:
    return UniversalSearchService(
        [SqlModuleSearchProvider(session, module, sources) for module, sources in SOURCES.items()],
        SqlTransaction(session),
    )
