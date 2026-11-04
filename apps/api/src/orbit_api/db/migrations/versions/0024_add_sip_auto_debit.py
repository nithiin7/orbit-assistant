"""SIP auto-debit.

Adds `auto_debit` to `finance_sip_plans`: the worker records each installment of such a SIP on
its due date, from its funding account (which it must have). Existing SIPs stay manual. The
table already has Row Level Security enabled on PostgreSQL.

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("finance_sip_plans", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("auto_debit", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    # The default only fills existing rows; the application always sets the column.
    with op.batch_alter_table("finance_sip_plans", schema=None) as batch_op:
        batch_op.alter_column("auto_debit", server_default=None)
        batch_op.create_check_constraint(
            "auto_debit_funding", "NOT auto_debit OR funding_account_id IS NOT NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("finance_sip_plans", schema=None) as batch_op:
        batch_op.drop_constraint("auto_debit_funding", type_="check")
        batch_op.drop_column("auto_debit")
