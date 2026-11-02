"""SQLAlchemy repositories for the AI layer. Every query is scoped to the owning user, and
workspace data to its workspace as well."""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Final, cast

from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    AiActionProposalModel,
    AiChunkModel,
    AiConversationModel,
    AiIndexSourceModel,
    AiInsightDismissalModel,
    AiMessageModel,
    AiProviderModel,
    AiSettingsModel,
    AiUsageModel,
    WorkspaceModel,
)
from orbit_api.repositories.transaction import flush
from orbit_api.services.ai.models import (
    ACTION_KINDS,
    AI_MODULES,
    PROVIDER_KINDS,
    SOURCE_TYPES,
    ActionKind,
    ActionResult,
    AiModule,
    AiSettings,
    Chunk,
    Citation,
    Conversation,
    IndexedSource,
    IndexStatus,
    IndexSummary,
    Message,
    MessageStatus,
    Processing,
    Proposal,
    ProposalStatus,
    ProviderConnection,
    ProviderKind,
    RecordRef,
    ResponseStyle,
    SourceStamp,
    SourceType,
    StoredChunk,
    TokenUsage,
    UsageLine,
    UsageOperation,
    UsageRecord,
)
from orbit_api.services.ai.vectors import pack, unpack

_INDEX_STATUSES: Final[dict[str, IndexStatus]] = {
    s: s for s in ("pending", "indexed", "failed", "skipped")
}
_SOURCE_TYPES: Final[dict[str, SourceType]] = {t: t for t in SOURCE_TYPES}
_PROVIDER_KINDS: Final[dict[str, ProviderKind]] = {k: k for k in PROVIDER_KINDS}
_ACTION_KINDS: Final[dict[str, ActionKind]] = {k: k for k in ACTION_KINDS}
_MODULES: Final[dict[str, AiModule]] = {m: m for m in AI_MODULES}
_PROPOSAL_STATUSES: Final[dict[str, ProposalStatus]] = {
    s: s for s in ("pending", "executing", "executed", "rejected", "failed")
}
_MESSAGE_STATUSES: Final[dict[str, MessageStatus]] = {
    s: s for s in ("complete", "error", "stopped")
}
_STYLES: Final[dict[str, ResponseStyle]] = {s: s for s in ("concise", "balanced", "detailed")}
_OPERATIONS: Final[dict[str, UsageOperation]] = {
    o: o for o in ("chat", "assist", "embedding", "test")
}
_PROCESSING: Final[dict[str, Processing]] = {"local": "local", "cloud": "cloud"}


# Settings and providers


class SqlAiSettingsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: uuid.UUID) -> AiSettings | None:
        model = await self._session.get(AiSettingsModel, user_id)
        if model is None:
            return None
        return AiSettings(
            user_id=model.user_id,
            enabled=model.enabled,
            chat_provider_id=model.chat_provider_id,
            chat_model=model.chat_model,
            embedding_provider_id=model.embedding_provider_id,
            embedding_model=model.embedding_model,
            fallback_provider_id=model.fallback_provider_id,
            fallback_model=model.fallback_model,
            allow_cloud=model.allow_cloud,
            modules=frozenset(_MODULES[m] for m in model.modules if m in _MODULES),
            response_style=_STYLES.get(model.response_style, "balanced"),
            monthly_token_limit=model.monthly_token_limit,
            indexing_enabled=model.indexing_enabled,
            updated_at=model.updated_at,
        )

    async def put(self, settings: AiSettings) -> None:
        model = await self._session.get(AiSettingsModel, settings.user_id)
        if model is None:
            model = AiSettingsModel(user_id=settings.user_id)
            self._session.add(model)
        model.enabled = settings.enabled
        model.chat_provider_id = settings.chat_provider_id
        model.chat_model = settings.chat_model
        model.embedding_provider_id = settings.embedding_provider_id
        model.embedding_model = settings.embedding_model
        model.fallback_provider_id = settings.fallback_provider_id
        model.fallback_model = settings.fallback_model
        model.allow_cloud = settings.allow_cloud
        model.modules = sorted(settings.modules)
        model.response_style = settings.response_style
        model.monthly_token_limit = settings.monthly_token_limit
        model.indexing_enabled = settings.indexing_enabled
        if settings.updated_at is not None:
            model.updated_at = settings.updated_at
        await flush(self._session)

    async def indexing_workspaces(self) -> list[tuple[uuid.UUID, uuid.UUID]]:
        """`(user, workspace)` pairs whose owner has AI and indexing on and an embedding model."""
        rows = await self._session.execute(
            select(AiSettingsModel.user_id, WorkspaceModel.id)
            .join(WorkspaceModel, WorkspaceModel.owner_id == AiSettingsModel.user_id)
            .where(
                AiSettingsModel.enabled.is_(True),
                AiSettingsModel.indexing_enabled.is_(True),
                AiSettingsModel.embedding_provider_id.is_not(None),
                AiSettingsModel.embedding_model.is_not(None),
            )
            .order_by(AiSettingsModel.user_id, WorkspaceModel.id)
        )
        return [(user_id, workspace_id) for user_id, workspace_id in rows]


