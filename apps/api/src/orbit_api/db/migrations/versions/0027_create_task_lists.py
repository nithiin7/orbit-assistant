"""Task lists.

- `task_lists`: a workspace's named, colored lists of tasks (Work, Personal, ...), with names
  unique per workspace regardless of case and spacing.
- `tasks` gains an optional `list_id`, a composite foreign key on `(list_id, workspace_id)` so a
  task and its list share a workspace. It has no ON DELETE action: deleting a list clears it
  from its tasks first. Existing tasks are on no list.

On PostgreSQL the new table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TASK_LIST_COLORS = "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"


def upgrade() -> None:
    op.create_table(
        "task_lists",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 50", name=op.f("ck_task_lists_name_length")),
        sa.CheckConstraint(f"color IN {TASK_LIST_COLORS}", name=op.f("ck_task_lists_color")),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_task_lists_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_lists")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_task_lists_id")),
        sa.UniqueConstraint(
            "workspace_id", "normalized_name", name=op.f("uq_task_lists_workspace_id")
        ),
    )
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.add_column(sa.Column("list_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_tasks_list", "task_lists", ["list_id", "workspace_id"], ["id", "workspace_id"]
        )
        batch_op.create_index("ix_tasks_workspace_list", ["workspace_id", "list_id"], unique=False)
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE task_lists ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_index("ix_tasks_workspace_list")
        batch_op.drop_constraint("fk_tasks_list", type_="foreignkey")
        batch_op.drop_column("list_id")
    op.drop_table("task_lists")
