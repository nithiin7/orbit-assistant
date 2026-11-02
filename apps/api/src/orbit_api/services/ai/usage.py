"""Usage tracking: every provider call is recorded with its tokens, estimated cost, duration,
and outcome, never with its prompt or answer. A monthly token limit, when set, is checked
before each call."""

import time
import uuid
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from orbit_api.services.ai.models import (
    Capabilities,
    ChatRequest,
    Completion,
    Embeddings,
    ModelInfo,
    Processing,
    ProviderConnection,
    ProviderKind,
    StreamChunk,
    TokenUsage,
    UsageLimitReachedError,
    UsageLine,
    UsageOperation,
    UsageRecord,
    UsageSummary,
)
from orbit_api.services.ai.providers import AiProvider, ProviderError
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now


class UsageRepository(Protocol):
    async def add(self, record: UsageRecord) -> None: ...

    async def lines(self, user_id: uuid.UUID, since: datetime) -> list[UsageLine]: ...

    async def tokens_since(self, user_id: uuid.UUID, since: datetime) -> int: ...


def month_start(now: datetime) -> datetime:
    now = now.astimezone(UTC)
    return datetime(now.year, now.month, 1, tzinfo=UTC)


def estimate_cost(connection: ProviderConnection, usage: TokenUsage) -> int | None:
    """Micro-USD from the person's own prices; `None` without prices or token counts."""
    if connection.input_price is None and connection.output_price is None:
        return None
    if usage.input_tokens is None and usage.output_tokens is None:
        return None
    total = (usage.input_tokens or 0) * (connection.input_price or 0) + (
        usage.output_tokens or 0
    ) * (connection.output_price or 0)
    return round(total / 1_000_000)


class UsageService:
    def __init__(
        self,
        repository: UsageRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._repository = repository
        self._transaction = transaction
        self._clock = clock

    async def record(self, record: UsageRecord) -> None:
        await self._repository.add(record)
        await self._transaction.commit()

    async def check_limit(self, user_id: uuid.UUID, limit: int | None) -> None:
        if limit is None:
            return
        if await self._repository.tokens_since(user_id, month_start(self._clock())) >= limit:
            raise UsageLimitReachedError

    async def summary(self, user_id: uuid.UUID, days: int, limit: int | None) -> UsageSummary:
        now = self._clock()
        since = now - timedelta(days=days)
        return UsageSummary(
            since=since,
            lines=await self._repository.lines(user_id, since),
            month_tokens=await self._repository.tokens_since(user_id, month_start(now)),
            monthly_token_limit=limit,
        )


@dataclass(frozen=True, slots=True)
class Meter:
    """Who a call is for and what it is, so the wrapper can record it."""

    usage: UsageService
    user_id: uuid.UUID
    workspace_id: uuid.UUID | None
    operation: UsageOperation
    limit: int | None


class MeteredProvider:
    """Wraps an adapter: checks the monthly limit before each call and records each call."""

    def __init__(
        self,
        provider: AiProvider,
        connection: ProviderConnection,
        processing: Processing,
        meter: Meter,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._provider = provider
        self._connection = connection
        self._processing: Processing = processing
        self._meter = meter
        self._clock = clock

    @property
    def kind(self) -> ProviderKind:
        return self._provider.kind

    @property
    def capabilities(self) -> Capabilities:
        return self._provider.capabilities

    async def complete(self, request: ChatRequest) -> Completion:
        await self._meter.usage.check_limit(self._meter.user_id, self._meter.limit)
        started = time.monotonic()
        try:
            result = await self._provider.complete(request)
        except ProviderError as exc:
            await self._record(request.model, TokenUsage(), started, exc)
            raise
        await self._record(request.model, result.usage, started, None)
        return result

    async def stream(self, request: ChatRequest) -> AsyncIterator[StreamChunk]:
        await self._meter.usage.check_limit(self._meter.user_id, self._meter.limit)
        started = time.monotonic()
        usage = TokenUsage()
        try:
            async for chunk in self._provider.stream(request):
                if chunk.usage is not None:
                    usage = chunk.usage
                yield chunk
        except ProviderError as exc:
            await self._record(request.model, usage, started, exc)
            raise
        await self._record(request.model, usage, started, None)

    async def embed(self, model: str, texts: Sequence[str]) -> Embeddings:
        await self._meter.usage.check_limit(self._meter.user_id, self._meter.limit)
        started = time.monotonic()
        try:
            result = await self._provider.embed(model, texts)
        except ProviderError as exc:
            await self._record(model, TokenUsage(), started, exc, "embedding")
            raise
        await self._record(model, result.usage, started, None, "embedding")
        return result

    async def list_models(self) -> list[ModelInfo]:
        return await self._provider.list_models()

    async def _record(
        self,
        model: str,
        usage: TokenUsage,
        started: float,
        error: ProviderError | None,
        operation: UsageOperation | None = None,
    ) -> None:
        await self._meter.usage.record(
            UsageRecord(
                user_id=self._meter.user_id,
                workspace_id=self._meter.workspace_id,
                provider_kind=self._connection.kind,
                provider_name=self._connection.name,
                model=model,
                operation=operation or self._meter.operation,
                usage=usage,
                cost_micros=estimate_cost(self._connection, usage),
                duration_ms=round((time.monotonic() - started) * 1000),
                success=error is None,
                error_type=type(error).__name__ if error is not None else None,
                processing=self._processing,
                created_at=self._clock(),
            )
        )
