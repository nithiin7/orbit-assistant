"""An icon on each shopping list.

`shopping_lists` gains `icon`, set to `basket` for existing rows (the icon every list showed
before). Added with plain `ADD COLUMN`; no table is rebuilt. The API checks the value.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shopping_lists",
        sa.Column("icon", sa.String(length=16), nullable=False, server_default="basket"),
    )


def downgrade() -> None:
    with op.batch_alter_table("shopping_lists", schema=None) as batch_op:
        batch_op.drop_column("icon")
