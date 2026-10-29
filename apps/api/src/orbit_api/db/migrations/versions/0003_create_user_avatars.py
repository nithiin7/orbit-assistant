"""Profile photos.

Like the identity tables, `user_avatars` has Row Level Security enabled with no policies on
PostgreSQL, so Supabase's Data API roles cannot reach it; the API enforces access itself.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_avatars",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "content_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name=op.f("ck_user_avatars_content_type"),
        ),
        sa.CheckConstraint(
            "length(data) BETWEEN 1 AND 524288", name=op.f("ck_user_avatars_data_size")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_avatars_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_avatars")),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE user_avatars ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("user_avatars")