def _provider(model: AiProviderModel) -> ProviderConnection:
    return ProviderConnection(
        id=model.id,
        user_id=model.user_id,
        name=model.name,
        kind=_PROVIDER_KINDS[model.kind],
        base_url=model.base_url,
        api_key_ciphertext=model.api_key_ciphertext,
        input_price=model.input_price,
        output_price=model.output_price,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlAiProviderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(self, user_id: uuid.UUID) -> list[ProviderConnection]:
        rows = await self._session.scalars(
            select(AiProviderModel)
            .where(AiProviderModel.user_id == user_id)
            .order_by(AiProviderModel.created_at, AiProviderModel.id)
        )
        return [_provider(row) for row in rows]

    async def get(self, user_id: uuid.UUID, provider_id: uuid.UUID) -> ProviderConnection | None:
        model = await self._session.scalar(
            select(AiProviderModel).where(
                AiProviderModel.id == provider_id, AiProviderModel.user_id == user_id
            )
        )
        return _provider(model) if model else None

    async def add(self, connection: ProviderConnection) -> None:
        self._session.add(
            AiProviderModel(
                id=connection.id,
                user_id=connection.user_id,
                name=connection.name,
                kind=connection.kind,
                base_url=connection.base_url,
                api_key_ciphertext=connection.api_key_ciphertext,
                input_price=connection.input_price,
                output_price=connection.output_price,
                created_at=connection.created_at,
                updated_at=connection.updated_at,
            )
        )
        await flush(self._session)

    async def save(self, connection: ProviderConnection) -> None:
        await self._session.execute(
            update(AiProviderModel)
            .where(
                AiProviderModel.id == connection.id, AiProviderModel.user_id == connection.user_id
            )
            .values(
                name=connection.name,
                base_url=connection.base_url,
                api_key_ciphertext=connection.api_key_ciphertext,
                input_price=connection.input_price,
                output_price=connection.output_price,
                updated_at=connection.updated_at,
            )
        )
        await flush(self._session)

    async def delete(self, user_id: uuid.UUID, provider_id: uuid.UUID) -> bool:
        # Selections in `ai_settings` are cleared here rather than relying only on the foreign
        # keys' ON DELETE SET NULL, so it holds even where foreign keys are off.
        for column in ("chat_provider_id", "embedding_provider_id", "fallback_provider_id"):
            await self._session.execute(
                update(AiSettingsModel)
                .where(
                    AiSettingsModel.user_id == user_id,
                    getattr(AiSettingsModel, column) == provider_id,
                )
                .values({column: None})
            )
        result = await self._session.execute(
            delete(AiProviderModel).where(
                AiProviderModel.id == provider_id, AiProviderModel.user_id == user_id
            )
        )
        await flush(self._session)
        return cast(int, getattr(result, "rowcount", 0)) > 0


# Usage


class SqlAiUsageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, record: UsageRecord) -> None:
        self._session.add(
            AiUsageModel(
                id=uuid.uuid4(),
                user_id=record.user_id,
                workspace_id=record.workspace_id,
                provider_kind=record.provider_kind,
                provider_name=record.provider_name[:100],
                model=record.model[:200],
                operation=record.operation,
                input_tokens=record.usage.input_tokens,
                output_tokens=record.usage.output_tokens,
                cost_micros=record.cost_micros,
                duration_ms=record.duration_ms,
                success=record.success,
                error_type=record.error_type[:40] if record.error_type else None,
                processing=record.processing,
                created_at=record.created_at,
            )
        )
        await flush(self._session)

    async def lines(self, user_id: uuid.UUID, since: datetime) -> list[UsageLine]:
        failures = func.sum(case((AiUsageModel.success.is_(False), 1), else_=0))
        rows = await self._session.execute(
            select(
                AiUsageModel.provider_name,
                AiUsageModel.model,
                AiUsageModel.operation,
                func.count(),
                failures,
                func.coalesce(func.sum(AiUsageModel.input_tokens), 0),
                func.coalesce(func.sum(AiUsageModel.output_tokens), 0),
                func.sum(AiUsageModel.cost_micros),
            )
            .where(AiUsageModel.user_id == user_id, AiUsageModel.created_at >= since)
            .group_by(AiUsageModel.provider_name, AiUsageModel.model, AiUsageModel.operation)
            .order_by(AiUsageModel.provider_name, AiUsageModel.model, AiUsageModel.operation)
        )
        return [
            UsageLine(
                provider_name=name,
                model=model,
                operation=_OPERATIONS.get(operation, "chat"),
                requests=int(count),
                failures=int(failed or 0),
                input_tokens=int(inputs or 0),
                output_tokens=int(outputs or 0),
                cost_micros=int(cost) if cost is not None else None,
            )
            for name, model, operation, count, failed, inputs, outputs, cost in rows
        ]

    async def tokens_since(self, user_id: uuid.UUID, since: datetime) -> int:
        total = await self._session.scalar(
            select(
                func.coalesce(
                    func.sum(
                        func.coalesce(AiUsageModel.input_tokens, 0)
                        + func.coalesce(AiUsageModel.output_tokens, 0)
                    ),
                    0,
                )
            ).where(AiUsageModel.user_id == user_id, AiUsageModel.created_at >= since)
        )
        return int(total or 0)


