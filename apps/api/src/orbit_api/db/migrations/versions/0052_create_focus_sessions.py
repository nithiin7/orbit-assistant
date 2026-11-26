"""Focus timer sessions on tasks.

- `focus_sessions`: time spent focusing on a task with the focus timer, in seconds without
  pauses, with the client's local day (for focus streaks) and whether the timer ran to the end.
  Deleting the task deletes its sessions.

New table only; no existing table is altered or rebuilt, so no existing rows are touched. On
PostgreSQL it has Row Level Security enabled with no policies, like the others.

Revision ID: 0052
Revises: 0051
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAX_FOCUS_SECONDS = 4 * 60 * 60


def upgrade() -> None:
    op.create_table(
        "focus_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("focused_seconds", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"focused_seconds BETWEEN 1 AND {MAX_FOCUS_SECONDS}",
            name=op.f("ck_focus_sessions_focused_seconds_range"),
        ),
        sa.CheckConstraint(
            "ended_at > started_at", name=op.f("ck_focus_sessions_ends_after_start")
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_focus_sessions_task",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_focus_sessions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_focus_sessions")),
    )
    op.create_index(
        "ix_focus_sessions_workspace_task", "focus_sessions", ["workspace_id", "task_id"]
    )
    op.create_index("ix_focus_sessions_workspace_day", "focus_sessions", ["workspace_id", "day"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_focus_sessions_workspace_day", table_name="focus_sessions")
    op.drop_index("ix_focus_sessions_workspace_task", table_name="focus_sessions")
    op.drop_table("focus_sessions")
