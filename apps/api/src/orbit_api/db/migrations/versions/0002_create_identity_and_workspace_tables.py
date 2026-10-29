"""Identity: user profiles, local accounts and sessions, and workspaces.

On PostgreSQL, Row Level Security is enabled on every new table with no policies, so
Supabase's Data API roles (`anon`, `authenticated`) can read or write nothing. The API connects
as the table owner, which RLS does not restrict, and enforces authorization itself.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-29
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("users", "local_credentials", "local_sessions", "workspaces")


def _timestamp(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("auth_provider", sa.String(length=16), nullable=False),
        sa.Column("auth_subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "auth_provider IN ('local', 'supabase')", name=op.f("ck_users_auth_provider")
        ),
        sa.CheckConstraint(
            "length(auth_subject) BETWEEN 1 AND 255", name=op.f("ck_users_auth_subject_length")
        ),
        sa.CheckConstraint(
            "length(display_name) BETWEEN 1 AND 100", name=op.f("ck_users_display_name_length")
        ),
        sa.CheckConstraint("length(email) BETWEEN 3 AND 320", name=op.f("ck_users_email_length")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("auth_provider", "auth_subject", name="uq_users_auth_identity"),
    )
    op.create_table(
        "local_credentials",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "email = lower(email)", name=op.f("ck_local_credentials_email_normalized")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_local_credentials_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_local_credentials")),
        sa.UniqueConstraint("email", name=op.f("uq_local_credentials_email")),
    )
    op.create_table(
        "local_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        _timestamp("created_at"),
        _timestamp("expires_at"),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_local_sessions_expires_after_creation")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_local_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_local_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_local_sessions_token_hash")),
    )
    op.create_index(op.f("ix_local_sessions_user_id"), "local_sessions", ["user_id"])
    op.create_table(
        "workspaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_personal", sa.Boolean(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_workspaces_name_length")
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_workspaces_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workspaces")),
    )
    op.create_index(op.f("ix_workspaces_owner_id"), "workspaces", ["owner_id"])
    # At most one personal workspace per user.
    op.create_index(
        "uq_workspaces_personal_owner",
        "workspaces",
        ["owner_id"],
        unique=True,
        sqlite_where=sa.text("is_personal"),
        postgresql_where=sa.text("is_personal"),
    )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("uq_workspaces_personal_owner", table_name="workspaces")
    op.drop_index(op.f("ix_workspaces_owner_id"), table_name="workspaces")
    op.drop_table("workspaces")
    op.drop_index(op.f("ix_local_sessions_user_id"), table_name="local_sessions")
    op.drop_table("local_sessions")
    op.drop_table("local_credentials")
    op.drop_table("users")
