"""Market data per workspace.

Adds `market_data_enabled` to `workspaces`: whether the workspace fetches mutual fund NAVs and
stock prices, turned on in Settings → Finance. Existing and new workspaces start with it off. The
table already has Row Level Security enabled on PostgreSQL.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "market_data_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
    # The database default stays: workspaces are also created by SQL outside the ORM.


def downgrade() -> None:
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.drop_column("market_data_enabled")
