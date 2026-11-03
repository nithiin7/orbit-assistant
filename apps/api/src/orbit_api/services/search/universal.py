"""Universal search: one ranked, filtered, paged list of hits from every module.

Each module exposes its searchable records through a `ModuleSearchProvider` (implemented in
`repositories/search/`, one SQL query per entity type). This service asks every provider for its
best hits, merges them by the ranking strategy, and pages the merged list. Module counts
(facets) are computed under every filter except the module filter, so tabs can show what each
module would add.

Paging is by offset: each provider returns its first `offset + limit` hits in final order, so
the merged page is exact. Offsets are capped (`MAX_SEARCH_OFFSET`).

There is no search index to keep in step: providers query the modules' own tables in the
request's transaction, so an edit, delete, restore, or import is reflected in the next search.
"""

import logging
from collections.abc import Sequence
from typing import Protocol

from orbit_api.services.search.ranking import (
    DEFAULT_RANKING,
    RankingStrategy,
    recency_key,
    relevance_key,
)
from orbit_api.services.search.universal_models import (
    UNIVERSAL_MODULES,
    ModuleFacet,
    SearchScope,
    SourcePage,
    UniversalHit,
    UniversalModule,
    UniversalQuery,
    UniversalResults,
)
from orbit_api.services.transactions import Transaction

logger = logging.getLogger(__name__)


class ModuleSearchProvider(Protocol):
    @property
    def module(self) -> UniversalModule: ...

    async def search(
        self, scope: SearchScope, query: UniversalQuery, window: int, ranking: RankingStrategy
    ) -> SourcePage:
        """The module's first `window` hits in ranking order (none when `window` is 0), and how
        many records match in all."""
        ...


class UniversalSearchService:
    def __init__(
        self,
        providers: Sequence[ModuleSearchProvider],
        transaction: Transaction,
        ranking: RankingStrategy = DEFAULT_RANKING,
    ) -> None:
        order = {module: index for index, module in enumerate(UNIVERSAL_MODULES)}
        self._providers = sorted(providers, key=lambda provider: order[provider.module])
        self._transaction = transaction
        self._ranking = ranking

    async def search(self, scope: SearchScope, query: UniversalQuery) -> UniversalResults:
        chosen = set(query.filters.modules or UNIVERSAL_MODULES)
        window = query.offset + query.limit
        facets: list[ModuleFacet] = []
        hits: list[UniversalHit] = []
        total = 0
        # One module at a time: they share the request's database session.
        for provider in self._providers:
            module = provider.module
            try:
                page = await provider.search(
                    scope, query, window if module in chosen else 0, self._ranking
                )
            # A deliberate boundary: one module failing must not hide the others' results. Only
            # the module is logged, never the query, which may be personal. The session is
            # rolled back so the next module can query.
            except Exception:
                logger.exception("Universal search in %r failed.", module)
                await self._transaction.rollback()
                facets.append(ModuleFacet(module=module, total=0, unavailable=True))
                continue
            facets.append(ModuleFacet(module=module, total=page.total))
            if module in chosen:
                hits.extend(page.hits)
                total += page.total
        hits.sort(key=relevance_key if query.sort == "relevance" else recency_key)
        return UniversalResults(
            query=query.text,
            sort=query.sort,
            offset=query.offset,
            limit=query.limit,
            hits=hits[query.offset : window],
            total=total,
            facets=facets,
        )
