"""Create the search history tables.

- `recent_searches`: each person's last few committed searches in a workspace (text only).
- `saved_searches`: each person's named searches with their filters.

Universal search itself adds no tables or indexes: it reads the modules' own tables, whose
workspace-leading indexes already bound every scan.

On PostgreSQL both tables have Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("recent_searches", "saved_searches")


def upgrade() -> None:
    op.create_table(
        "recent_searches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("query", sa.String(length=200), nullable=False),
        sa.Column("normalized_query", sa.String(length=200), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(query) BETWEEN 1 AND 200", name=op.f("ck_recent_searches_query_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_recent_searches_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_recent_searches_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recent_searches")),
        sa.UniqueConstraint(
            "user_id",
            "workspace_id",
            "normalized_query",
            name=op.f("uq_recent_searches_user_id"),
        ),
    )
    with op.batch_alter_table("recent_searches", schema=None) as batch_op:
        batch_op.create_index(
            "ix_recent_searches_owner_used_at", ["user_id", "workspace_id", "used_at"], unique=False
        )

    op.create_table(
        "saved_searches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("normalized_name", sa.String(length=100), nullable=False),
        sa.Column("query", sa.String(length=200), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_saved_searches_name_length")
        ),
        sa.CheckConstraint(
            "length(query) BETWEEN 1 AND 200", name=op.f("ck_saved_searches_query_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_saved_searches_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_saved_searches_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_saved_searches")),
        sa.UniqueConstraint(
            "user_id",
            "workspace_id",
            "normalized_name",
            name=op.f("uq_saved_searches_user_id"),
        ),
    )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("saved_searches")
    with op.batch_alter_table("recent_searches", schema=None) as batch_op:
        batch_op.drop_index("ix_recent_searches_owner_used_at")
    op.drop_table("recent_searches")
