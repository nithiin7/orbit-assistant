"""Daily briefings.

- `daily_briefings`: one structured snapshot per person, workspace, and local date (new table;
  RLS on PostgreSQL). No existing table is altered or rebuilt.

Revision ID: 0040
Revises: 0039
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_briefings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("briefing_date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("format_version", sa.Integer(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('complete', 'partial')", name=op.f("ck_daily_briefings_status")
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_daily_briefings_revision")),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_daily_briefings_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_daily_briefings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_daily_briefings")),
        sa.UniqueConstraint(
            "workspace_id",
            "user_id",
            "briefing_date",
            name=op.f("uq_daily_briefings_workspace_id"),
        ),
    )
    op.create_index(
        "ix_daily_briefings_user_id_briefing_date",
        "daily_briefings",
        ["user_id", "briefing_date"],
        unique=False,
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_daily_briefings_user_id_briefing_date", table_name="daily_briefings")
    op.drop_table("daily_briefings")
