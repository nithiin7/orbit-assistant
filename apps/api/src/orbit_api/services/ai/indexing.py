"""Keeping a workspace's retrieval index in step with its records.

The index is derived data, kept by the existing worker in two steps per workspace:

1. **Reconcile.** List the records the person lets AI read, with fingerprints. A record that is
   new, changed, or embedded by a different model becomes `pending`; a record that is gone, or
   whose module was switched off, is removed with its chunks. Unchanged records are left alone,
   so nothing is embedded twice.
2. **Process.** Claim a few pending records with a lease (so several workers never index the
   same one), chunk their text, embed it, and replace their chunks. A failure is retried with
   backoff, up to `MAX_ATTEMPTS`, then left `failed` for the person to retry from Settings.

Everything is stored, so a restart resumes where it left off. Rebuild marks everything pending;
clear deletes the index. Neither touches the records themselves.
"""

import logging
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Protocol

from orbit_api.services.ai.chunking import ChunkingOptions, chunk_sections
from orbit_api.services.ai.configuration import ResolvedProvider
from orbit_api.services.ai.models import (
    SOURCE_MODULE,
    SOURCE_TYPES,
    AiModule,
    Chunk,
    IndexedSource,
    IndexSummary,
    SourceStamp,
    SourceType,
)
from orbit_api.services.ai.providers import (
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderUnavailableError,
    UnsupportedCapabilityError,
)
from orbit_api.services.ai.sources import SourceCatalog
from orbit_api.services.ai.vectors import normalize
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

logger = logging.getLogger(__name__)

MAX_ATTEMPTS: Final = 5
LEASE: Final = timedelta(minutes=5)
BATCH: Final = 20
EMBED_BATCH: Final = 32


class IndexRepository(Protocol):
    async def sources(self, workspace_id: uuid.UUID) -> list[IndexedSource]: ...

    async def mark_pending(
        self, workspace_id: uuid.UUID, stamp: SourceStamp, now: datetime
    ) -> None:
        """Insert the record as pending, or reset an existing row to pending."""
        ...

    async def delete(self, workspace_id: uuid.UUID, ids: Sequence[uuid.UUID]) -> None: ...

    async def delete_types(self, workspace_id: uuid.UUID, types: Sequence[SourceType]) -> int: ...

    async def claim(
        self, workspace_id: uuid.UUID, now: datetime, lease_until: datetime, limit: int
    ) -> list[IndexedSource]: ...

    async def store_chunks(
        self,
        source: IndexedSource,
        chunks: Sequence[Chunk],
        model_key: str,
        title: str,
        now: datetime,
    ) -> None:
        """Replace the record's chunks and mark it indexed."""
        ...

    async def mark_failed(
        self, source_id: uuid.UUID, error: str, next_attempt_at: datetime | None, now: datetime
    ) -> None: ...

    async def summary(self, workspace_id: uuid.UUID) -> IndexSummary: ...

    async def reset(self, workspace_id: uuid.UUID, now: datetime) -> int: ...

    async def retry_failed(self, workspace_id: uuid.UUID, now: datetime) -> int: ...

    async def clear(self, workspace_id: uuid.UUID) -> None: ...


@dataclass(frozen=True, slots=True)
class IndexRun:
    queued: int = 0
    removed: int = 0
    indexed: int = 0
    failed: int = 0


def permitted_types(modules: frozenset[AiModule]) -> list[SourceType]:
    return [t for t in SOURCE_TYPES if SOURCE_MODULE[t] in modules]


