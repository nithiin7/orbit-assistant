"""Server-wide settings, for update notices.

Adds one new table, `system_settings` (RLS on PostgreSQL). No existing table is changed.

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0055"
down_revision: str | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("update_check_enabled", sa.Boolean(), nullable=False),
        sa.Column("latest_version", sa.String(length=32), nullable=True),
        sa.Column("latest_published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_failed", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_system_settings_single_row")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_system_settings")),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("system_settings")
