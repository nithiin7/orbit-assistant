"""Financial accounts, transaction categories, and transactions.

Amounts are integers in the currency's minor unit. No balance is stored: an account's balance is
derived from its opening balance and its transactions whenever it is read.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

# Mirrors `services.finance.money.MAX_AMOUNT`.
MAX_AMOUNT = 10**13


class FinanceAccountModel(Base):
    """A financial account in one workspace: a bank account, a credit card, cash, and so on.
    Accounts are archived, never deleted through the API. Deleting the workspace deletes them."""

    __tablename__ = "finance_accounts"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint(
            "type IN ('bank', 'savings', 'cash', 'wallet', 'credit_card', 'investment', 'other')",
            name="type",
        ),
        CheckConstraint("length(currency) = 3 AND currency = upper(currency)", name="currency"),
        CheckConstraint(
            f"opening_balance BETWEEN -{MAX_AMOUNT} AND {MAX_AMOUNT}", name="opening_balance_range"
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        # The target of the transactions' composite foreign keys, which keep a transaction in
        # its accounts' workspace and currency.
        UniqueConstraint("id", "workspace_id", "currency"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(16))
    currency: Mapped[str] = mapped_column(String(3))
    opening_balance: Mapped[int] = mapped_column(BigInteger)
    notes: Mapped[str] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceCategoryModel(Base):
    """An income or expense category in one workspace. Built-in categories have a `key`."""

    __tablename__ = "finance_categories"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("type IN ('income', 'expense')", name="type"),
        CheckConstraint("length(key) BETWEEN 1 AND 50", name="key_length"),
        # The target of the transactions' composite foreign key.
        UniqueConstraint("id", "workspace_id"),
        # Seeding adds each built-in category once; NULL keys (the user's own) never collide.
        UniqueConstraint("workspace_id", "key", name="uq_finance_categories_workspace_key"),
        UniqueConstraint(
            "workspace_id", "type", "name", name="uq_finance_categories_workspace_type_name"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(16))
    key: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceTransactionModel(Base):
    """Money in, out, or between accounts.

    `workspace_id` and `currency` repeat the accounts' values so that the composite foreign keys
    can guarantee a transaction, its accounts, and its category share one workspace, and that
    both sides of a transfer share one currency. A category in use can't be deleted (the foreign
    key has no `ON DELETE` action).
    """

    __tablename__ = "finance_transactions"
    __table_args__ = (
        CheckConstraint("type IN ('income', 'expense', 'refund', 'transfer')", name="type"),
        CheckConstraint(f"amount > 0 AND amount <= {MAX_AMOUNT}", name="amount_range"),
        CheckConstraint("length(currency) = 3 AND currency = upper(currency)", name="currency"),
        CheckConstraint("length(description) BETWEEN 1 AND 200", name="description_length"),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        # A transfer moves money between two different accounts and has no category; nothing
        # else has a destination account.
        CheckConstraint(
            "(type = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id"
            " AND category_id IS NULL)"
            " OR (type <> 'transfer' AND to_account_id IS NULL)",
            name="transfer_shape",
        ),
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            [
                "finance_accounts.id",
                "finance_accounts.workspace_id",
                "finance_accounts.currency",
            ],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["to_account_id", "workspace_id", "currency"],
            [
                "finance_accounts.id",
                "finance_accounts.workspace_id",
                "finance_accounts.currency",
            ],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["finance_categories.id", "finance_categories.workspace_id"],
        ),
        # History and reports read one workspace's date range; account and category filters
        # (and the in-use check before deleting a category) look up by reference.
        Index("ix_finance_transactions_workspace_date", "workspace_id", "occurred_on"),
        Index("ix_finance_transactions_workspace_account", "workspace_id", "account_id"),
        Index("ix_finance_transactions_workspace_to_account", "workspace_id", "to_account_id"),
        Index("ix_finance_transactions_workspace_category", "workspace_id", "category_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(16))
    amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    occurred_on: Mapped[date]
    description: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[uuid.UUID | None]
    account_id: Mapped[uuid.UUID]
    to_account_id: Mapped[uuid.UUID | None]
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
