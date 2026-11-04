"""Locked notes.

Adds `is_locked` to `notes`: a locked note shows only its title in lists, search, and previews.
Existing notes stay unlocked. The table already has Row Level Security enabled on PostgreSQL
(revision 0012).

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    # The default only fills existing rows; the application always sets the column.
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.alter_column("is_locked", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.drop_column("is_locked")
