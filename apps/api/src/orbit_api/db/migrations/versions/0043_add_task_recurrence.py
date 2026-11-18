"""Repeating tasks.

- `tasks` gains a nullable `recurrence` (the rule, on a series' current occurrence) and a nullable
  `series_id` (shared by a series' occurrences), added with plain `ADD COLUMN`; the table is not
  rebuilt, so tasks and the records that reference them are untouched.

Revision ID: 0043
Revises: 0042
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("recurrence", sa.JSON(), nullable=True))
    op.add_column("tasks", sa.Column("series_id", sa.Uuid(), nullable=True))
    op.create_index("ix_tasks_workspace_series", "tasks", ["workspace_id", "series_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_workspace_series", table_name="tasks")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_column("series_id")
        batch_op.drop_column("recurrence")
