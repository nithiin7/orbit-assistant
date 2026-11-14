"""A default finance account per workspace.

`finance_accounts` gains `is_default` (false for every existing row), and a partial unique index
keeps at most one default account per workspace. Added with plain `ADD COLUMN` and
`CREATE INDEX`; no table is rebuilt.

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "finance_accounts",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "uq_finance_accounts_default_workspace",
        "finance_accounts",
        ["workspace_id"],
        unique=True,
        sqlite_where=sa.text("is_default"),
        postgresql_where=sa.text("is_default"),
    )


def downgrade() -> None:
    op.drop_index("uq_finance_accounts_default_workspace", table_name="finance_accounts")
    with op.batch_alter_table("finance_accounts", schema=None) as batch_op:
        batch_op.drop_column("is_default")
