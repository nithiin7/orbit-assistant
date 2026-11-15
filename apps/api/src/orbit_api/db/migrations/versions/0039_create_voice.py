"""Voice conversations.

- `voice_settings`: one row per person (new table; RLS on PostgreSQL).
- `ai_messages` gains `input_mode` ('text' for every existing row), added with plain
  `ADD COLUMN`; the table is not rebuilt, so its proposals are untouched.
- `ai_usage.operation` also allows 'transcription' and 'speech'. On SQLite this rebuilds
  `ai_usage` (batch mode copies every row); no table references it.

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_OPERATIONS = "operation IN ('chat', 'assist', 'embedding', 'test')"
_NEW_OPERATIONS = "operation IN ('chat', 'assist', 'embedding', 'test', 'transcription', 'speech')"


def upgrade() -> None:
    op.create_table(
        "voice_settings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("stt_engine", sa.String(length=16), nullable=False),
        sa.Column("stt_provider_id", sa.Uuid(), nullable=True),
        sa.Column("stt_model", sa.String(length=200), nullable=True),
        sa.Column("tts_engine", sa.String(length=16), nullable=False),
        sa.Column("tts_provider_id", sa.Uuid(), nullable=True),
        sa.Column("tts_model", sa.String(length=200), nullable=True),
        sa.Column("tts_voice", sa.String(length=100), nullable=True),
        sa.Column("recognition_language", sa.String(length=35), nullable=False),
        sa.Column("response_language", sa.String(length=35), nullable=True),
        sa.Column("listening_mode", sa.String(length=16), nullable=False),
        sa.Column("silence_ms", sa.Integer(), nullable=False),
        sa.Column("sensitivity", sa.Integer(), nullable=False),
        sa.Column("auto_speak", sa.Boolean(), nullable=False),
        sa.Column("speaking_rate", sa.Integer(), nullable=False),
        sa.Column("history_days", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "stt_engine IN ('browser', 'provider')", name=op.f("ck_voice_settings_stt_engine")
        ),
        sa.CheckConstraint(
            "tts_engine IN ('browser', 'provider')", name=op.f("ck_voice_settings_tts_engine")
        ),
        sa.CheckConstraint(
            "listening_mode IN ('continuous', 'push_to_talk')",
            name=op.f("ck_voice_settings_listening_mode"),
        ),
        sa.CheckConstraint(
            "silence_ms BETWEEN 300 AND 5000", name=op.f("ck_voice_settings_silence_ms")
        ),
        sa.CheckConstraint(
            "sensitivity BETWEEN 1 AND 10", name=op.f("ck_voice_settings_sensitivity")
        ),
        sa.CheckConstraint(
            "speaking_rate BETWEEN 50 AND 200", name=op.f("ck_voice_settings_speaking_rate")
        ),
        sa.CheckConstraint(
            "history_days IS NULL OR history_days BETWEEN 1 AND 3650",
            name=op.f("ck_voice_settings_history_days"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_voice_settings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["stt_provider_id"],
            ["ai_providers.id"],
            name=op.f("fk_voice_settings_stt_provider_id_ai_providers"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tts_provider_id"],
            ["ai_providers.id"],
            name=op.f("fk_voice_settings_tts_provider_id_ai_providers"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_voice_settings")),
    )
    op.add_column(
        "ai_messages",
        sa.Column("input_mode", sa.String(length=8), nullable=False, server_default="text"),
    )
    with op.batch_alter_table("ai_usage", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_usage_operation"), type_="check")
        batch_op.create_check_constraint(op.f("ck_ai_usage_operation"), _NEW_OPERATIONS)

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE voice_settings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("DELETE FROM ai_usage WHERE operation IN ('transcription', 'speech')")
    with op.batch_alter_table("ai_usage", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_usage_operation"), type_="check")
        batch_op.create_check_constraint(op.f("ck_ai_usage_operation"), _OLD_OPERATIONS)
    with op.batch_alter_table("ai_messages", schema=None) as batch_op:
        batch_op.drop_column("input_mode")
    op.drop_table("voice_settings")
