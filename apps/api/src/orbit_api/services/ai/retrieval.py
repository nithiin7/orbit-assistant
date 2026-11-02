"""Hybrid retrieval: the existing keyword search plus semantic search over the index.

- **Keyword:** the workspace search (`services/search`), unchanged, run for the question's most
  distinctive words, since it matches substrings rather than whole questions.
- **Semantic:** the question is embedded with the person's embedding model and compared with
  every chunk embedded by that same model, in modules the person allows.
- **Fusion:** reciprocal rank fusion (each list contributes `1 / (60 + rank)`), so a record found
  both ways ranks above one found either way, without comparing incomparable scores.

Permissions apply before anything is read: only allowed modules are searched. Every indexed
match is then re-checked against its module, so a record deleted or trashed since indexing is
never returned. Without an embedding model, results are keyword only and say so.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Final, Protocol

from orbit_api.services.ai.configuration import ResolvedProvider
from orbit_api.services.ai.models import (
    SOURCE_MODULE,
    SOURCE_TYPES,
    AiModule,
    RecordRef,
    SearchMatch,
    SourceType,
    StoredChunk,
)
from orbit_api.services.ai.providers import ProviderError
from orbit_api.services.ai.routing import keywords
from orbit_api.services.ai.sources import SourceCatalog
from orbit_api.services.ai.vectors import normalize, top_k
from orbit_api.services.search.models import SearchHit, SearchModule, SearchResults

RRF_K: Final = 60
SEARCH_TO_AI: Final[dict[SearchModule, AiModule]] = {
    "tasks": "tasks",
    "notes": "notes",
    "events": "calendar",
    "documents": "documents",
    "habits": "habits",
    "transactions": "finance",
}
SEARCH_KIND: Final[dict[SearchModule, str]] = {
    "tasks": "task",
    "notes": "note",
    "events": "event",
    "documents": "document",
    "habits": "habit",
    "transactions": "transaction",
}
_SNIPPET: Final = 400
_INDEXED: Final[dict[str, SourceType]] = {t: t for t in SOURCE_TYPES}


class KeywordSearch(Protocol):
    async def search(
        self,
        workspace_id: uuid.UUID,
        text: str,
        limit: int,
        modules: Sequence[SearchModule] | None = None,
    ) -> SearchResults: ...


class ChunkStore(Protocol):
    async def chunks(
        self, workspace_id: uuid.UUID, model_key: str, types: Sequence[SourceType]
    ) -> list[StoredChunk]: ...


@dataclass(frozen=True, slots=True)
class Retrieval:
    matches: list[SearchMatch]
    # Semantic search ran. `False` without an embedding model, or if embedding the query failed.
    semantic: bool
    semantic_error: str | None = None


class Retriever:
    def __init__(
        self, *, keyword: KeywordSearch, chunks: ChunkStore, catalog: SourceCatalog
    ) -> None:
        self._keyword = keyword
        self._chunks = chunks
        self._catalog = catalog

    async def search(
        self,
        workspace_id: uuid.UUID,
        query: str,
        *,
        modules: frozenset[AiModule],
        embedder: ResolvedProvider | None,
        limit: int = 8,
        start: date | None = None,
        end: date | None = None,
    ) -> Retrieval:
        candidates: dict[tuple[str, uuid.UUID], _Candidate] = {}
        for rank, match in enumerate(await self._keyword_matches(workspace_id, query, modules)):
            _add(candidates, match, rank)
        semantic = False
        error: str | None = None
        if embedder is not None:
            try:
                semantic_matches = await self._semantic_matches(
                    workspace_id, query, modules, embedder, limit * 3
                )
                semantic = True
            except ProviderError as exc:
                semantic_matches, error = [], exc.message
            for rank, match in enumerate(semantic_matches):
                _add(candidates, match, rank)

        ranked = sorted(candidates.values(), key=lambda c: c.score, reverse=True)
        results: list[SearchMatch] = []
        for candidate in ranked:
            match = candidate.match
            if not _in_range(match.ref.day, start, end):
                continue
            source_type = _INDEXED.get(match.source_type)
            if (
                source_type is not None
                and match.ref.id is not None
                and not await self._catalog.exists(workspace_id, source_type, match.ref.id)
            ):
                continue
            results.append(
                SearchMatch(
                    ref=match.ref,
                    source_type=match.source_type,
                    snippet=match.snippet,
                    score=round(candidate.score, 6),
                    keyword=candidate.keyword,
                    semantic=candidate.semantic,
                )
            )
            if len(results) >= limit:
                break
        return Retrieval(matches=results, semantic=semantic, semantic_error=error)

    async def _keyword_matches(
        self, workspace_id: uuid.UUID, query: str, modules: frozenset[AiModule]
    ) -> list[SearchMatch]:
        search_modules: list[SearchModule] = [m for m, ai in SEARCH_TO_AI.items() if ai in modules]
        if not search_modules:
            return []
        terms = list(keywords(query))
        if len(query.split()) <= 3 and len(query.strip()) >= 2:
            terms.insert(0, query.strip())
        found: dict[tuple[str, uuid.UUID], SearchMatch] = {}
        for term in terms:
            results = await self._keyword.search(workspace_id, term, 5, search_modules)
            for group in results.groups:
                for hit in group.hits:
                    match = _keyword_match(group.module, hit)
                    assert match.ref.id is not None
                    found.setdefault((match.ref.kind, match.ref.id), match)
        return list(found.values())

    async def _semantic_matches(
        self,
        workspace_id: uuid.UUID,
        query: str,
        modules: frozenset[AiModule],
        embedder: ResolvedProvider,
        k: int,
    ) -> list[SearchMatch]:
        types: list[SourceType] = [t for t in SOURCE_TYPES if SOURCE_MODULE[t] in modules]
        if not types:
            return []
        chunks = await self._chunks.chunks(workspace_id, embedder.embedding_key, types)
        if not chunks:
            return []
        result = await embedder.provider.embed(embedder.model, [query])
        if not result.vectors:
            return []
        vector = normalize(result.vectors[0])
        best: dict[tuple[str, uuid.UUID], SearchMatch] = {}
        for score, chunk in top_k(vector, ((c, c.vector) for c in chunks), k):
            key = (chunk.source_type, chunk.source_id)
            if key in best:
                continue
            best[key] = SearchMatch(
                ref=RecordRef(
                    kind=chunk.source_type,
                    id=chunk.source_id,
                    title=chunk.title,
                    day=chunk.day,
                    detail=chunk.location,
                ),
                source_type=chunk.source_type,
                snippet=chunk.text[:_SNIPPET],
                score=score,
                keyword=False,
                semantic=True,
            )
        return list(best.values())


@dataclass(slots=True)
class _Candidate:
    match: SearchMatch
    score: float
    keyword: bool
    semantic: bool


def _add(
    candidates: dict[tuple[str, uuid.UUID], _Candidate], match: SearchMatch, rank: int
) -> None:
    assert match.ref.id is not None
    key = (match.ref.kind, match.ref.id)
    contribution = 1 / (RRF_K + rank + 1)
    existing = candidates.get(key)
    if existing is None:
        candidates[key] = _Candidate(match, contribution, match.keyword, match.semantic)
        return
    existing.score += contribution
    existing.keyword |= match.keyword
    existing.semantic |= match.semantic
    if match.semantic and len(match.snippet) > len(existing.match.snippet):
        # The semantic chunk shows why it matched better than a title.
        existing.match = SearchMatch(
            ref=match.ref,
            source_type=match.source_type,
            snippet=match.snippet,
            score=existing.score,
            keyword=existing.keyword,
            semantic=existing.semantic,
        )


def _keyword_match(module: SearchModule, hit: SearchHit) -> SearchMatch:
    kind = SEARCH_KIND[module]
    return SearchMatch(
        ref=RecordRef(kind=kind, id=hit.id, title=hit.title, day=hit.day, detail=hit.detail),
        source_type=kind,
        snippet=hit.detail[:_SNIPPET],
        score=0.0,
        keyword=True,
        semantic=False,
    )


def _in_range(day: date | None, start: date | None, end: date | None) -> bool:
    if start is None and end is None:
        return True
    if day is None:
        return False
    return (start is None or day >= start) and (end is None or day <= end)
