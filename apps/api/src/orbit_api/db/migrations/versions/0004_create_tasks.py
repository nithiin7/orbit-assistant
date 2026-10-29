"""Tasks, the first workspace-owned product table.

Like the identity tables, `tasks` has Row Level Security enabled with no policies on
PostgreSQL, so Supabase's Data API roles cannot reach it; the API enforces access itself.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("priority", sa.SmallInteger(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 200", name=op.f("ck_tasks_title_length")),
        sa.CheckConstraint("length(description) <= 5000", name=op.f("ck_tasks_description_length")),
        sa.CheckConstraint("status IN ('open', 'completed')", name=op.f("ck_tasks_status")),
        sa.CheckConstraint("priority BETWEEN 0 AND 3", name=op.f("ck_tasks_priority")),
        sa.CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL)"
            " OR (status = 'open' AND completed_at IS NULL)",
            name=op.f("ck_tasks_completed_at_matches_status"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_tasks_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )
    op.create_index(
        "ix_tasks_workspace_status_due_date", "tasks", ["workspace_id", "status", "due_date"]
    )
    op.create_index(
        "ix_tasks_workspace_status_priority", "tasks", ["workspace_id", "status", "priority"]
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE tasks ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_tasks_workspace_status_priority", table_name="tasks")
    op.drop_index("ix_tasks_workspace_status_due_date", table_name="tasks")
    op.drop_table("tasks")
