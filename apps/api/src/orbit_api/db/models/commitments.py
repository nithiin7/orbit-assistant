"""Financial commitments: loans and their installments, and recurring payments (subscriptions and
bills) with their settled occurrences.

Payments never duplicate the ledger: an installment or occurrence points at the
`finance_transactions` rows that record the money, through composite foreign keys that keep them
in one workspace. Those keys have no `ON DELETE` action, so a transaction that records a payment
can't be deleted until the payment is undone. Each transaction pays at most one thing (unique
keys, plus a service check across the two installment columns).
"""

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

# Mirrors `services.finance.money.MAX_AMOUNT` and `services.commitments.schedule`.
MAX_AMOUNT = 10**13
MAX_INSTALLMENTS = 600
MAX_RATE_BPS = 10_000

_TRANSACTION_KEY = ["finance_transactions.id", "finance_transactions.workspace_id"]


class _ReminderColumns:
    """When to remind about each payment. All three are set together, or none."""

    reminder_days_before: Mapped[int | None] = mapped_column(Integer)
    reminder_time: Mapped[time | None] = mapped_column(Time)
    reminder_timezone: Mapped[str | None] = mapped_column(String(64))


def _reminder_checks() -> tuple[CheckConstraint, ...]:
    return (
        CheckConstraint(
            "(reminder_days_before IS NULL AND reminder_time IS NULL"
            " AND reminder_timezone IS NULL)"
            " OR (reminder_days_before BETWEEN 0 AND 30 AND reminder_time IS NOT NULL"
            " AND length(reminder_timezone) BETWEEN 1 AND 64)",
            name="reminder_settings",
        ),
    )


