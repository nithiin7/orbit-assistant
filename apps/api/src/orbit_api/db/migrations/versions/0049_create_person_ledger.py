"""Money between you and the people in your life.

- `person_ledger_entries`: what a person owes you, what you owe them, and repayments either way,
  in integer minor units with a currency, optionally linked to the Finance transaction behind
  them (an expense a share was split from, or the refund or expense recorded with a repayment).
  Deleting the transaction keeps the entry and clears the link.

New table only; no existing table is altered or rebuilt, so no existing rows are touched. On
PostgreSQL it has Row Level Security enabled with no policies, like the others.

Revision ID: 0049
Revises: 0048
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0049"
down_revision: str | None = "0048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAX_AMOUNT = 10**13


def upgrade() -> None:
    op.create_table(
        "person_ledger_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('they_owe', 'i_owe', 'they_paid', 'i_paid')",
            name=op.f("ck_person_ledger_entries_kind"),
        ),
        sa.CheckConstraint(
            f"amount > 0 AND amount <= {MAX_AMOUNT}",
            name=op.f("ck_person_ledger_entries_amount_range"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_person_ledger_entries_currency"),
        ),
        sa.CheckConstraint(
            "length(description) BETWEEN 1 AND 200",
            name=op.f("ck_person_ledger_entries_description_length"),
        ),
        sa.ForeignKeyConstraint(
            ["person_id", "workspace_id"],
            ["people.id", "people.workspace_id"],
            name=op.f("fk_person_ledger_entries_person_id_people"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["finance_transactions.id"],
            name=op.f("fk_person_ledger_entries_transaction_id_finance_transactions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_person_ledger_entries_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_person_ledger_entries")),
    )
    op.create_index(
        "ix_person_ledger_entries_person_date",
        "person_ledger_entries",
        ["person_id", "occurred_on"],
    )
    op.create_index(
        "ix_person_ledger_entries_transaction", "person_ledger_entries", ["transaction_id"]
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE person_ledger_entries ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_person_ledger_entries_transaction", table_name="person_ledger_entries")
    op.drop_index("ix_person_ledger_entries_person_date", table_name="person_ledger_entries")
    op.drop_table("person_ledger_entries")
