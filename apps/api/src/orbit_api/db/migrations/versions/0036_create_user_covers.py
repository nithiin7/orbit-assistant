"""Profile cover photos.

A new `user_covers` table beside `user_avatars`, with the same shape and a larger size limit.
No existing table is changed. Like `user_avatars`, it has Row Level Security enabled with no
policies on PostgreSQL, so Supabase's Data API roles cannot reach it; the API enforces access.

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_covers",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "content_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name=op.f("ck_user_covers_content_type"),
        ),
        sa.CheckConstraint(
            "length(data) BETWEEN 1 AND 1572864", name=op.f("ck_user_covers_data_size")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_covers_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_covers")),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE user_covers ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("user_covers")
