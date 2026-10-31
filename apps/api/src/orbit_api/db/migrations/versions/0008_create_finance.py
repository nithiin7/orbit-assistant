"""Financial accounts, transaction categories, and transactions.

Amounts are BIGINT minor units (paise for INR). No balance column exists: balances are derived
from opening balances and transactions. Composite foreign keys keep each transaction in its
accounts' workspace and currency, and its category's workspace.

Like the other tables, the new ones have Row Level Security enabled with no policies on
PostgreSQL, so Supabase's Data API roles cannot reach them; the API enforces access itself.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("finance_accounts", "finance_categories", "finance_transactions")
MAX_AMOUNT = 10**13
ACCOUNT_KEY = ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"]


def upgrade() -> None:
    op.create_table(
        "finance_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("opening_balance", sa.BigInteger(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_finance_accounts_name_length")
        ),
        sa.CheckConstraint(
            "type IN ('bank', 'savings', 'cash', 'wallet', 'credit_card', 'investment', 'other')",
            name=op.f("ck_finance_accounts_type"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_accounts_currency"),
        ),
        sa.CheckConstraint(
            f"opening_balance BETWEEN -{MAX_AMOUNT} AND {MAX_AMOUNT}",
            name=op.f("ck_finance_accounts_opening_balance_range"),
        ),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_finance_accounts_notes_length")),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_accounts_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_accounts")),
        sa.UniqueConstraint("id", "workspace_id", "currency", name=op.f("uq_finance_accounts_id")),
    )
    op.create_index(op.f("ix_finance_accounts_workspace_id"), "finance_accounts", ["workspace_id"])

    op.create_table(
        "finance_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("key", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_finance_categories_name_length")
        ),
        sa.CheckConstraint(
            "type IN ('income', 'expense')", name=op.f("ck_finance_categories_type")
        ),
        sa.CheckConstraint(
            "length(key) BETWEEN 1 AND 50", name=op.f("ck_finance_categories_key_length")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_categories_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_categories")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_categories_id")),
        sa.UniqueConstraint("workspace_id", "key", name="uq_finance_categories_workspace_key"),
        sa.UniqueConstraint(
            "workspace_id", "type", "name", name="uq_finance_categories_workspace_type_name"
        ),
    )
    op.create_index(
        op.f("ix_finance_categories_workspace_id"), "finance_categories", ["workspace_id"]
    )

    op.create_table(
        "finance_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("to_account_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('income', 'expense', 'refund', 'transfer')",
            name=op.f("ck_finance_transactions_type"),
        ),
        sa.CheckConstraint(
            f"amount > 0 AND amount <= {MAX_AMOUNT}",
            name=op.f("ck_finance_transactions_amount_range"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_transactions_currency"),
        ),
        sa.CheckConstraint(
            "length(description) BETWEEN 1 AND 200",
            name=op.f("ck_finance_transactions_description_length"),
        ),
        sa.CheckConstraint(
            "length(notes) <= 2000", name=op.f("ck_finance_transactions_notes_length")
        ),
        sa.CheckConstraint(
            "(type = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id"
            " AND category_id IS NULL)"
            " OR (type <> 'transfer' AND to_account_id IS NULL)",
            name=op.f("ck_finance_transactions_transfer_shape"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_transactions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            ACCOUNT_KEY,
            name=op.f("fk_finance_transactions_account_id_finance_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["to_account_id", "workspace_id", "currency"],
            ACCOUNT_KEY,
            name=op.f("fk_finance_transactions_to_account_id_finance_accounts"),
            ondelete="CASCADE",
        ),
        # No ON DELETE action: a category that transactions use can't be deleted.
        sa.ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["finance_categories.id", "finance_categories.workspace_id"],
            name=op.f("fk_finance_transactions_category_id_finance_categories"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_transactions")),
    )
    op.create_index(
        "ix_finance_transactions_workspace_date",
        "finance_transactions",
        ["workspace_id", "occurred_on"],
    )
    op.create_index(
        "ix_finance_transactions_workspace_account",
        "finance_transactions",
        ["workspace_id", "account_id"],
    )
    op.create_index(
        "ix_finance_transactions_workspace_to_account",
        "finance_transactions",
        ["workspace_id", "to_account_id"],
    )
    op.create_index(
        "ix_finance_transactions_workspace_category",
        "finance_transactions",
        ["workspace_id", "category_id"],
    )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for index in (
        "ix_finance_transactions_workspace_category",
        "ix_finance_transactions_workspace_to_account",
        "ix_finance_transactions_workspace_account",
        "ix_finance_transactions_workspace_date",
    ):
        op.drop_index(index, table_name="finance_transactions")
    op.drop_table("finance_transactions")
    op.drop_index(op.f("ix_finance_categories_workspace_id"), table_name="finance_categories")
    op.drop_table("finance_categories")
    op.drop_index(op.f("ix_finance_accounts_workspace_id"), table_name="finance_accounts")
    op.drop_table("finance_accounts")
