"""The AI layer: settings and provider connections (per person), the retrieval index,
conversations, action proposals, usage records, and dismissed insights.

Index rows are derived data: they can be deleted and rebuilt from the modules at any time.
Usage rows hold counts and timings only, never prompts or answers.
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

PROVIDER_KINDS = "'openai', 'anthropic', 'gemini', 'ollama', 'openai_compatible'"
SOURCE_TYPES = "'note', 'document', 'task', 'event', 'habit'"
ACTION_KINDS = (
    "'create_task', 'create_reminder', 'create_event', 'create_note', 'append_to_note', "
    "'add_note_tags', 'update_document_details'"
)


class AiProviderModel(Base):
    """A provider connection. `api_key_ciphertext` is encrypted with the server's AI secret key
    (Fernet); it is never returned by the API."""

    __tablename__ = "ai_providers"
    __table_args__ = (
        CheckConstraint(f"kind IN ({PROVIDER_KINDS})", name="kind"),
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("input_price IS NULL OR input_price >= 0", name="input_price"),
        CheckConstraint("output_price IS NULL OR output_price >= 0", name="output_price"),
        UniqueConstraint("user_id", "name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(24))
    base_url: Mapped[str | None] = mapped_column(String(500))
    api_key_ciphertext: Mapped[str | None] = mapped_column(Text)
    input_price: Mapped[int | None] = mapped_column(Integer)
    output_price: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AiSettingsModel(Base):
    """One person's AI settings. No row means AI is off with the defaults."""

    __tablename__ = "ai_settings"
    __table_args__ = (
        CheckConstraint(
            "response_style IN ('concise', 'balanced', 'detailed')", name="response_style"
        ),
        CheckConstraint(
            "monthly_token_limit IS NULL OR monthly_token_limit > 0", name="monthly_token_limit"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean)
    chat_provider_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="SET NULL")
    )
    chat_model: Mapped[str | None] = mapped_column(String(200))
    embedding_provider_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="SET NULL")
    )
    embedding_model: Mapped[str | None] = mapped_column(String(200))
    fallback_provider_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="SET NULL")
    )
    fallback_model: Mapped[str | None] = mapped_column(String(200))
    allow_cloud: Mapped[bool] = mapped_column(Boolean)
    modules: Mapped[list[str]] = mapped_column(JSON)
    response_style: Mapped[str] = mapped_column(String(16))
    monthly_token_limit: Mapped[int | None] = mapped_column(Integer)
    indexing_enabled: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AiIndexSourceModel(Base):
    """One indexed record and its indexing state: the work queue of the indexer.

    `content_hash` fingerprints what was indexed, so unchanged records are never embedded
    again; `embedding_model` records which model produced the chunks, so changing models
    re-indexes. `lease_until` lets several workers share the queue."""

    __tablename__ = "ai_index_sources"
    __table_args__ = (
        CheckConstraint(f"source_type IN ({SOURCE_TYPES})", name="source_type"),
        CheckConstraint("status IN ('pending', 'indexed', 'failed', 'skipped')", name="status"),
        CheckConstraint("attempts >= 0", name="attempts"),
        UniqueConstraint("workspace_id", "source_type", "source_id"),
        Index("ix_ai_index_sources_status_next", "status", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    source_type: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[uuid.UUID] = mapped_column()
    title: Mapped[str] = mapped_column(String(300))
    source_date: Mapped[date | None] = mapped_column(Date)
    content_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(String(200))
    embedding_model: Mapped[str | None] = mapped_column(String(300))
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    lease_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    next_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    indexed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AiChunkModel(Base):
    """A chunk of a record's text with its embedding (normalized float32, little-endian)."""

    __tablename__ = "ai_chunks"
    __table_args__ = (
        CheckConstraint("dimensions > 0", name="dimensions"),
        Index("ix_ai_chunks_workspace_model", "workspace_id", "embedding_model"),
        Index("ix_ai_chunks_source", "source_ref_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    source_ref_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ai_index_sources.id", ondelete="CASCADE")
    )
    position: Mapped[int] = mapped_column(Integer)
    location: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[bytes] = mapped_column(LargeBinary)
    dimensions: Mapped[int] = mapped_column(Integer)
    embedding_model: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AiConversationModel(Base):
    __tablename__ = "ai_conversations"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        Index("ix_ai_conversations_owner_updated", "workspace_id", "user_id", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AiMessageModel(Base):
    __tablename__ = "ai_messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="role"),
        CheckConstraint("status IN ('complete', 'error', 'stopped')", name="status"),
        CheckConstraint(
            "processing IS NULL OR processing IN ('local', 'cloud')", name="processing"
        ),
        CheckConstraint("length(content) <= 100000", name="content_length"),
        Index("ix_ai_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ai_conversations.id", ondelete="CASCADE")
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    # Numbered sources: `[{"number", "kind", "id", "title", "day", "detail", "cited"}]`.
    citations: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16))
    provider_name: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(200))
    processing: Mapped[str | None] = mapped_column(String(8))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AiActionProposalModel(Base):
    """An action the AI proposed. It runs only when its owner approves it, and only once:
    approval moves `pending` to `executing` with a conditional update, so a second approval
    finds nothing to claim."""

    __tablename__ = "ai_action_proposals"
    __table_args__ = (
        CheckConstraint(f"kind IN ({ACTION_KINDS})", name="kind"),
        CheckConstraint(
            "status IN ('pending', 'executing', 'executed', 'rejected', 'failed')", name="status"
        ),
        Index("ix_ai_action_proposals_owner_status", "workspace_id", "user_id", "status"),
        Index("ix_ai_action_proposals_message", "message_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_conversations.id", ondelete="CASCADE")
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_messages.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    summary: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(16))
    from_untrusted_context: Mapped[bool] = mapped_column(Boolean)
    result_kind: Mapped[str | None] = mapped_column(String(32))
    result_id: Mapped[uuid.UUID | None] = mapped_column()
    error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AiUsageModel(Base):
    """One provider call: who, which provider and model, what for, tokens, cost estimate, time,
    and outcome. Never the prompt or the answer."""

    __tablename__ = "ai_usage"
    __table_args__ = (
        CheckConstraint(f"provider_kind IN ({PROVIDER_KINDS})", name="provider_kind"),
        CheckConstraint("operation IN ('chat', 'assist', 'embedding', 'test')", name="operation"),
        CheckConstraint("processing IN ('local', 'cloud')", name="processing"),
        Index("ix_ai_usage_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL")
    )
    provider_kind: Mapped[str] = mapped_column(String(24))
    provider_name: Mapped[str] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(200))
    operation: Mapped[str] = mapped_column(String(16))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cost_micros: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int] = mapped_column(Integer)
    success: Mapped[bool] = mapped_column(Boolean)
    error_type: Mapped[str | None] = mapped_column(String(40))
    processing: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AiInsightDismissalModel(Base):
    __tablename__ = "ai_insight_dismissals"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", "insight_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    insight_key: Mapped[str] = mapped_column(String(200))
    dismissed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