# Index


def _source(model: AiIndexSourceModel) -> IndexedSource:
    return IndexedSource(
        id=model.id,
        workspace_id=model.workspace_id,
        source_type=_SOURCE_TYPES[model.source_type],
        source_id=model.source_id,
        title=model.title,
        day=model.source_date,
        content_hash=model.content_hash,
        status=_INDEX_STATUSES[model.status],
        attempts=model.attempts,
        last_error=model.last_error,
        embedding_model=model.embedding_model,
        chunk_count=model.chunk_count,
        indexed_at=model.indexed_at,
        updated_at=model.updated_at,
    )


class SqlIndexRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def sources(self, workspace_id: uuid.UUID) -> list[IndexedSource]:
        rows = await self._session.scalars(
            select(AiIndexSourceModel).where(AiIndexSourceModel.workspace_id == workspace_id)
        )
        return [_source(row) for row in rows]

    async def mark_pending(
        self, workspace_id: uuid.UUID, stamp: SourceStamp, now: datetime
    ) -> None:
        model = await self._session.scalar(
            select(AiIndexSourceModel).where(
                AiIndexSourceModel.workspace_id == workspace_id,
                AiIndexSourceModel.source_type == stamp.source_type,
                AiIndexSourceModel.source_id == stamp.source_id,
            )
        )
        if model is None:
            model = AiIndexSourceModel(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                source_type=stamp.source_type,
                source_id=stamp.source_id,
                chunk_count=0,
            )
            self._session.add(model)
        model.title = stamp.title
        model.source_date = stamp.day
        model.content_hash = stamp.content_hash
        model.status = "pending"
        model.attempts = 0
        model.last_error = None
        model.lease_until = None
        model.next_attempt_at = None
        model.updated_at = now
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, ids: Sequence[uuid.UUID]) -> None:
        if not ids:
            return
        # Chunks first, explicitly: they must never outlive their record.
        await self._session.execute(
            delete(AiChunkModel).where(
                AiChunkModel.workspace_id == workspace_id, AiChunkModel.source_ref_id.in_(ids)
            )
        )
        await self._session.execute(
            delete(AiIndexSourceModel).where(
                AiIndexSourceModel.workspace_id == workspace_id, AiIndexSourceModel.id.in_(ids)
            )
        )

    async def delete_types(self, workspace_id: uuid.UUID, types: Sequence[SourceType]) -> int:
        ids = list(
            await self._session.scalars(
                select(AiIndexSourceModel.id).where(
                    AiIndexSourceModel.workspace_id == workspace_id,
                    AiIndexSourceModel.source_type.in_(types),
                )
            )
        )
        await self.delete(workspace_id, ids)
        return len(ids)

    async def claim(
        self, workspace_id: uuid.UUID, now: datetime, lease_until: datetime, limit: int
    ) -> list[IndexedSource]:
        due = and_(
            AiIndexSourceModel.workspace_id == workspace_id,
            or_(
                AiIndexSourceModel.status == "pending",
                and_(
                    AiIndexSourceModel.status == "failed",
                    AiIndexSourceModel.next_attempt_at.is_not(None),
                    AiIndexSourceModel.next_attempt_at <= now,
                ),
            ),
            or_(AiIndexSourceModel.lease_until.is_(None), AiIndexSourceModel.lease_until < now),
        )
        ids = list(
            await self._session.scalars(
                select(AiIndexSourceModel.id)
                .where(due)
                .order_by(AiIndexSourceModel.updated_at, AiIndexSourceModel.id)
                .limit(limit)
            )
        )
        claimed: list[IndexedSource] = []
        for source_id in ids:
            # Conditional update: another worker that claimed it first wins.
            result = await self._session.execute(
                update(AiIndexSourceModel)
                .where(AiIndexSourceModel.id == source_id, due)
                .values(lease_until=lease_until)
            )
            if cast(int, getattr(result, "rowcount", 0)) == 1:
                model = await self._session.get(
                    AiIndexSourceModel, source_id, populate_existing=True
                )
                if model is not None:
                    claimed.append(_source(model))
        return claimed

    async def store_chunks(
        self,
        source: IndexedSource,
        chunks: Sequence[Chunk],
        model_key: str,
        title: str,
        now: datetime,
    ) -> None:
        await self._session.execute(
            delete(AiChunkModel).where(AiChunkModel.source_ref_id == source.id)
        )
        for chunk in chunks:
            self._session.add(
                AiChunkModel(
                    id=uuid.uuid4(),
                    workspace_id=source.workspace_id,
                    source_ref_id=source.id,
                    position=chunk.position,
                    location=chunk.location,
                    text=chunk.text,
                    embedding=pack(chunk.vector),
                    dimensions=len(chunk.vector),
                    embedding_model=model_key,
                    created_at=now,
                )
            )
        await self._session.execute(
            update(AiIndexSourceModel)
            .where(AiIndexSourceModel.id == source.id)
            .values(
                status="indexed",
                title=title,
                attempts=0,
                last_error=None,
                embedding_model=model_key,
                chunk_count=len(chunks),
                lease_until=None,
                next_attempt_at=None,
                indexed_at=now,
                updated_at=now,
            )
        )
        await flush(self._session)

    async def mark_failed(
        self, source_id: uuid.UUID, error: str, next_attempt_at: datetime | None, now: datetime
    ) -> None:
        await self._session.execute(
            update(AiIndexSourceModel)
            .where(AiIndexSourceModel.id == source_id)
            .values(
                status="failed",
                attempts=AiIndexSourceModel.attempts + 1,
                last_error=error,
                lease_until=None,
                next_attempt_at=next_attempt_at,
                updated_at=now,
            )
        )

    async def summary(self, workspace_id: uuid.UUID) -> IndexSummary:
        rows = await self._session.execute(
            select(AiIndexSourceModel.status, func.count())
            .where(AiIndexSourceModel.workspace_id == workspace_id)
            .group_by(AiIndexSourceModel.status)
        )
        counts: dict[IndexStatus, int] = dict.fromkeys(_INDEX_STATUSES.values(), 0)
        for status, count in rows:
            counts[_INDEX_STATUSES[status]] = int(count)
        last = await self._session.scalar(
            select(func.max(AiIndexSourceModel.indexed_at)).where(
                AiIndexSourceModel.workspace_id == workspace_id
            )
        )
        return IndexSummary(counts=counts, embedding_model=None, last_indexed_at=last, active=False)

    async def reset(self, workspace_id: uuid.UUID, now: datetime) -> int:
        result = await self._session.execute(
            update(AiIndexSourceModel)
            .where(AiIndexSourceModel.workspace_id == workspace_id)
            .values(
                status="pending",
                attempts=0,
                last_error=None,
                lease_until=None,
                next_attempt_at=None,
                updated_at=now,
            )
        )
        return cast(int, getattr(result, "rowcount", 0))

    async def retry_failed(self, workspace_id: uuid.UUID, now: datetime) -> int:
        result = await self._session.execute(
            update(AiIndexSourceModel)
            .where(
                AiIndexSourceModel.workspace_id == workspace_id,
                AiIndexSourceModel.status == "failed",
            )
            .values(status="pending", attempts=0, next_attempt_at=None, updated_at=now)
        )
        return cast(int, getattr(result, "rowcount", 0))

    async def clear(self, workspace_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(AiChunkModel).where(AiChunkModel.workspace_id == workspace_id)
        )
        await self._session.execute(
            delete(AiIndexSourceModel).where(AiIndexSourceModel.workspace_id == workspace_id)
        )

    async def chunks(
        self, workspace_id: uuid.UUID, model_key: str, types: Sequence[SourceType]
    ) -> list[StoredChunk]:
        rows = await self._session.execute(
            select(
                AiIndexSourceModel.source_type,
                AiIndexSourceModel.source_id,
                AiIndexSourceModel.title,
                AiIndexSourceModel.source_date,
                AiChunkModel.location,
                AiChunkModel.text,
                AiChunkModel.embedding,
            )
            .join(AiIndexSourceModel, AiIndexSourceModel.id == AiChunkModel.source_ref_id)
            .where(
                AiChunkModel.workspace_id == workspace_id,
                AiIndexSourceModel.workspace_id == workspace_id,
                AiChunkModel.embedding_model == model_key,
                AiIndexSourceModel.source_type.in_(types),
            )
        )
        return [
            StoredChunk(
                source_type=_SOURCE_TYPES[source_type],
                source_id=source_id,
                title=title,
                day=day,
                location=location,
                text=text,
                vector=unpack(embedding),
            )
            for source_type, source_id, title, day, location, text, embedding in rows
        ]