class IndexService:
    def __init__(
        self,
        repository: IndexRepository,
        catalog: SourceCatalog,
        transaction: Transaction,
        *,
        chunking: ChunkingOptions | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._repository = repository
        self._catalog = catalog
        self._transaction = transaction
        self._chunking = chunking or ChunkingOptions()
        self._clock = clock

    async def summary(
        self, workspace_id: uuid.UUID, embedder: ResolvedProvider | None
    ) -> IndexSummary:
        summary = await self._repository.summary(workspace_id)
        return IndexSummary(
            counts=summary.counts,
            embedding_model=embedder.model if embedder else None,
            last_indexed_at=summary.last_indexed_at,
            active=embedder is not None,
        )

    async def reconcile(
        self, workspace_id: uuid.UUID, modules: frozenset[AiModule], model_key: str
    ) -> IndexRun:
        existing = {
            (s.source_type, s.source_id): s for s in await self._repository.sources(workspace_id)
        }
        now = self._clock()
        queued = 0
        for stamp in await self._catalog.stamps(workspace_id, permitted_types(modules)):
            row = existing.pop((stamp.source_type, stamp.source_id), None)
            if row is not None and row.content_hash == stamp.content_hash:
                if row.status == "pending" or row.status == "failed":
                    continue
                if row.embedding_model == model_key:
                    continue
            await self._repository.mark_pending(workspace_id, stamp, now)
            queued += 1
        # What's left was deleted, trashed, archived, or belongs to a module now switched off.
        removed = [row.id for row in existing.values()]
        if removed:
            await self._repository.delete(workspace_id, removed)
        await self._transaction.commit()
        return IndexRun(queued=queued, removed=len(removed))

    async def process(
        self, workspace_id: uuid.UUID, embedder: ResolvedProvider, limit: int = BATCH
    ) -> IndexRun:
        now = self._clock()
        claimed = await self._repository.claim(workspace_id, now, now + LEASE, limit)
        await self._transaction.commit()
        indexed = failed = removed = 0
        for source in claimed:
            try:
                if await self._index_one(workspace_id, source, embedder):
                    indexed += 1
                else:
                    removed += 1
            except ProviderError as exc:
                await self._transaction.rollback()
                await self._fail(source, exc.message)
                failed += 1
                if _stops_run(exc):
                    break
        return IndexRun(indexed=indexed, failed=failed, removed=removed)

    async def _index_one(
        self, workspace_id: uuid.UUID, source: IndexedSource, embedder: ResolvedProvider
    ) -> bool:
        content = await self._catalog.load(workspace_id, source.source_type, source.source_id)
        if content is None:
            await self._repository.delete(workspace_id, [source.id])
            await self._transaction.commit()
            return False
        pieces = chunk_sections(content.sections, self._chunking)
        inputs = [f"{content.title}\n{piece.location}\n{piece.text}" for piece in pieces]
        vectors: list[list[float]] = []
        for start in range(0, len(inputs), EMBED_BATCH):
            result = await embedder.provider.embed(
                embedder.model, inputs[start : start + EMBED_BATCH]
            )
            vectors += result.vectors
        chunks = [
            Chunk(
                position=index,
                location=piece.location[:200],
                text=piece.text,
                vector=normalize(vector),
            )
            for index, (piece, vector) in enumerate(zip(pieces, vectors, strict=True))
        ]
        await self._repository.store_chunks(
            source, chunks, embedder.embedding_key, content.title[:300], self._clock()
        )
        await self._transaction.commit()
        return True

    async def _fail(self, source: IndexedSource, message: str) -> None:
        attempts = source.attempts + 1
        now = self._clock()
        retry_at = (
            now + timedelta(minutes=min(2**attempts, 360)) if attempts < MAX_ATTEMPTS else None
        )
        await self._repository.mark_failed(source.id, message[:200], retry_at, now)
        await self._transaction.commit()

    async def rebuild(self, workspace_id: uuid.UUID) -> int:
        count = await self._repository.reset(workspace_id, self._clock())
        await self._transaction.commit()
        return count

    async def retry_failed(self, workspace_id: uuid.UUID) -> int:
        count = await self._repository.retry_failed(workspace_id, self._clock())
        await self._transaction.commit()
        return count

    async def clear(self, workspace_id: uuid.UUID) -> None:
        await self._repository.clear(workspace_id)
        await self._transaction.commit()

    async def forget_modules(self, workspace_id: uuid.UUID, modules: frozenset[AiModule]) -> int:
        """Remove at once every indexed record of modules AI may no longer read."""
        types: list[SourceType] = [t for t in SOURCE_TYPES if SOURCE_MODULE[t] not in modules]
        count = await self._repository.delete_types(workspace_id, types) if types else 0
        await self._transaction.commit()
        return count


def _stops_run(error: ProviderError) -> bool:
    """Whether the rest of this run would fail the same way: an unreachable, rate-limiting, or
    misconfigured provider. The run stops and the backoff applies."""
    return isinstance(
        error,
        ProviderRateLimitError
        | ProviderUnavailableError
        | ProviderAuthError
        | UnsupportedCapabilityError,
    )
