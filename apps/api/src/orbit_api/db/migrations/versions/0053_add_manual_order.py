"""Manual order for tasks and shopping items, set by dragging them.

`tasks` and `shopping_items` gain `position`: a task's place in its workspace's own order, and
an item's place on its shopping list. Existing rows are numbered oldest first (per workspace for
tasks, per list for items), which is the order the shopping list already shows.

Added with plain `ADD COLUMN` and filled with an `UPDATE`; no table is rebuilt, so no rows are
dropped or copied.

Revision ID: 0053
Revises: 0052
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _number_rows(table: str, group: str) -> None:
    # A correlated count instead of ROW_NUMBER() keeps one statement for SQLite and PostgreSQL.
    op.execute(
        f"UPDATE {table} SET position = ("
        f" SELECT COUNT(*) FROM {table} AS earlier"
        f" WHERE earlier.{group} = {table}.{group}"
        f" AND (earlier.created_at < {table}.created_at"
        f" OR (earlier.created_at = {table}.created_at AND earlier.id < {table}.id)))"
    )


def upgrade() -> None:
    op.add_column("tasks", sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(
        "shopping_items",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    _number_rows("tasks", "workspace_id")
    _number_rows("shopping_items", "list_id")


def downgrade() -> None:
    with op.batch_alter_table("shopping_items", schema=None) as batch_op:
        batch_op.drop_column("position")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_column("position")
