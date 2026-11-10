"""First-run setup guide progress.

Adds `setup_status` to `users`: `pending` until the user opens the setup guide, `deferred` once
they leave it for later, and `done` once they finish or dismiss it. Existing users are already
set up, so they start at `done`; the ORM gives new profiles `pending`. The table already has Row
Level Security enabled on PostgreSQL.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("setup_status", sa.String(length=16), nullable=False, server_default="done")
        )
        batch_op.create_check_constraint(
            "setup_status", "setup_status IN ('pending', 'deferred', 'done')"
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("setup_status", type_="check")
        batch_op.drop_column("setup_status")
