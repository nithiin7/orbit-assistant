"""Briefing settings and AI summaries.

- `briefing_settings`: one row per person and workspace (new table; RLS on PostgreSQL).
- `daily_briefings` gains a nullable `narrative`, added with plain `ADD COLUMN`; the table is
  not rebuilt, so stored briefings are untouched.

Revision ID: 0041
Revises: 0040
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "briefing_settings",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("hidden_sources", sa.JSON(), nullable=False),
        sa.Column("prepare_at", sa.Time(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "horizon_days BETWEEN 1 AND 14", name=op.f("ck_briefing_settings_horizon_days")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_briefing_settings_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_briefing_settings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", "user_id", name=op.f("pk_briefing_settings")),
    )
    op.create_index(
        "ix_briefing_settings_prepare_at", "briefing_settings", ["prepare_at"], unique=False
    )
    op.add_column("daily_briefings", sa.Column("narrative", sa.JSON(), nullable=True))
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE briefing_settings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("daily_briefings", schema=None) as batch_op:
        batch_op.drop_column("narrative")
    op.drop_index("ix_briefing_settings_prepare_at", table_name="briefing_settings")
    op.drop_table("briefing_settings")
