"""Bank statement imports.

- New tables only: `finance_import_batches`, `finance_import_rows`, and `finance_category_rules`.
  No existing table is altered or rebuilt, so no existing rows are touched.

Revision ID: 0047
Revises: 0046
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from orbit_api.db.columns import UTCDateTime

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("finance_import_batches", "finance_import_rows", "finance_category_rules")


def upgrade() -> None:
    op.create_table(
        "finance_import_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_import_batches_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["finance_accounts.id"],
            name=op.f("fk_finance_import_batches_account_id_finance_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_import_batches")),
    )
    op.create_index(
        "ix_finance_import_batches_workspace", "finance_import_batches", ["workspace_id"]
    )

    op.create_table(
        "finance_import_rows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_import_rows_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["finance_accounts.id"],
            name=op.f("fk_finance_import_rows_account_id_finance_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["finance_import_batches.id"],
            name=op.f("fk_finance_import_rows_batch_id_finance_import_batches"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["finance_transactions.id"],
            name=op.f("fk_finance_import_rows_transaction_id_finance_transactions"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_import_rows")),
        sa.UniqueConstraint(
            "workspace_id", "account_id", "fingerprint", name="uq_finance_import_rows_fingerprint"
        ),
    )
    op.create_index("ix_finance_import_rows_batch", "finance_import_rows", ["batch_id"])
    op.create_index("ix_finance_import_rows_transaction", "finance_import_rows", ["transaction_id"])

    op.create_table(
        "finance_category_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("merchant_key", sa.String(length=100), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_category_rules_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["finance_categories.id"],
            name=op.f("fk_finance_category_rules_category_id_finance_categories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_category_rules")),
        sa.UniqueConstraint("workspace_id", "merchant_key", name="uq_finance_category_rules_key"),
    )

    if op.get_bind().dialect.name == "postgresql":
        for table in _TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("finance_category_rules")
    op.drop_index("ix_finance_import_rows_transaction", table_name="finance_import_rows")
    op.drop_index("ix_finance_import_rows_batch", table_name="finance_import_rows")
    op.drop_table("finance_import_rows")
    op.drop_index("ix_finance_import_batches_workspace", table_name="finance_import_batches")
    op.drop_table("finance_import_batches")