# Conversations


def _citations(stored: object) -> tuple[Citation, ...]:
    if not isinstance(stored, list):
        return ()
    citations: list[Citation] = []
    for entry in cast(list[object], stored):
        if not isinstance(entry, dict):
            continue
        data = cast(dict[str, Any], entry)
        try:
            ref_id = uuid.UUID(data["id"]) if data.get("id") else None
            day = datetime.fromisoformat(data["day"]).date() if data.get("day") else None
            citations.append(
                Citation(
                    number=int(data["number"]),
                    ref=RecordRef(
                        kind=str(data["kind"]),
                        id=ref_id,
                        title=str(data.get("title", "")),
                        day=day,
                        detail=str(data.get("detail", "")),
                    ),
                    cited=bool(data.get("cited", False)),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return tuple(citations)


def _encode_citations(citations: Sequence[Citation]) -> list[dict[str, Any]]:
    return [
        {
            "number": c.number,
            "kind": c.ref.kind,
            "id": str(c.ref.id) if c.ref.id else None,
            "title": c.ref.title,
            "day": c.ref.day.isoformat() if c.ref.day else None,
            "detail": c.ref.detail,
            "cited": c.cited,
        }
        for c in citations
    ]


def _conversation(model: AiConversationModel) -> Conversation:
    return Conversation(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        title=model.title,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlConversationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def recent(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, limit: int
    ) -> list[Conversation]:
        rows = await self._session.scalars(
            select(AiConversationModel)
            .where(
                AiConversationModel.workspace_id == workspace_id,
                AiConversationModel.user_id == user_id,
            )
            .order_by(AiConversationModel.updated_at.desc(), AiConversationModel.id)
            .limit(limit)
        )
        return [_conversation(row) for row in rows]

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> Conversation | None:
        model = await self._session.scalar(
            select(AiConversationModel).where(
                AiConversationModel.id == conversation_id,
                AiConversationModel.workspace_id == workspace_id,
                AiConversationModel.user_id == user_id,
            )
        )
        return _conversation(model) if model else None

    async def add(self, conversation: Conversation) -> None:
        self._session.add(
            AiConversationModel(
                id=conversation.id,
                workspace_id=conversation.workspace_id,
                user_id=conversation.user_id,
                title=conversation.title,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
            )
        )
        await flush(self._session)

    async def save(self, conversation: Conversation) -> None:
        await self._session.execute(
            update(AiConversationModel)
            .where(
                AiConversationModel.id == conversation.id,
                AiConversationModel.workspace_id == conversation.workspace_id,
                AiConversationModel.user_id == conversation.user_id,
            )
            .values(title=conversation.title, updated_at=conversation.updated_at)
        )
        await flush(self._session)

    async def delete(self, conversation: Conversation) -> None:
        # Proposals and messages first, so this holds even where foreign keys are off.
        await self._session.execute(
            delete(AiActionProposalModel).where(
                AiActionProposalModel.conversation_id == conversation.id
            )
        )
        await self._session.execute(
            delete(AiMessageModel).where(AiMessageModel.conversation_id == conversation.id)
        )
        await self._session.execute(
            delete(AiConversationModel).where(
                AiConversationModel.id == conversation.id,
                AiConversationModel.user_id == conversation.user_id,
            )
        )

    async def messages(self, conversation_id: uuid.UUID) -> list[Message]:
        rows = await self._session.scalars(
            select(AiMessageModel)
            .where(AiMessageModel.conversation_id == conversation_id)
            .order_by(AiMessageModel.created_at, AiMessageModel.id)
        )
        return [
            Message(
                id=row.id,
                conversation_id=row.conversation_id,
                workspace_id=row.workspace_id,
                role="user" if row.role == "user" else "assistant",
                content=row.content,
                citations=_citations(row.citations),
                status=_MESSAGE_STATUSES.get(row.status, "complete"),
                provider_name=row.provider_name,
                model=row.model,
                processing=_PROCESSING.get(row.processing or ""),
                usage=TokenUsage(input_tokens=row.input_tokens, output_tokens=row.output_tokens),
                created_at=row.created_at,
            )
            for row in rows
        ]

    async def add_message(self, message: Message) -> None:
        self._session.add(
            AiMessageModel(
                id=message.id,
                conversation_id=message.conversation_id,
                workspace_id=message.workspace_id,
                role=message.role,
                content=message.content,
                citations=_encode_citations(message.citations),
                status=message.status,
                provider_name=message.provider_name,
                model=message.model,
                processing=message.processing,
                input_tokens=message.usage.input_tokens,
                output_tokens=message.usage.output_tokens,
                created_at=message.created_at,
            )
        )
        await flush(self._session)


# Proposals


def _proposal(model: AiActionProposalModel) -> Proposal:
    return Proposal(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        conversation_id=model.conversation_id,
        message_id=model.message_id,
        kind=_ACTION_KINDS[model.kind],
        payload=dict(model.payload),
        summary=model.summary,
        status=_PROPOSAL_STATUSES[model.status],
        from_untrusted_context=model.from_untrusted_context,
        result_kind=model.result_kind,
        result_id=model.result_id,
        error=model.error,
        created_at=model.created_at,
        decided_at=model.decided_at,
    )


class SqlProposalRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, proposal: Proposal) -> None:
        self._session.add(
            AiActionProposalModel(
                id=proposal.id,
                workspace_id=proposal.workspace_id,
                user_id=proposal.user_id,
                conversation_id=proposal.conversation_id,
                message_id=proposal.message_id,
                kind=proposal.kind,
                payload=proposal.payload,
                summary=proposal.summary,
                status=proposal.status,
                from_untrusted_context=proposal.from_untrusted_context,
                created_at=proposal.created_at,
            )
        )
        await flush(self._session)

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal | None:
        model = await self._session.scalar(
            select(AiActionProposalModel)
            .where(
                AiActionProposalModel.id == proposal_id,
                AiActionProposalModel.workspace_id == workspace_id,
                AiActionProposalModel.user_id == user_id,
            )
            .execution_options(populate_existing=True)
        )
        return _proposal(model) if model else None

    async def for_messages(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, message_ids: Sequence[uuid.UUID]
    ) -> list[Proposal]:
        if not message_ids:
            return []
        rows = await self._session.scalars(
            select(AiActionProposalModel)
            .where(
                AiActionProposalModel.workspace_id == workspace_id,
                AiActionProposalModel.user_id == user_id,
                AiActionProposalModel.message_id.in_(message_ids),
            )
            .order_by(AiActionProposalModel.created_at, AiActionProposalModel.id)
        )
        return [_proposal(row) for row in rows]

    async def transition(
        self,
        proposal_id: uuid.UUID,
        expected: ProposalStatus,
        status: ProposalStatus,
        now: datetime,
    ) -> bool:
        result = await self._session.execute(
            update(AiActionProposalModel)
            .where(
                AiActionProposalModel.id == proposal_id, AiActionProposalModel.status == expected
            )
            .values(status=status, decided_at=now)
        )
        return cast(int, getattr(result, "rowcount", 0)) == 1

    async def finish(
        self,
        proposal_id: uuid.UUID,
        status: ProposalStatus,
        result: ActionResult | None,
        error: str | None,
    ) -> None:
        await self._session.execute(
            update(AiActionProposalModel)
            .where(AiActionProposalModel.id == proposal_id)
            .values(
                status=status,
                result_kind=result.kind if result else None,
                result_id=result.id if result else None,
                error=error,
            )
        )


# Insights


class SqlDismissalRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def keys(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> set[str]:
        rows = await self._session.scalars(
            select(AiInsightDismissalModel.insight_key).where(
                AiInsightDismissalModel.workspace_id == workspace_id,
                AiInsightDismissalModel.user_id == user_id,
            )
        )
        return set(rows)

    async def add(self, workspace_id: uuid.UUID, user_id: uuid.UUID, key: str) -> None:
        self._session.add(
            AiInsightDismissalModel(
                id=uuid.uuid4(), workspace_id=workspace_id, user_id=user_id, insight_key=key[:200]
            )
        )
        await flush(self._session)
