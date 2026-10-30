"""Financial commitments: loans, EMI installments, subscriptions and bills, and their payments.

- `finance_accounts.type` gains `loan`: a liability account whose derived balance is a loan's
  outstanding principal.
- `finance_transactions` gains a unique `(id, workspace_id)` key, the target of the composite
  foreign keys that link payments to the transactions recording them.
- `reminders` gains optional links to a loan or a recurring payment, unique per commitment.

Nothing is backfilled. Like the other tables, the new ones have Row Level Security enabled with
no policies on PostgreSQL, so Supabase's Data API roles cannot reach them; the API enforces
access itself.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-30
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "finance_loans",
    "finance_loan_installments",
    "finance_recurring_payments",
    "finance_recurring_occurrences",
)
MAX_AMOUNT = 10**13
MAX_INSTALLMENTS = 600
MAX_RATE_BPS = 10_000
ACCOUNT_KEY = ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"]
TRANSACTION_KEY = ["finance_transactions.id", "finance_transactions.workspace_id"]
OLD_ACCOUNT_TYPES = "('bank', 'savings', 'cash', 'wallet', 'credit_card', 'investment', 'other')"
NEW_ACCOUNT_TYPES = (
    "('bank', 'savings', 'cash', 'wallet', 'credit_card', 'investment', 'loan', 'other')"
)
REMINDER_SETTINGS = (
    "(reminder_days_before IS NULL AND reminder_time IS NULL AND reminder_timezone IS NULL)"
    " OR (reminder_days_before BETWEEN 0 AND 30 AND reminder_time IS NOT NULL"
    " AND length(reminder_timezone) BETWEEN 1 AND 64)"
)


def _reminder_columns() -> list[sa.Column[Any]]:
    return [
        sa.Column("reminder_days_before", sa.Integer(), nullable=True),
        sa.Column("reminder_time", sa.Time(), nullable=True),
        sa.Column("reminder_timezone", sa.String(length=64), nullable=True),
    ]


def _workspace_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["workspace_id"],
        ["workspaces.id"],
        name=op.f(f"fk_{table}_workspace_id_workspaces"),
        ondelete="CASCADE",
    )


def upgrade() -> None:
    # Batch mode rebuilds the tables on SQLite, which can't change constraints in place.
    with op.batch_alter_table("finance_accounts") as batch:
        batch.drop_constraint(op.f("ck_finance_accounts_type"), type_="check")
        batch.create_check_constraint(
            op.f("ck_finance_accounts_type"), f"type IN {NEW_ACCOUNT_TYPES}"
        )
    with op.batch_alter_table("finance_transactions") as batch:
        batch.create_unique_constraint(op.f("uq_finance_transactions_id"), ["id", "workspace_id"])

    op.create_table(
        "finance_loans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("payment_account_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("lender", sa.String(length=100), nullable=False),
        sa.Column("loan_type", sa.String(length=16), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("principal", sa.BigInteger(), nullable=False),
        sa.Column("interest_rate_bps", sa.Integer(), nullable=False),
        sa.Column("interest_method", sa.String(length=16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("tenure_months", sa.Integer(), nullable=False),
        sa.Column("emi_amount", sa.BigInteger(), nullable=False),
        sa.Column("emi_frequency", sa.String(length=16), nullable=False),
        sa.Column("first_payment_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        *_reminder_columns(),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_finance_loans_name_length")
        ),
        sa.CheckConstraint("length(lender) <= 100", name=op.f("ck_finance_loans_lender_length")),
        sa.CheckConstraint(
            "loan_type IN ('personal', 'vehicle', 'home', 'education', 'other')",
            name=op.f("ck_finance_loans_loan_type"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_loans_currency"),
        ),
        sa.CheckConstraint(
            f"principal > 0 AND principal <= {MAX_AMOUNT}",
            name=op.f("ck_finance_loans_principal_range"),
        ),
        sa.CheckConstraint(
            f"interest_rate_bps BETWEEN 0 AND {MAX_RATE_BPS}",
            name=op.f("ck_finance_loans_interest_rate_range"),
        ),
        sa.CheckConstraint(
            "interest_method IN ('reducing', 'flat')",
            name=op.f("ck_finance_loans_interest_method"),
        ),
        sa.CheckConstraint(
            f"tenure_months BETWEEN 1 AND {MAX_INSTALLMENTS * 12}",
            name=op.f("ck_finance_loans_tenure_range"),
        ),
        sa.CheckConstraint(
            f"emi_amount > 0 AND emi_amount <= {MAX_AMOUNT}",
            name=op.f("ck_finance_loans_emi_amount_range"),
        ),
        sa.CheckConstraint(
            "emi_frequency IN ('monthly', 'quarterly', 'half_yearly', 'yearly')",
            name=op.f("ck_finance_loans_emi_frequency"),
        ),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_finance_loans_notes_length")),
        sa.CheckConstraint(
            "status IN ('active', 'closed', 'archived')", name=op.f("ck_finance_loans_status")
        ),
        sa.CheckConstraint(REMINDER_SETTINGS, name=op.f("ck_finance_loans_reminder_settings")),
        _workspace_fk("finance_loans"),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            ACCOUNT_KEY,
            name=op.f("fk_finance_loans_account_id_finance_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["payment_account_id", "workspace_id", "currency"],
            ACCOUNT_KEY,
            name="fk_finance_loans_payment_account",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_loans")),
        sa.UniqueConstraint("account_id", name="uq_finance_loans_account_id"),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_loans_id")),
    )
    op.create_index(
        "ix_finance_loans_workspace_status", "finance_loans", ["workspace_id", "status"]
    )

    op.create_table(
        "finance_loan_installments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("loan_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("principal", sa.BigInteger(), nullable=False),
        sa.Column("interest", sa.BigInteger(), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=True),
        sa.Column("principal_transaction_id", sa.Uuid(), nullable=True),
        sa.Column("interest_transaction_id", sa.Uuid(), nullable=True),
        sa.Column("adjusted", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"sequence BETWEEN 1 AND {MAX_INSTALLMENTS * 2}",
            name=op.f("ck_finance_loan_installments_sequence_range"),
        ),
        sa.CheckConstraint(
            f"principal >= 0 AND interest >= 0 AND principal + interest > 0"
            f" AND principal + interest <= {MAX_AMOUNT}",
            name=op.f("ck_finance_loan_installments_amount_range"),
        ),
        sa.CheckConstraint(
            f"balance_after BETWEEN 0 AND {MAX_AMOUNT}",
            name=op.f("ck_finance_loan_installments_balance_after_range"),
        ),
        sa.CheckConstraint(
            "state IN ('scheduled', 'paid', 'skipped')",
            name=op.f("ck_finance_loan_installments_state"),
        ),
        sa.CheckConstraint(
            "(state = 'paid' AND paid_on IS NOT NULL)"
            " OR (state <> 'paid' AND paid_on IS NULL AND principal_transaction_id IS NULL"
            " AND interest_transaction_id IS NULL)",
            name=op.f("ck_finance_loan_installments_payment_matches_state"),
        ),
        _workspace_fk("finance_loan_installments"),
        sa.ForeignKeyConstraint(
            ["loan_id", "workspace_id"],
            ["finance_loans.id", "finance_loans.workspace_id"],
            name=op.f("fk_finance_loan_installments_loan_id_finance_loans"),
            ondelete="CASCADE",
        ),
        # No ON DELETE action: a transaction that records a payment can't be deleted.
        sa.ForeignKeyConstraint(
            ["principal_transaction_id", "workspace_id"],
            TRANSACTION_KEY,
            name="fk_finance_loan_installments_principal_tx",
        ),
        sa.ForeignKeyConstraint(
            ["interest_transaction_id", "workspace_id"],
            TRANSACTION_KEY,
            name="fk_finance_loan_installments_interest_tx",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_loan_installments")),
        sa.UniqueConstraint("loan_id", "sequence", name="uq_finance_loan_installments_sequence"),
        sa.UniqueConstraint(
            "principal_transaction_id", name="uq_finance_loan_installments_principal_tx"
        ),
        sa.UniqueConstraint(
            "interest_transaction_id", name="uq_finance_loan_installments_interest_tx"
        ),
    )
    op.create_index(
        "ix_finance_loan_installments_workspace_due",
        "finance_loan_installments",
        ["workspace_id", "due_date"],
    )

    op.create_table(
        "finance_recurring_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("provider", sa.String(length=100), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount_varies", sa.Boolean(), nullable=False),
        sa.Column("frequency", sa.String(length=16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("anchor_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("trial_ends_on", sa.Date(), nullable=True),
        sa.Column("auto_renew", sa.Boolean(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        *_reminder_columns(),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('subscription', 'bill')", name=op.f("ck_finance_recurring_payments_kind")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100",
            name=op.f("ck_finance_recurring_payments_name_length"),
        ),
        sa.CheckConstraint(
            "length(provider) <= 100", name=op.f("ck_finance_recurring_payments_provider_length")
        ),
        sa.CheckConstraint(
            f"amount > 0 AND amount <= {MAX_AMOUNT}",
            name=op.f("ck_finance_recurring_payments_amount_range"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_recurring_payments_currency"),
        ),
        sa.CheckConstraint(
            "frequency IN ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')",
            name=op.f("ck_finance_recurring_payments_frequency"),
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= anchor_date",
            name=op.f("ck_finance_recurring_payments_end_after_anchor"),
        ),
        sa.CheckConstraint(
            "state IN ('active', 'paused', 'cancelled')",
            name=op.f("ck_finance_recurring_payments_state"),
        ),
        sa.CheckConstraint(
            "length(notes) <= 2000", name=op.f("ck_finance_recurring_payments_notes_length")
        ),
        sa.CheckConstraint(
            REMINDER_SETTINGS, name=op.f("ck_finance_recurring_payments_reminder_settings")
        ),
        _workspace_fk("finance_recurring_payments"),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            ACCOUNT_KEY,
            name=op.f("fk_finance_recurring_payments_account_id_finance_accounts"),
        ),
        sa.ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["finance_categories.id", "finance_categories.workspace_id"],
            name=op.f("fk_finance_recurring_payments_category_id_finance_categories"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_recurring_payments")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_recurring_payments_id")),
    )
    op.create_index(
        "ix_finance_recurring_payments_workspace_kind",
        "finance_recurring_payments",
        ["workspace_id", "kind"],
    )
    op.create_index(
        "ix_finance_recurring_payments_workspace_category",
        "finance_recurring_payments",
        ["workspace_id", "category_id"],
    )

    op.create_table(
        "finance_recurring_occurrences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("recurring_payment_id", sa.Uuid(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=True),
        sa.Column("paid_on", sa.Date(), nullable=True),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "state IN ('paid', 'skipped')", name=op.f("ck_finance_recurring_occurrences_state")
        ),
        sa.CheckConstraint(
            f"(state = 'paid' AND amount > 0 AND amount <= {MAX_AMOUNT} AND paid_on IS NOT NULL)"
            " OR (state = 'skipped' AND amount IS NULL AND paid_on IS NULL"
            " AND transaction_id IS NULL)",
            name=op.f("ck_finance_recurring_occurrences_payment_matches_state"),
        ),
        _workspace_fk("finance_recurring_occurrences"),
        sa.ForeignKeyConstraint(
            ["recurring_payment_id", "workspace_id"],
            ["finance_recurring_payments.id", "finance_recurring_payments.workspace_id"],
            name="fk_finance_recurring_occurrences_payment",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id", "workspace_id"],
            TRANSACTION_KEY,
            name="fk_finance_recurring_occurrences_tx",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_recurring_occurrences")),
        sa.UniqueConstraint(
            "recurring_payment_id", "due_date", name="uq_finance_recurring_occurrences_due"
        ),
        sa.UniqueConstraint("transaction_id", name="uq_finance_recurring_occurrences_transaction"),
    )
    op.create_index(
        "ix_finance_recurring_occurrences_workspace_due",
        "finance_recurring_occurrences",
        ["workspace_id", "due_date"],
    )

    with op.batch_alter_table("reminders") as batch:
        batch.add_column(sa.Column("finance_loan_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("finance_recurring_payment_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            op.f("fk_reminders_finance_loan_id_finance_loans"),
            "finance_loans",
            ["finance_loan_id", "workspace_id"],
            ["id", "workspace_id"],
            ondelete="CASCADE",
        )
        batch.create_foreign_key(
            "fk_reminders_finance_recurring_payment",
            "finance_recurring_payments",
            ["finance_recurring_payment_id", "workspace_id"],
            ["id", "workspace_id"],
            ondelete="CASCADE",
        )
        batch.create_unique_constraint("uq_reminders_finance_loan_id", ["finance_loan_id"])
        batch.create_unique_constraint(
            "uq_reminders_finance_recurring_payment_id", ["finance_recurring_payment_id"]
        )
        batch.create_check_constraint(
            op.f("ck_reminders_one_commitment"),
            "finance_loan_id IS NULL OR finance_recurring_payment_id IS NULL",
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("reminders") as batch:
        batch.drop_constraint(op.f("ck_reminders_one_commitment"), type_="check")
        batch.drop_constraint("uq_reminders_finance_recurring_payment_id", type_="unique")
        batch.drop_constraint("uq_reminders_finance_loan_id", type_="unique")
        batch.drop_constraint(
            "fk_reminders_finance_recurring_payment",
            type_="foreignkey",
        )
        batch.drop_constraint(
            op.f("fk_reminders_finance_loan_id_finance_loans"), type_="foreignkey"
        )
        batch.drop_column("finance_recurring_payment_id")
        batch.drop_column("finance_loan_id")

    op.drop_index(
        "ix_finance_recurring_occurrences_workspace_due",
        table_name="finance_recurring_occurrences",
    )
    op.drop_table("finance_recurring_occurrences")
    op.drop_index(
        "ix_finance_recurring_payments_workspace_category", table_name="finance_recurring_payments"
    )
    op.drop_index(
        "ix_finance_recurring_payments_workspace_kind", table_name="finance_recurring_payments"
    )
    op.drop_table("finance_recurring_payments")
    op.drop_index(
        "ix_finance_loan_installments_workspace_due", table_name="finance_loan_installments"
    )
    op.drop_table("finance_loan_installments")
    op.drop_index("ix_finance_loans_workspace_status", table_name="finance_loans")
    op.drop_table("finance_loans")

    with op.batch_alter_table("finance_transactions") as batch:
        batch.drop_constraint(op.f("uq_finance_transactions_id"), type_="unique")
    # Loan accounts can't survive without the type; their transactions go with them.
    op.execute("DELETE FROM finance_accounts WHERE type = 'loan'")
    with op.batch_alter_table("finance_accounts") as batch:
        batch.drop_constraint(op.f("ck_finance_accounts_type"), type_="check")
        batch.create_check_constraint(
            op.f("ck_finance_accounts_type"), f"type IN {OLD_ACCOUNT_TYPES}"
        )
