"""Dashboard layouts.

Like `user_avatars`, `dashboard_layouts` has Row Level Security enabled with no policies on
PostgreSQL, so Supabase's Data API roles cannot reach it; the API enforces access itself.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dashboard_layouts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("widgets", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_dashboard_layouts_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_dashboard_layouts")),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE dashboard_layouts ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("dashboard_layouts")
