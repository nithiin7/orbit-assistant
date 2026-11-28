"""App lock.

Adds three new tables, `app_lock_settings`, `app_lock_credentials`, and `app_lock_sessions` (RLS
on PostgreSQL). No existing table is changed.

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0054"
down_revision: str | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_lock_settings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("pin_hash", sa.String(length=255), nullable=False),
        sa.Column("pin_length", sa.Integer(), nullable=False),
        sa.Column("lock_after_minutes", sa.Integer(), nullable=False),
        sa.Column("sign_out_after_minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_app_lock_settings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_app_lock_settings")),
    )
    op.create_table(
        "app_lock_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False),
        sa.Column("rp_id", sa.String(length=255), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_app_lock_credentials_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_lock_credentials")),
        sa.UniqueConstraint("credential_id", name="uq_app_lock_credentials_credential_id"),
    )
    op.create_index(
        "ix_app_lock_credentials_user_id", "app_lock_credentials", ["user_id"], unique=False
    )
    op.create_table(
        "app_lock_sessions",
        sa.Column("session_key", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=False),
        sa.Column("challenge", sa.LargeBinary(), nullable=True),
        sa.Column("challenge_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_app_lock_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("session_key", name=op.f("pk_app_lock_sessions")),
    )
    op.create_index("ix_app_lock_sessions_user_id", "app_lock_sessions", ["user_id"], unique=False)
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE app_lock_settings ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE app_lock_credentials ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE app_lock_sessions ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_app_lock_sessions_user_id", table_name="app_lock_sessions")
    op.drop_table("app_lock_sessions")
    op.drop_index("ix_app_lock_credentials_user_id", table_name="app_lock_credentials")
    op.drop_table("app_lock_credentials")
    op.drop_table("app_lock_settings")
