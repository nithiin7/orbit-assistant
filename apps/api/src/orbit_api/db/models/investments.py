"""Investments, other assets, and net worth snapshots.

An investment account is a `finance_accounts` row of type `investment` plus a profile; its
ledger balance stays the source of truth for cash. Holdings, deposits, and their transactions
hang off the profile through composite foreign keys that keep them in its workspace and
currency. Investment transactions point at the ledger rows they recorded (a transfer, income, or
an expense) through keys without an `ON DELETE` action, so the ledger can't delete them first,
and each ledger row backs at most one investment transaction.

Quantities and prices are scaled integers (millionths), money is minor units: see
`services.investments.quantities`.
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
from orbit_api.db.models.commitments import ReminderColumns, reminder_checks

# Mirror `services.finance.money.MAX_AMOUNT` and `services.investments.quantities`.
MAX_AMOUNT = 10**13
MAX_QUANTITY = 10**17
MAX_PRICE = 10**15

_ACCOUNT_KEY = ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"]
_PROFILE_KEY = [
    "finance_investment_accounts.account_id",
    "finance_investment_accounts.workspace_id",
    "finance_investment_accounts.currency",
]
_TRANSACTION_KEY = ["finance_transactions.id", "finance_transactions.workspace_id"]
_CURRENCY = "length(currency) = 3 AND currency = upper(currency)"


class FinanceInvestmentAccountModel(Base):
    """The investment profile of a finance account. Deleting the account deletes it."""

    __tablename__ = "finance_investment_accounts"
    __table_args__ = (
        CheckConstraint("kind IN ('mutual_fund', 'brokerage', 'deposit', 'other')", name="kind"),
        CheckConstraint("length(provider) <= 100", name="provider_length"),
        CheckConstraint(_CURRENCY, name="currency"),
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            _ACCOUNT_KEY,
            ondelete="CASCADE",
            name="fk_finance_investment_accounts_account",
        ),
        # No `ON DELETE` action: accounts are archived, not deleted.
        ForeignKeyConstraint(
            ["linked_account_id", "workspace_id", "currency"],
            _ACCOUNT_KEY,
            name="fk_finance_investment_accounts_linked",
        ),
        # The target of holdings', deposits', and investment transactions' foreign keys.
        UniqueConstraint("account_id", "workspace_id", "currency"),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    currency: Mapped[str] = mapped_column(String(3))
    kind: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(100))
    linked_account_id: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceHoldingModel(Base):
    """A mutual fund scheme, stock, or ETF held in an investment account. Quantity and cost are
    derived from its transactions, never stored."""

    __tablename__ = "finance_holdings"
    __table_args__ = (
        CheckConstraint("kind IN ('mutual_fund', 'stock', 'etf')", name="kind"),
        CheckConstraint("length(name) BETWEEN 1 AND 200", name="name_length"),
        CheckConstraint("length(symbol) <= 40", name="symbol_length"),
        CheckConstraint("length(exchange) <= 20", name="exchange_length"),
        CheckConstraint("isin = '' OR length(isin) = 12", name="isin_length"),
        CheckConstraint("length(issuer) <= 100", name="issuer_length"),
        CheckConstraint("length(category) <= 100", name="category_length"),
        CheckConstraint("length(folio) <= 40", name="folio_length"),
        CheckConstraint("length(identity) BETWEEN 1 AND 400", name="identity_length"),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        CheckConstraint(_CURRENCY, name="currency"),
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            _PROFILE_KEY,
            ondelete="CASCADE",
            name="fk_finance_holdings_account",
        ),
        # One holding per instrument and folio in an account.
        UniqueConstraint("account_id", "identity", name="uq_finance_holdings_identity"),
        # The target of prices', SIP plans', and transactions' foreign keys.
        UniqueConstraint("id", "workspace_id", "currency"),
        Index("ix_finance_holdings_workspace_account", "workspace_id", "account_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID]
    currency: Mapped[str] = mapped_column(String(3))
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    symbol: Mapped[str] = mapped_column(String(40))
    exchange: Mapped[str] = mapped_column(String(20))
    isin: Mapped[str] = mapped_column(String(12))
    issuer: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(100))
    folio: Mapped[str] = mapped_column(String(40))
    # Normalized identity (see `Holding.identity`), unique per account.
    identity: Mapped[str] = mapped_column(String(400))
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceHoldingPriceModel(Base):
    """A holding's price (NAV or market price) on a date, with where it came from. One per
    holding and date; the latest on or before a date values the holding then."""

    __tablename__ = "finance_holding_prices"
    __table_args__ = (
        CheckConstraint(f"price > 0 AND price <= {MAX_PRICE}", name="price_range"),
        CheckConstraint("source IN ('manual', 'import', 'provider')", name="source"),
        ForeignKeyConstraint(
            ["holding_id", "workspace_id", "currency"],
            ["finance_holdings.id", "finance_holdings.workspace_id", "finance_holdings.currency"],
            ondelete="CASCADE",
            name="fk_finance_holding_prices_holding",
        ),
        UniqueConstraint("holding_id", "price_date", name="uq_finance_holding_prices_date"),
        Index("ix_finance_holding_prices_workspace", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    holding_id: Mapped[uuid.UUID]
    currency: Mapped[str] = mapped_column(String(3))
    price_date: Mapped[date]
    price: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FinanceSipPlanModel(Base):
    """A scheduled SIP: expected buys, not investments. Deleting the holding deletes it."""

    __tablename__ = "finance_sip_plans"
    __table_args__ = (
        CheckConstraint(f"amount > 0 AND amount <= {MAX_AMOUNT}", name="amount_range"),
        CheckConstraint(
            "frequency IN ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')",
            name="frequency",
        ),
        CheckConstraint("end_date IS NULL OR end_date >= anchor_date", name="end_after_anchor"),
        CheckConstraint("state IN ('active', 'paused', 'cancelled')", name="state"),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        CheckConstraint(_CURRENCY, name="currency"),
        ForeignKeyConstraint(
            ["holding_id", "workspace_id", "currency"],
            ["finance_holdings.id", "finance_holdings.workspace_id", "finance_holdings.currency"],
            ondelete="CASCADE",
            name="fk_finance_sip_plans_holding",
        ),
        ForeignKeyConstraint(
            ["funding_account_id", "workspace_id", "currency"],
            _ACCOUNT_KEY,
            name="fk_finance_sip_plans_funding_account",
        ),
        UniqueConstraint("id", "workspace_id"),
        Index("ix_finance_sip_plans_workspace", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    holding_id: Mapped[uuid.UUID]
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[int] = mapped_column(BigInteger)
    frequency: Mapped[str] = mapped_column(String(16))
    anchor_date: Mapped[date]
    end_date: Mapped[date | None]
    funding_account_id: Mapped[uuid.UUID | None]
    state: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceDepositModel(ReminderColumns, Base):
    """A fixed or recurring deposit in an investment account. Its principal is derived from its
    `deposit` and `withdrawal` transactions; the reminder settings announce its maturity."""

    __tablename__ = "finance_deposits"
    __table_args__ = (
        CheckConstraint("kind IN ('fixed', 'recurring')", name="kind"),
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(institution) <= 100", name="institution_length"),
        CheckConstraint("interest_rate_bps BETWEEN 0 AND 10000", name="interest_rate_range"),
        CheckConstraint(
            "compounding IN ('monthly', 'quarterly', 'half_yearly', 'yearly', 'simple')",
            name="compounding",
        ),
        CheckConstraint("maturity_date > start_date", name="maturity_after_start"),
        CheckConstraint(
            "(kind = 'recurring' AND installment_amount IS NOT NULL"
            f" AND installment_amount > 0"
            f" AND installment_amount <= {MAX_AMOUNT})"
            " OR (kind = 'fixed' AND installment_amount IS NULL)",
            name="installment_matches_kind",
        ),
        CheckConstraint(
            f"stated_maturity_amount IS NULL"
            f" OR (stated_maturity_amount > 0 AND stated_maturity_amount <= {MAX_AMOUNT})",
            name="stated_maturity_range",
        ),
        CheckConstraint("status IN ('active', 'matured', 'closed')", name="status"),
        CheckConstraint(
            "(status = 'active' AND closed_on IS NULL)"
            " OR (status <> 'active' AND closed_on IS NOT NULL)",
            name="closed_matches_status",
        ),
        CheckConstraint(
            f"(manual_value IS NULL AND manual_valued_on IS NULL)"
            f" OR (manual_value IS NOT NULL AND manual_value BETWEEN 0 AND {MAX_AMOUNT}"
            " AND manual_valued_on IS NOT NULL)",
            name="manual_value",
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        CheckConstraint(_CURRENCY, name="currency"),
        *reminder_checks(),
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            _PROFILE_KEY,
            ondelete="CASCADE",
            name="fk_finance_deposits_account",
        ),
        # The target of transactions' and reminders' foreign keys.
        UniqueConstraint("id", "workspace_id"),
        Index("ix_finance_deposits_workspace", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID]
    currency: Mapped[str] = mapped_column(String(3))
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(100))
    institution: Mapped[str] = mapped_column(String(100))
    interest_rate_bps: Mapped[int] = mapped_column(Integer)
    compounding: Mapped[str] = mapped_column(String(16))
    start_date: Mapped[date]
    maturity_date: Mapped[date]
    installment_amount: Mapped[int | None] = mapped_column(BigInteger)
    stated_maturity_amount: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16))
    closed_on: Mapped[date | None]
    manual_value: Mapped[int | None] = mapped_column(BigInteger)
    manual_valued_on: Mapped[date | None]
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceInvestmentTransactionModel(Base):
    """A buy, sale, dividend, interest payment, fee, or deposit flow in an investment account,
    linked to the ledger rows that record its cash."""

    __tablename__ = "finance_investment_transactions"
    __table_args__ = (
        CheckConstraint(
            "type IN ('buy', 'sell', 'dividend', 'interest', 'fee', 'deposit', 'withdrawal')",
            name="type",
        ),
        CheckConstraint(f"amount > 0 AND amount <= {MAX_AMOUNT}", name="amount_range"),
        CheckConstraint(f"fees >= 0 AND fees <= {MAX_AMOUNT}", name="fees_range"),
        CheckConstraint(
            "settlement IN ('investment_account', 'account', 'none')", name="settlement"
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        CheckConstraint(_CURRENCY, name="currency"),
        # Trades name a holding and a quantity; deposit flows name a deposit; nothing else
        # has units.
        CheckConstraint(
            f"(type IN ('buy', 'sell') AND holding_id IS NOT NULL AND deposit_id IS NULL"
            f" AND quantity IS NOT NULL AND quantity > 0 AND quantity <= {MAX_QUANTITY})"
            " OR (type IN ('deposit', 'withdrawal') AND deposit_id IS NOT NULL"
            " AND holding_id IS NULL AND quantity IS NULL AND fees = 0)"
            " OR (type = 'dividend' AND holding_id IS NOT NULL AND deposit_id IS NULL"
            " AND quantity IS NULL AND fees = 0)"
            " OR (type IN ('interest', 'fee') AND quantity IS NULL AND fees = 0"
            " AND (holding_id IS NULL OR deposit_id IS NULL))",
            name="shape",
        ),
        CheckConstraint(
            "(type = 'buy' AND plan IN ('lump_sum', 'sip')) OR (type <> 'buy' AND plan IS NULL)",
            name="plan",
        ),
        CheckConstraint(
            "(sip_plan_id IS NULL AND sip_due_date IS NULL)"
            " OR (type = 'buy' AND plan = 'sip' AND sip_due_date IS NOT NULL)",
            name="sip_installment",
        ),
        # Only buys and deposits can come from outside Orbit; income and fees always have a
        # ledger row; money settled through another account has its transfer.
        CheckConstraint(
            "settlement <> 'none' OR (type IN ('buy', 'deposit') AND fees = 0"
            " AND cash_transaction_id IS NULL AND cash_account_id IS NULL)",
            name="settlement_none",
        ),
        CheckConstraint(
            "settlement <> 'account'"
            " OR (cash_account_id IS NOT NULL AND cash_transaction_id IS NOT NULL)",
            name="settlement_account",
        ),
        CheckConstraint(
            "type NOT IN ('dividend', 'interest', 'fee') OR cash_transaction_id IS NOT NULL",
            name="income_recorded",
        ),
        CheckConstraint(
            "(fees = 0 AND fee_transaction_id IS NULL) OR (fees > 0 AND fee_transaction_id IS NOT"
            " NULL)",
            name="fees_recorded",
        ),
        ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            _PROFILE_KEY,
            ondelete="CASCADE",
            name="fk_finance_investment_transactions_account",
        ),
        # No `ON DELETE` actions: a holding or deposit with history can't be deleted, and the
        # ledger can't delete a row an investment transaction records.
        ForeignKeyConstraint(
            ["holding_id", "workspace_id", "currency"],
            ["finance_holdings.id", "finance_holdings.workspace_id", "finance_holdings.currency"],
            name="fk_finance_investment_transactions_holding",
        ),
        ForeignKeyConstraint(
            ["deposit_id", "workspace_id"],
            ["finance_deposits.id", "finance_deposits.workspace_id"],
            name="fk_finance_investment_transactions_deposit",
        ),
        ForeignKeyConstraint(
            ["sip_plan_id", "workspace_id"],
            ["finance_sip_plans.id", "finance_sip_plans.workspace_id"],
            name="fk_finance_investment_transactions_sip_plan",
        ),
        ForeignKeyConstraint(
            ["cash_account_id", "workspace_id", "currency"],
            _ACCOUNT_KEY,
            name="fk_finance_investment_transactions_cash_account",
        ),
        ForeignKeyConstraint(
            ["cash_transaction_id", "workspace_id"],
            _TRANSACTION_KEY,
            name="fk_finance_investment_transactions_cash_tx",
        ),
        ForeignKeyConstraint(
            ["fee_transaction_id", "workspace_id"],
            _TRANSACTION_KEY,
            name="fk_finance_investment_transactions_fee_tx",
        ),
        UniqueConstraint("cash_transaction_id", name="uq_finance_investment_transactions_cash_tx"),
        UniqueConstraint("fee_transaction_id", name="uq_finance_investment_transactions_fee_tx"),
        # A SIP installment is recorded once per due date.
        UniqueConstraint(
            "sip_plan_id", "sip_due_date", name="uq_finance_investment_transactions_sip_due"
        ),
        Index("ix_finance_investment_transactions_workspace_date", "workspace_id", "trade_date"),
        Index("ix_finance_investment_transactions_holding", "holding_id"),
        Index("ix_finance_investment_transactions_deposit", "deposit_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID]
    currency: Mapped[str] = mapped_column(String(3))
    type: Mapped[str] = mapped_column(String(16))
    trade_date: Mapped[date]
    amount: Mapped[int] = mapped_column(BigInteger)
    fees: Mapped[int] = mapped_column(BigInteger)
    holding_id: Mapped[uuid.UUID | None]
    deposit_id: Mapped[uuid.UUID | None]
    sip_plan_id: Mapped[uuid.UUID | None]
    sip_due_date: Mapped[date | None]
    quantity: Mapped[int | None] = mapped_column(BigInteger)
    plan: Mapped[str | None] = mapped_column(String(16))
    settlement: Mapped[str] = mapped_column(String(24))
    cash_account_id: Mapped[uuid.UUID | None]
    cash_transaction_id: Mapped[uuid.UUID | None]
    fee_transaction_id: Mapped[uuid.UUID | None]
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceAssetModel(Base):
    """A manually valued asset: gold, property, a vehicle, cash outside any account, …"""

    __tablename__ = "finance_assets"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint(
            "category IN ('gold', 'cash', 'property', 'vehicle', 'other')", name="category"
        ),
        CheckConstraint(_CURRENCY, name="currency"),
        CheckConstraint(
            f"purchase_cost IS NULL OR purchase_cost BETWEEN 0 AND {MAX_AMOUNT}",
            name="purchase_cost_range",
        ),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        ForeignKeyConstraint(
            ["linked_account_id", "workspace_id", "currency"],
            _ACCOUNT_KEY,
            name="fk_finance_assets_linked_account",
        ),
        # Names are unique per workspace (case-insensitively in the service).
        UniqueConstraint("workspace_id", "name", name="uq_finance_assets_workspace_name"),
        UniqueConstraint("id", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(16))
    currency: Mapped[str] = mapped_column(String(3))
    purchase_date: Mapped[date | None]
    purchase_cost: Mapped[int | None] = mapped_column(BigInteger)
    linked_account_id: Mapped[uuid.UUID | None]
    include_in_net_worth: Mapped[bool]
    notes: Mapped[str] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class FinanceAssetValuationModel(Base):
    """An asset's value on a date. One per asset and date: history, not a single field."""

    __tablename__ = "finance_asset_valuations"
    __table_args__ = (
        CheckConstraint(f"value BETWEEN 0 AND {MAX_AMOUNT}", name="value_range"),
        CheckConstraint("source IN ('manual', 'purchase', 'import', 'provider')", name="source"),
        CheckConstraint("length(notes) <= 500", name="notes_length"),
        ForeignKeyConstraint(
            ["asset_id", "workspace_id"],
            ["finance_assets.id", "finance_assets.workspace_id"],
            ondelete="CASCADE",
            name="fk_finance_asset_valuations_asset",
        ),
        UniqueConstraint("asset_id", "valued_on", name="uq_finance_asset_valuations_date"),
        Index("ix_finance_asset_valuations_workspace", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    asset_id: Mapped[uuid.UUID]
    valued_on: Mapped[date]
    value: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FinanceNetWorthSnapshotModel(Base):
    """Net worth in one currency for one calendar month, valued as of `as_of`. The unique
    period makes generating a snapshot idempotent."""

    __tablename__ = "finance_net_worth_snapshots"
    __table_args__ = (
        CheckConstraint(_CURRENCY, name="currency"),
        CheckConstraint("source IN ('scheduled', 'manual', 'backfill')", name="source"),
        CheckConstraint(
            "estimated_items >= 0 AND manual_items >= 0 AND stale_items >= 0"
            " AND missing_items >= 0",
            name="counts",
        ),
        UniqueConstraint(
            "workspace_id", "currency", "period_start", name="uq_finance_net_worth_snapshots_period"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    currency: Mapped[str] = mapped_column(String(3))
    period_start: Mapped[date]
    as_of: Mapped[date]
    assets: Mapped[int] = mapped_column(BigInteger)
    liabilities: Mapped[int] = mapped_column(BigInteger)
    net_worth: Mapped[int] = mapped_column(BigInteger)
    # Totals per group: `[{"key": "cash", "side": "asset", "value": 123}, …]`.
    groups: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(16))
    estimated_items: Mapped[int] = mapped_column(Integer)
    manual_items: Mapped[int] = mapped_column(Integer)
    stale_items: Mapped[int] = mapped_column(Integer)
    missing_items: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
