"""Gift ideas: a shopping item can be for someone in People.

- `shopping_items` gains an optional `person_id`, kept in the item's workspace by a composite
  foreign key to `people(id, workspace_id)` with no ON DELETE action (deleting a person clears
  the link first, so the item stays on its list). On SQLite this rebuilds `shopping_items` in
  batch mode (copy, drop, rename); migrations run with foreign keys off and no table references
  it, so no rows are lost.

Revision ID: 0050
Revises: 0049
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("shopping_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("person_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_shopping_items_person",
            "people",
            ["person_id", "workspace_id"],
            ["id", "workspace_id"],
        )
        batch_op.create_index("ix_shopping_items_person", ["person_id"])


def downgrade() -> None:
    with op.batch_alter_table("shopping_items", schema=None) as batch_op:
        batch_op.drop_index("ix_shopping_items_person")
        batch_op.drop_constraint("fk_shopping_items_person", type_="foreignkey")
        batch_op.drop_column("person_id")