class FinanceLoanModel(_ReminderColumns, Base):
    """A loan, tracked against a `loan` liability account whose derived balance is the
    outstanding principal. Loans are closed or archived, never deleted through the API."""

    __tablename__ = "finance_loans"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(lender) <= 100", name="lender_length"),
        CheckConstraint(
            "loan_type IN ('personal', 'vehicle', 'home', 'education', 'other')", name="loan_type"
        ),
        CheckConstraint("length(currency) = 3 AND currency = upper(currency)", name="currency"),
        CheckConstraint(f"principal > 0 AND principal <= {MAX_AMOUNT}", name="principal_range"),
        CheckConstraint(
            f"interest_rate_bps BETWEEN 0 AND {MAX_RATE_BPS}", name="interest_rate_range"
        ),
        CheckConstraint("interest_method IN ('reducing', 'flat')", name="interest_method"),
        CheckConstraint(
            f"tenure_months BETWEEN 1 AND {MAX_INSTALLMENTS * 12}", name="tenure_range"
        ),
        CheckConstraint(f"emi_amount > 0 AND emi_amount <= {MAX_AMOUNT}", name="emi_amount_range"),
        CheckConstraint(
            "emi_frequency IN ('monthly', 'quarterly', 'half_yearly', 'yearly')",
            name="emi_frequency",
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        CheckConstraint("status IN ('active', 'closed', 'archived')", name="status"),
        *_reminder_checks(),
        # The loan's account is in its workspace and currency, and backs no other loan.
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            [
                "finance_accounts.id",
                "finance_accounts.workspace_id",
                "finance_accounts.currency",
            ],
            ondelete="CASCADE",
        ),
        UniqueConstraint("account_id", name="uq_finance_loans_account_id"),
        # The account EMIs are usually paid from. No `ON DELETE` action: accounts are archived.
        ForeignKeyConstraint(
            ["payment_account_id", "workspace_id", "currency"],
            [
                "finance_accounts.id",
                "finance_accounts.workspace_id",
                "finance_accounts.currency",
            ],
            name="fk_finance_loans_payment_account",
        ),
        # The target of the installments' and reminders' composite foreign keys.
        UniqueConstraint("id", "workspace_id"),
        Index("ix_finance_loans_workspace_status", "workspace_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID]
    payment_account_id: Mapped[uuid.UUID | None]
    name: Mapped[str] = mapped_column(String(100))
    lender: Mapped[str] = mapped_column(String(100))
    loan_type: Mapped[str] = mapped_column(String(16))
    currency: Mapped[str] = mapped_column(String(3))
    principal: Mapped[int] = mapped_column(BigInteger)
    interest_rate_bps: Mapped[int] = mapped_column(Integer)
    interest_method: Mapped[str] = mapped_column(String(16))
    start_date: Mapped[date]
    tenure_months: Mapped[int] = mapped_column(Integer)
    emi_amount: Mapped[int] = mapped_column(BigInteger)
    emi_frequency: Mapped[str] = mapped_column(String(16))
    first_payment_date: Mapped[date]
    notes: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceLoanInstallmentModel(Base):
    """One installment of a loan's EMI schedule. Scheduled installments can be adjusted or
    regenerated; paid and skipped ones are history and stay as they are."""

    __tablename__ = "finance_loan_installments"
    __table_args__ = (
        CheckConstraint(f"sequence BETWEEN 1 AND {MAX_INSTALLMENTS * 2}", name="sequence_range"),
        CheckConstraint(
            f"principal >= 0 AND interest >= 0 AND principal + interest > 0"
            f" AND principal + interest <= {MAX_AMOUNT}",
            name="amount_range",
        ),
        CheckConstraint(f"balance_after BETWEEN 0 AND {MAX_AMOUNT}", name="balance_after_range"),
        CheckConstraint("state IN ('scheduled', 'paid', 'skipped')", name="state"),
        # Only a paid installment has a payment date or transactions.
        CheckConstraint(
            "(state = 'paid' AND paid_on IS NOT NULL)"
            " OR (state <> 'paid' AND paid_on IS NULL AND principal_transaction_id IS NULL"
            " AND interest_transaction_id IS NULL)",
            name="payment_matches_state",
        ),
        ForeignKeyConstraint(
            ["loan_id", "workspace_id"],
            ["finance_loans.id", "finance_loans.workspace_id"],
            ondelete="CASCADE",
        ),
        # Named explicitly: the conventional names exceed PostgreSQL's 63-character limit.
        ForeignKeyConstraint(
            ["principal_transaction_id", "workspace_id"],
            _TRANSACTION_KEY,
            name="fk_finance_loan_installments_principal_tx",
        ),
        ForeignKeyConstraint(
            ["interest_transaction_id", "workspace_id"],
            _TRANSACTION_KEY,
            name="fk_finance_loan_installments_interest_tx",
        ),
        UniqueConstraint("loan_id", "sequence", name="uq_finance_loan_installments_sequence"),
        UniqueConstraint(
            "principal_transaction_id", name="uq_finance_loan_installments_principal_tx"
        ),
        UniqueConstraint(
            "interest_transaction_id", name="uq_finance_loan_installments_interest_tx"
        ),
        # The upcoming-payments view reads one workspace's date range.
        Index("ix_finance_loan_installments_workspace_due", "workspace_id", "due_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    loan_id: Mapped[uuid.UUID]
    sequence: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date]
    principal: Mapped[int] = mapped_column(BigInteger)
    interest: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    state: Mapped[str] = mapped_column(String(16))
    paid_on: Mapped[date | None]
    principal_transaction_id: Mapped[uuid.UUID | None]
    interest_transaction_id: Mapped[uuid.UUID | None]
    adjusted: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceRecurringPaymentModel(_ReminderColumns, Base):
    """A subscription or a recurring bill. Its future due dates are computed from
    `anchor_date` and `frequency`; only settled occurrences are stored. Cancelled, never deleted
    through the API, so payment history stays."""

    __tablename__ = "finance_recurring_payments"
    __table_args__ = (
        CheckConstraint("kind IN ('subscription', 'bill')", name="kind"),
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(provider) <= 100", name="provider_length"),
        CheckConstraint(f"amount > 0 AND amount <= {MAX_AMOUNT}", name="amount_range"),
        CheckConstraint("length(currency) = 3 AND currency = upper(currency)", name="currency"),
        CheckConstraint(
            "frequency IN ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')",
            name="frequency",
        ),
        CheckConstraint("end_date IS NULL OR end_date >= anchor_date", name="end_after_anchor"),
        CheckConstraint("state IN ('active', 'paused', 'cancelled')", name="state"),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        *_reminder_checks(),
        # No `ON DELETE` actions: accounts are archived rather than deleted, and a category a
        # recurring payment uses can't be deleted.
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            [
                "finance_accounts.id",
                "finance_accounts.workspace_id",
                "finance_accounts.currency",
            ],
        ),
        ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["finance_categories.id", "finance_categories.workspace_id"],
        ),
        # The target of the occurrences' and reminders' composite foreign keys.
        UniqueConstraint("id", "workspace_id"),
        Index("ix_finance_recurring_payments_workspace_kind", "workspace_id", "kind"),
        Index("ix_finance_recurring_payments_workspace_category", "workspace_id", "category_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str] = mapped_column(String(100))
    category_id: Mapped[uuid.UUID | None]
    account_id: Mapped[uuid.UUID | None]
    amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    amount_varies: Mapped[bool]
    frequency: Mapped[str] = mapped_column(String(16))
    start_date: Mapped[date]
    anchor_date: Mapped[date]
    end_date: Mapped[date | None]
    trial_ends_on: Mapped[date | None]
    auto_renew: Mapped[bool]
    state: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceRecurringOccurrenceModel(Base):
    """One settled (paid or skipped) occurrence of a recurring payment. The unique due date per
    recurring payment means an occurrence can be settled only once."""

    __tablename__ = "finance_recurring_occurrences"
    __table_args__ = (
        CheckConstraint("state IN ('paid', 'skipped')", name="state"),
        CheckConstraint(
            f"(state = 'paid' AND amount > 0 AND amount <= {MAX_AMOUNT} AND paid_on IS NOT NULL)"
            " OR (state = 'skipped' AND amount IS NULL AND paid_on IS NULL"
            " AND transaction_id IS NULL)",
            name="payment_matches_state",
        ),
        ForeignKeyConstraint(
            ["recurring_payment_id", "workspace_id"],
            ["finance_recurring_payments.id", "finance_recurring_payments.workspace_id"],
            ondelete="CASCADE",
            name="fk_finance_recurring_occurrences_payment",
        ),
        ForeignKeyConstraint(
            ["transaction_id", "workspace_id"],
            _TRANSACTION_KEY,
            name="fk_finance_recurring_occurrences_tx",
        ),
        UniqueConstraint(
            "recurring_payment_id", "due_date", name="uq_finance_recurring_occurrences_due"
        ),
        UniqueConstraint("transaction_id", name="uq_finance_recurring_occurrences_transaction"),
        Index("ix_finance_recurring_occurrences_workspace_due", "workspace_id", "due_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    recurring_payment_id: Mapped[uuid.UUID]
    due_date: Mapped[date]
    state: Mapped[str] = mapped_column(String(16))
    amount: Mapped[int | None] = mapped_column(BigInteger)
    paid_on: Mapped[date | None]
    transaction_id: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
