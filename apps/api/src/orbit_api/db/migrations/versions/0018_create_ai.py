"""The AI layer.

- `ai_providers`: provider connections per person; API keys encrypted with the server's AI
  secret key, never returned.
- `ai_settings`: one row per person: on or off, chat, embedding, and fallback models, cloud
  consent, readable modules, response style, a monthly token limit, and indexing.
- `ai_index_sources`, `ai_chunks`: the retrieval index (derived data, rebuildable): one row per
  indexed record with its content hash and state, and its chunks with embeddings stored as
  normalized float32 bytes, so SQLite and PostgreSQL store them the same way.
- `ai_conversations`, `ai_messages`: assistant conversations, per person and workspace.
- `ai_action_proposals`: actions the AI proposed, run only on approval and only once.
- `ai_usage`: provider calls (tokens, cost estimate, duration, outcome), never prompts.
- `ai_insight_dismissals`: insights a person dismissed, by key (which includes the period).

On PostgreSQL every new table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AI_ACTION_PROPOSALS_KIND = (
    "kind IN ('create_task', 'create_reminder', 'create_event', 'create_note', "
    "'append_to_note', 'add_note_tags', 'update_document_details')"
)

TABLES = (
    "ai_providers",
    "ai_conversations",
    "ai_index_sources",
    "ai_insight_dismissals",
    "ai_settings",
    "ai_usage",
    "ai_chunks",
    "ai_messages",
    "ai_action_proposals",
)


def upgrade() -> None:
    op.create_table(
        "ai_providers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("api_key_ciphertext", sa.Text(), nullable=True),
        sa.Column("input_price", sa.Integer(), nullable=True),
        sa.Column("output_price", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('openai', 'anthropic', 'gemini', 'ollama', 'openai_compatible')",
            name=op.f("ck_ai_providers_kind"),
        ),
        sa.CheckConstraint(
            "input_price IS NULL OR input_price >= 0", name=op.f("ck_ai_providers_input_price")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_ai_providers_name_length")
        ),
        sa.CheckConstraint(
            "output_price IS NULL OR output_price >= 0", name=op.f("ck_ai_providers_output_price")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_ai_providers_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_providers")),
        sa.UniqueConstraint("user_id", "name", name=op.f("uq_ai_providers_user_id")),
    )
    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(title) BETWEEN 1 AND 200", name=op.f("ck_ai_conversations_title_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_ai_conversations_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_ai_conversations_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_conversations")),
    )
    with op.batch_alter_table("ai_conversations", schema=None) as batch_op:
        batch_op.create_index(
            "ix_ai_conversations_owner_updated",
            ["workspace_id", "user_id", "updated_at"],
            unique=False,
        )

    op.create_table(
        "ai_index_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("source_date", sa.Date(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.String(length=200), nullable=True),
        sa.Column("embedding_model", sa.String(length=300), nullable=True),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source_type IN ('note', 'document', 'task', 'event', 'habit')",
            name=op.f("ck_ai_index_sources_source_type"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'indexed', 'failed', 'skipped')",
            name=op.f("ck_ai_index_sources_status"),
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_ai_index_sources_attempts")),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_ai_index_sources_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_index_sources")),
        sa.UniqueConstraint(
            "workspace_id",
            "source_type",
            "source_id",
            name=op.f("uq_ai_index_sources_workspace_id"),
        ),
    )
    with op.batch_alter_table("ai_index_sources", schema=None) as batch_op:
        batch_op.create_index(
            "ix_ai_index_sources_status_next", ["status", "next_attempt_at"], unique=False
        )

    op.create_table(
        "ai_insight_dismissals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("insight_key", sa.String(length=200), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_ai_insight_dismissals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_ai_insight_dismissals_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_insight_dismissals")),
        sa.UniqueConstraint(
            "workspace_id",
            "user_id",
            "insight_key",
            name=op.f("uq_ai_insight_dismissals_workspace_id"),
        ),
    )
    op.create_table(
        "ai_settings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("chat_provider_id", sa.Uuid(), nullable=True),
        sa.Column("chat_model", sa.String(length=200), nullable=True),
        sa.Column("embedding_provider_id", sa.Uuid(), nullable=True),
        sa.Column("embedding_model", sa.String(length=200), nullable=True),
        sa.Column("fallback_provider_id", sa.Uuid(), nullable=True),
        sa.Column("fallback_model", sa.String(length=200), nullable=True),
        sa.Column("allow_cloud", sa.Boolean(), nullable=False),
        sa.Column("modules", sa.JSON(), nullable=False),
        sa.Column("response_style", sa.String(length=16), nullable=False),
        sa.Column("monthly_token_limit", sa.Integer(), nullable=True),
        sa.Column("indexing_enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "response_style IN ('concise', 'balanced', 'detailed')",
            name=op.f("ck_ai_settings_response_style"),
        ),
        sa.CheckConstraint(
            "monthly_token_limit IS NULL OR monthly_token_limit > 0",
            name=op.f("ck_ai_settings_monthly_token_limit"),
        ),
        sa.ForeignKeyConstraint(
            ["chat_provider_id"],
            ["ai_providers.id"],
            name=op.f("fk_ai_settings_chat_provider_id_ai_providers"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["embedding_provider_id"],
            ["ai_providers.id"],
            name=op.f("fk_ai_settings_embedding_provider_id_ai_providers"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["fallback_provider_id"],
            ["ai_providers.id"],
            name=op.f("fk_ai_settings_fallback_provider_id_ai_providers"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_ai_settings_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_ai_settings")),
    )
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("provider_kind", sa.String(length=24), nullable=False),
        sa.Column("provider_name", sa.String(length=100), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("operation", sa.String(length=16), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_micros", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_type", sa.String(length=40), nullable=True),
        sa.Column("processing", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "operation IN ('chat', 'assist', 'embedding', 'test')",
            name=op.f("ck_ai_usage_operation"),
        ),
        sa.CheckConstraint("processing IN ('local', 'cloud')", name=op.f("ck_ai_usage_processing")),
        sa.CheckConstraint(
            "provider_kind IN ('openai', 'anthropic', 'gemini', 'ollama', 'openai_compatible')",
            name=op.f("ck_ai_usage_provider_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_ai_usage_user_id_users"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_ai_usage_workspace_id_workspaces"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_usage")),
    )
    with op.batch_alter_table("ai_usage", schema=None) as batch_op:
        batch_op.create_index("ix_ai_usage_user_created", ["user_id", "created_at"], unique=False)

    op.create_table(
        "ai_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("source_ref_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("location", sa.String(length=200), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embedding", sa.LargeBinary(), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("embedding_model", sa.String(length=300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("dimensions > 0", name=op.f("ck_ai_chunks_dimensions")),
        sa.ForeignKeyConstraint(
            ["source_ref_id"],
            ["ai_index_sources.id"],
            name=op.f("fk_ai_chunks_source_ref_id_ai_index_sources"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_ai_chunks_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_chunks")),
    )
    with op.batch_alter_table("ai_chunks", schema=None) as batch_op:
        batch_op.create_index("ix_ai_chunks_source", ["source_ref_id", "position"], unique=False)
        batch_op.create_index(
            "ix_ai_chunks_workspace_model", ["workspace_id", "embedding_model"], unique=False
        )

    op.create_table(
        "ai_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_name", sa.String(length=100), nullable=True),
        sa.Column("model", sa.String(length=200), nullable=True),
        sa.Column("processing", sa.String(length=8), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "processing IS NULL OR processing IN ('local', 'cloud')",
            name=op.f("ck_ai_messages_processing"),
        ),
        sa.CheckConstraint("role IN ('user', 'assistant')", name=op.f("ck_ai_messages_role")),
        sa.CheckConstraint(
            "status IN ('complete', 'error', 'stopped')", name=op.f("ck_ai_messages_status")
        ),
        sa.CheckConstraint("length(content) <= 100000", name=op.f("ck_ai_messages_content_length")),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["ai_conversations.id"],
            name=op.f("fk_ai_messages_conversation_id_ai_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_ai_messages_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_messages")),
    )
    with op.batch_alter_table("ai_messages", schema=None) as batch_op:
        batch_op.create_index(
            "ix_ai_messages_conversation_created", ["conversation_id", "created_at"], unique=False
        )

    op.create_table(
        "ai_action_proposals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("summary", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("from_untrusted_context", sa.Boolean(), nullable=False),
        sa.Column("result_kind", sa.String(length=32), nullable=True),
        sa.Column("result_id", sa.Uuid(), nullable=True),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            AI_ACTION_PROPOSALS_KIND,
            name=op.f("ck_ai_action_proposals_kind"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'executing', 'executed', 'rejected', 'failed')",
            name=op.f("ck_ai_action_proposals_status"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["ai_conversations.id"],
            name=op.f("fk_ai_action_proposals_conversation_id_ai_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["ai_messages.id"],
            name=op.f("fk_ai_action_proposals_message_id_ai_messages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_ai_action_proposals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_ai_action_proposals_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_action_proposals")),
    )
    with op.batch_alter_table("ai_action_proposals", schema=None) as batch_op:
        batch_op.create_index("ix_ai_action_proposals_message", ["message_id"], unique=False)
        batch_op.create_index(
            "ix_ai_action_proposals_owner_status",
            ["workspace_id", "user_id", "status"],
            unique=False,
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("ai_action_proposals", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_action_proposals_owner_status")
        batch_op.drop_index("ix_ai_action_proposals_message")

    op.drop_table("ai_action_proposals")
    with op.batch_alter_table("ai_messages", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_messages_conversation_created")

    op.drop_table("ai_messages")
    with op.batch_alter_table("ai_chunks", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_chunks_workspace_model")
        batch_op.drop_index("ix_ai_chunks_source")

    op.drop_table("ai_chunks")
    with op.batch_alter_table("ai_usage", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_usage_user_created")

    op.drop_table("ai_usage")
    op.drop_table("ai_settings")
    op.drop_table("ai_insight_dismissals")
    with op.batch_alter_table("ai_index_sources", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_index_sources_status_next")

    op.drop_table("ai_index_sources")
    with op.batch_alter_table("ai_conversations", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_conversations_owner_updated")

    op.drop_table("ai_conversations")
    op.drop_table("ai_providers")
