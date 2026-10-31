"""Budgets and their periods and alerts, savings goals and their contributions, and monthly
plans. See `services.budgets`, `services.goals`, and `services.planning`.

Like every finance table, amounts are integers in the currency's minor unit, and composite
foreign keys keep every reference inside its row's workspace (and goal accounts in the goal's
currency). Nothing here holds a balance or spending total: those are derived from the ledger.
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now
from orbit_api.db.models.finance import MAX_AMOUNT

# Mirrors `services.budgets.calculation.MAX_ROLLOVER`: unspent money carried month after month
# may exceed one transaction's limit, but stays far below the 64-bit range.
MAX_ROLLOVER = 10**15
# Mirrors `services.budgets.models.MAX_THRESHOLD_PERCENT`.
MAX_THRESHOLD_PERCENT = 200

_TRANSACTION_KEY = ["finance_transactions.id", "finance_transactions.workspace_id"]


class FinanceBudgetModel(Base):
    """A spending limit, overall or for one expense category, per month or for a custom range."""

    __tablename__ = "finance_budgets"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("scope IN ('overall', 'category')", name="scope"),
        # A category budget names its category; an overall one doesn't.
        CheckConstraint(
            "(scope = 'overall' AND category_id IS NULL)"
            " OR (scope = 'category' AND category_id IS NOT NULL)",
            name="scope_category",
        ),
        CheckConstraint("length(currency) = 3 AND currency = upper(currency)", name="currency"),
        CheckConstraint(f"amount > 0 AND amount <= {MAX_AMOUNT}", name="amount_range"),
        CheckConstraint("period IN ('monthly', 'custom')", name="period"),
        CheckConstraint("rollover IN ('none', 'surplus', 'full')", name="rollover"),
        # A custom period has an end and nothing to roll over into.
        CheckConstraint(
            "period = 'monthly' OR (end_date IS NOT NULL AND rollover = 'none')",
            name="custom_shape",
        ),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="dates"),
        CheckConstraint("state IN ('active', 'archived')", name="state"),
        CheckConstraint(
            "(state = 'archived' AND archived_at IS NOT NULL)"
            " OR (state = 'active' AND archived_at IS NULL)",
            name="archived_matches_state",
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["finance_categories.id", "finance_categories.workspace_id"],
            name="fk_finance_budgets_category",
        ),
        # The target of the periods' composite foreign key.
        UniqueConstraint("id", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    scope: Mapped[str] = mapped_column(String(16))
    category_id: Mapped[uuid.UUID | None]
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[int] = mapped_column(BigInteger)
    period: Mapped[str] = mapped_column(String(16))
    start_date: Mapped[date]
    end_date: Mapped[date | None]
    rollover: Mapped[str] = mapped_column(String(16))
    alerts_enabled: Mapped[bool]
    # Whole percentages, ascending.
    alert_thresholds: Mapped[list[Any]] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceBudgetPeriodModel(Base):
    """One period of a budget, stored once it starts so that later edits leave it as it was.
    Closing sets `closed_at` and `spent_at_close` together, once."""

    __tablename__ = "finance_budget_periods"
    __table_args__ = (
        CheckConstraint("period_end >= period_start", name="dates"),
        CheckConstraint(f"base_amount > 0 AND base_amount <= {MAX_AMOUNT}", name="base_range"),
        CheckConstraint(
            f"rollover_amount BETWEEN -{MAX_AMOUNT} AND {MAX_ROLLOVER}", name="rollover_range"
        ),
        CheckConstraint(
            "(closed_at IS NULL AND spent_at_close IS NULL)"
            " OR (closed_at IS NOT NULL AND spent_at_close IS NOT NULL AND spent_at_close >= 0)",
            name="closed_shape",
        ),
        ForeignKeyConstraint(
            ["budget_id", "workspace_id"],
            ["finance_budgets.id", "finance_budgets.workspace_id"],
            ondelete="CASCADE",
            name="fk_finance_budget_periods_budget",
        ),
        # A budget has one period starting on any day, so a period can't be stored twice.
        UniqueConstraint("budget_id", "period_start", name="uq_finance_budget_periods_start"),
        # The target of the alerts' composite foreign key.
        UniqueConstraint("id", "workspace_id"),
        Index("ix_finance_budget_periods_workspace_budget", "workspace_id", "budget_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    budget_id: Mapped[uuid.UUID]
    period_start: Mapped[date]
    period_end: Mapped[date]
    base_amount: Mapped[int] = mapped_column(BigInteger)
    rollover_amount: Mapped[int] = mapped_column(BigInteger)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    spent_at_close: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FinanceBudgetAlertModel(Base):
    """A threshold crossed in a period. Unique per period and threshold: an alert is sent at most
    once, however often the worker checks."""

    __tablename__ = "finance_budget_alerts"
    __table_args__ = (
        CheckConstraint(f"threshold BETWEEN 1 AND {MAX_THRESHOLD_PERCENT}", name="threshold"),
        ForeignKeyConstraint(
            ["period_id", "workspace_id"],
            ["finance_budget_periods.id", "finance_budget_periods.workspace_id"],
            ondelete="CASCADE",
            name="fk_finance_budget_alerts_period",
        ),
        UniqueConstraint("period_id", "threshold", name="uq_finance_budget_alerts_threshold"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    period_id: Mapped[uuid.UUID]
    threshold: Mapped[int] = mapped_column(Integer)
    spent: Mapped[int] = mapped_column(BigInteger)
    available: Mapped[int] = mapped_column(BigInteger)
    # Deleting the notification (or its user) keeps the record, so the alert isn't sent again.
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("notifications.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FinanceSavingsGoalModel(Base):
    """A savings target. What has been saved is derived from its contributions."""

    __tablename__ = "finance_savings_goals"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(description) <= 500", name="description_length"),
        CheckConstraint(
            "category IN ('emergency_fund', 'vehicle', 'travel', 'home', 'electronics',"
            " 'education', 'wedding', 'other')",
            name="category",
        ),
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="priority"),
        CheckConstraint("length(currency) = 3 AND currency = upper(currency)", name="currency"),
        CheckConstraint(
            f"target_amount > 0 AND target_amount <= {MAX_AMOUNT}", name="target_range"
        ),
        CheckConstraint("target_date IS NULL OR target_date >= start_date", name="dates"),
        CheckConstraint("state IN ('active', 'paused', 'completed', 'cancelled')", name="state"),
        CheckConstraint(
            "(state = 'completed' AND completed_at IS NOT NULL)"
            " OR (state <> 'completed' AND completed_at IS NULL)",
            name="completed_matches_state",
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        # The linked account is in the goal's workspace and currency.
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            [
                "finance_accounts.id",
                "finance_accounts.workspace_id",
                "finance_accounts.currency",
            ],
            name="fk_finance_savings_goals_account",
        ),
        # The target of the contributions' composite foreign key.
        UniqueConstraint("id", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32))
    priority: Mapped[str] = mapped_column(String(16))
    currency: Mapped[str] = mapped_column(String(3))
    target_amount: Mapped[int] = mapped_column(BigInteger)
    start_date: Mapped[date]
    target_date: Mapped[date | None]
    state: Mapped[str] = mapped_column(String(16))
    account_id: Mapped[uuid.UUID | None]
    notes: Mapped[str] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceGoalContributionModel(Base):
    """Money put into, or taken out of, a goal. The transfer that moved it, if any, backs no
    other contribution and can't be deleted from the ledger while this row links it."""

    __tablename__ = "finance_goal_contributions"
    __table_args__ = (
        CheckConstraint("type IN ('contribution', 'withdrawal')", name="type"),
        CheckConstraint(f"amount > 0 AND amount <= {MAX_AMOUNT}", name="amount_range"),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        ForeignKeyConstraint(
            ["goal_id", "workspace_id"],
            ["finance_savings_goals.id", "finance_savings_goals.workspace_id"],
            ondelete="CASCADE",
            name="fk_finance_goal_contributions_goal",
        ),
        ForeignKeyConstraint(
            ["transaction_id", "workspace_id"],
            _TRANSACTION_KEY,
            name="fk_finance_goal_contributions_tx",
        ),
        UniqueConstraint("transaction_id", name="uq_finance_goal_contributions_transaction"),
        Index("ix_finance_goal_contributions_workspace_goal", "workspace_id", "goal_id"),
        Index("ix_finance_goal_contributions_workspace_date", "workspace_id", "occurred_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    goal_id: Mapped[uuid.UUID]
    type: Mapped[str] = mapped_column(String(16))
    amount: Mapped[int] = mapped_column(BigInteger)
    occurred_on: Mapped[date]
    transaction_id: Mapped[uuid.UUID | None]
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FinanceMonthlyPlanModel(Base):
    """A month's expected income in one currency; one per workspace, currency, and month."""

    __tablename__ = "finance_monthly_plans"
    __table_args__ = (
        CheckConstraint("length(currency) = 3 AND currency = upper(currency)", name="currency"),
        CheckConstraint(
            f"expected_income >= 0 AND expected_income <= {MAX_AMOUNT}", name="income_range"
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        UniqueConstraint(
            "workspace_id", "currency", "period_start", name="uq_finance_monthly_plans_month"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    currency: Mapped[str] = mapped_column(String(3))
    period_start: Mapped[date]
    expected_income: Mapped[int] = mapped_column(BigInteger)
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
