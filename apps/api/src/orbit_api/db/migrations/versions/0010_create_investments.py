"""Investments, other assets, and net worth snapshots.

- `finance_investment_accounts`: the investment profile of an `investment` finance account,
  whose ledger balance stays the source of truth for its cash.
- `finance_holdings` (mutual funds, stocks, ETFs) and their dated `finance_holding_prices`.
- `finance_sip_plans`: scheduled SIPs, which are expectations rather than investments.
- `finance_deposits`: fixed and recurring deposits.
- `finance_investment_transactions`: buys, sales, dividends, interest, fees, and deposit flows,
  linked to the ledger rows that record their cash.
- `finance_assets` and their dated `finance_asset_valuations`.
- `finance_net_worth_snapshots`: one per workspace, currency, and month.
- `reminders` gains an optional, unique link to a deposit (its maturity reminder).

Nothing is backfilled. On PostgreSQL every new table has Row Level Security enabled with no
policies, like the others; the API enforces access itself.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

TABLES = (
    "finance_investment_accounts",
    "finance_holdings",
    "finance_holding_prices",
    "finance_sip_plans",
    "finance_deposits",
    "finance_investment_transactions",
    "finance_assets",
    "finance_asset_valuations",
    "finance_net_worth_snapshots",
)
OLD_ONE_COMMITMENT = "finance_loan_id IS NULL OR finance_recurring_payment_id IS NULL"
# At most one of the three links is set: at least two are NULL.
NEW_ONE_COMMITMENT = (
    "(finance_loan_id IS NULL AND finance_recurring_payment_id IS NULL)"
    " OR (finance_loan_id IS NULL AND finance_deposit_id IS NULL)"
    " OR (finance_recurring_payment_id IS NULL AND finance_deposit_id IS NULL)"
)

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "finance_net_worth_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("assets", sa.BigInteger(), nullable=False),
        sa.Column("liabilities", sa.BigInteger(), nullable=False),
        sa.Column("net_worth", sa.BigInteger(), nullable=False),
        sa.Column("groups", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("estimated_items", sa.Integer(), nullable=False),
        sa.Column("manual_items", sa.Integer(), nullable=False),
        sa.Column("stale_items", sa.Integer(), nullable=False),
        sa.Column("missing_items", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('scheduled', 'manual', 'backfill')",
            name=op.f("ck_finance_net_worth_snapshots_source"),
        ),
        sa.CheckConstraint(
            "estimated_items >= 0 AND manual_items >= 0 AND stale_items >= 0 AND missing_items"
            " >= 0",
            name=op.f("ck_finance_net_worth_snapshots_counts"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_net_worth_snapshots_currency"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_net_worth_snapshots_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_net_worth_snapshots")),
        sa.UniqueConstraint(
            "workspace_id", "currency", "period_start", name="uq_finance_net_worth_snapshots_period"
        ),
    )
    op.create_table(
        "finance_assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("purchase_cost", sa.BigInteger(), nullable=True),
        sa.Column("linked_account_id", sa.Uuid(), nullable=True),
        sa.Column("include_in_net_worth", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "category IN ('gold', 'cash', 'property', 'vehicle', 'other')",
            name=op.f("ck_finance_assets_category"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_assets_currency"),
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_finance_assets_name_length")
        ),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_finance_assets_notes_length")),
        sa.CheckConstraint(
            "purchase_cost IS NULL OR purchase_cost BETWEEN 0 AND 10000000000000",
            name=op.f("ck_finance_assets_purchase_cost_range"),
        ),
        sa.ForeignKeyConstraint(
            ["linked_account_id", "workspace_id", "currency"],
            ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"],
            name="fk_finance_assets_linked_account",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_assets_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_assets")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_assets_id")),
        sa.UniqueConstraint("workspace_id", "name", name="uq_finance_assets_workspace_name"),
    )
    op.create_table(
        "finance_investment_accounts",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("provider", sa.String(length=100), nullable=False),
        sa.Column("linked_account_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('mutual_fund', 'brokerage', 'deposit', 'other')",
            name=op.f("ck_finance_investment_accounts_kind"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_investment_accounts_currency"),
        ),
        sa.CheckConstraint(
            "length(provider) <= 100", name=op.f("ck_finance_investment_accounts_provider_length")
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"],
            name="fk_finance_investment_accounts_account",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["linked_account_id", "workspace_id", "currency"],
            ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"],
            name="fk_finance_investment_accounts_linked",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_investment_accounts_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("account_id", name=op.f("pk_finance_investment_accounts")),
        sa.UniqueConstraint(
            "account_id",
            "workspace_id",
            "currency",
            name=op.f("uq_finance_investment_accounts_account_id"),
        ),
    )
    with op.batch_alter_table("finance_investment_accounts", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_finance_investment_accounts_workspace_id"),
            ["workspace_id"],
            unique=False,
        )

    op.create_table(
        "finance_asset_valuations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("valued_on", sa.Date(), nullable=False),
        sa.Column("value", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('manual', 'purchase', 'import', 'provider')",
            name=op.f("ck_finance_asset_valuations_source"),
        ),
        sa.CheckConstraint(
            "length(notes) <= 500", name=op.f("ck_finance_asset_valuations_notes_length")
        ),
        sa.CheckConstraint(
            "value BETWEEN 0 AND 10000000000000",
            name=op.f("ck_finance_asset_valuations_value_range"),
        ),
        sa.ForeignKeyConstraint(
            ["asset_id", "workspace_id"],
            ["finance_assets.id", "finance_assets.workspace_id"],
            name="fk_finance_asset_valuations_asset",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_asset_valuations_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_asset_valuations")),
        sa.UniqueConstraint("asset_id", "valued_on", name="uq_finance_asset_valuations_date"),
    )
    with op.batch_alter_table("finance_asset_valuations", schema=None) as batch_op:
        batch_op.create_index(
            "ix_finance_asset_valuations_workspace", ["workspace_id"], unique=False
        )

    op.create_table(
        "finance_deposits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("institution", sa.String(length=100), nullable=False),
        sa.Column("interest_rate_bps", sa.Integer(), nullable=False),
        sa.Column("compounding", sa.String(length=16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("maturity_date", sa.Date(), nullable=False),
        sa.Column("installment_amount", sa.BigInteger(), nullable=True),
        sa.Column("stated_maturity_amount", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("closed_on", sa.Date(), nullable=True),
        sa.Column("manual_value", sa.BigInteger(), nullable=True),
        sa.Column("manual_valued_on", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reminder_days_before", sa.Integer(), nullable=True),
        sa.Column("reminder_time", sa.Time(), nullable=True),
        sa.Column("reminder_timezone", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "(kind = 'recurring' AND installment_amount IS NOT NULL AND installment_amount > 0"
            " AND installment_amount <="
            " 10000000000000) OR (kind = 'fixed' AND installment_amount IS NULL)",
            name=op.f("ck_finance_deposits_installment_matches_kind"),
        ),
        sa.CheckConstraint(
            "(status = 'active' AND closed_on IS NULL) OR (status <> 'active' AND closed_on IS"
            " NOT NULL)",
            name=op.f("ck_finance_deposits_closed_matches_status"),
        ),
        sa.CheckConstraint(
            "compounding IN ('monthly', 'quarterly', 'half_yearly', 'yearly', 'simple')",
            name=op.f("ck_finance_deposits_compounding"),
        ),
        sa.CheckConstraint("kind IN ('fixed', 'recurring')", name=op.f("ck_finance_deposits_kind")),
        sa.CheckConstraint(
            "status IN ('active', 'matured', 'closed')", name=op.f("ck_finance_deposits_status")
        ),
        sa.CheckConstraint(
            "(manual_value IS NULL AND manual_valued_on IS NULL) OR (manual_value IS NOT NULL"
            " AND manual_value BETWEEN 0 AND"
            " 10000000000000 AND manual_valued_on IS NOT NULL)",
            name=op.f("ck_finance_deposits_manual_value"),
        ),
        sa.CheckConstraint(
            "(reminder_days_before IS NULL AND reminder_time IS NULL AND reminder_timezone IS"
            " NULL) OR (reminder_days_before BETWEEN 0 AND 30 AND reminder_time IS NOT NULL AND"
            " length(reminder_timezone) BETWEEN 1 AND 64)",
            name=op.f("ck_finance_deposits_reminder_settings"),
        ),
        sa.CheckConstraint(
            "interest_rate_bps BETWEEN 0 AND 10000",
            name=op.f("ck_finance_deposits_interest_rate_range"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_deposits_currency"),
        ),
        sa.CheckConstraint(
            "length(institution) <= 100", name=op.f("ck_finance_deposits_institution_length")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_finance_deposits_name_length")
        ),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_finance_deposits_notes_length")),
        sa.CheckConstraint(
            "maturity_date > start_date", name=op.f("ck_finance_deposits_maturity_after_start")
        ),
        sa.CheckConstraint(
            "stated_maturity_amount IS NULL OR (stated_maturity_amount > 0 AND"
            " stated_maturity_amount <= 10000000000000)",
            name=op.f("ck_finance_deposits_stated_maturity_range"),
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            [
                "finance_investment_accounts.account_id",
                "finance_investment_accounts.workspace_id",
                "finance_investment_accounts.currency",
            ],
            name="fk_finance_deposits_account",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_deposits_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_deposits")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_deposits_id")),
    )
    with op.batch_alter_table("finance_deposits", schema=None) as batch_op:
        batch_op.create_index("ix_finance_deposits_workspace", ["workspace_id"], unique=False)

    op.create_table(
        "finance_holdings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("symbol", sa.String(length=40), nullable=False),
        sa.Column("exchange", sa.String(length=20), nullable=False),
        sa.Column("isin", sa.String(length=12), nullable=False),
        sa.Column("issuer", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("folio", sa.String(length=40), nullable=False),
        sa.Column("identity", sa.String(length=400), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "isin = '' OR length(isin) = 12", name=op.f("ck_finance_holdings_isin_length")
        ),
        sa.CheckConstraint(
            "kind IN ('mutual_fund', 'stock', 'etf')", name=op.f("ck_finance_holdings_kind")
        ),
        sa.CheckConstraint(
            "length(category) <= 100", name=op.f("ck_finance_holdings_category_length")
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_holdings_currency"),
        ),
        sa.CheckConstraint(
            "length(exchange) <= 20", name=op.f("ck_finance_holdings_exchange_length")
        ),
        sa.CheckConstraint("length(folio) <= 40", name=op.f("ck_finance_holdings_folio_length")),
        sa.CheckConstraint(
            "length(identity) BETWEEN 1 AND 400", name=op.f("ck_finance_holdings_identity_length")
        ),
        sa.CheckConstraint("length(issuer) <= 100", name=op.f("ck_finance_holdings_issuer_length")),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 200", name=op.f("ck_finance_holdings_name_length")
        ),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_finance_holdings_notes_length")),
        sa.CheckConstraint("length(symbol) <= 40", name=op.f("ck_finance_holdings_symbol_length")),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            [
                "finance_investment_accounts.account_id",
                "finance_investment_accounts.workspace_id",
                "finance_investment_accounts.currency",
            ],
            name="fk_finance_holdings_account",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_holdings_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_holdings")),
        sa.UniqueConstraint("account_id", "identity", name="uq_finance_holdings_identity"),
        sa.UniqueConstraint("id", "workspace_id", "currency", name=op.f("uq_finance_holdings_id")),
    )
    with op.batch_alter_table("finance_holdings", schema=None) as batch_op:
        batch_op.create_index(
            "ix_finance_holdings_workspace_account", ["workspace_id", "account_id"], unique=False
        )

    op.create_table(
        "finance_holding_prices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("holding_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("price_date", sa.Date(), nullable=False),
        sa.Column("price", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('manual', 'import', 'provider')",
            name=op.f("ck_finance_holding_prices_source"),
        ),
        sa.CheckConstraint(
            "price > 0 AND price <= 1000000000000000",
            name=op.f("ck_finance_holding_prices_price_range"),
        ),
        sa.ForeignKeyConstraint(
            ["holding_id", "workspace_id", "currency"],
            ["finance_holdings.id", "finance_holdings.workspace_id", "finance_holdings.currency"],
            name="fk_finance_holding_prices_holding",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_holding_prices_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_holding_prices")),
        sa.UniqueConstraint("holding_id", "price_date", name="uq_finance_holding_prices_date"),
    )
    with op.batch_alter_table("finance_holding_prices", schema=None) as batch_op:
        batch_op.create_index("ix_finance_holding_prices_workspace", ["workspace_id"], unique=False)

    op.create_table(
        "finance_sip_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("holding_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("frequency", sa.String(length=16), nullable=False),
        sa.Column("anchor_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("funding_account_id", sa.Uuid(), nullable=True),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "frequency IN ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')",
            name=op.f("ck_finance_sip_plans_frequency"),
        ),
        sa.CheckConstraint(
            "state IN ('active', 'paused', 'cancelled')", name=op.f("ck_finance_sip_plans_state")
        ),
        sa.CheckConstraint(
            "amount > 0 AND amount <= 10000000000000",
            name=op.f("ck_finance_sip_plans_amount_range"),
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= anchor_date",
            name=op.f("ck_finance_sip_plans_end_after_anchor"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_sip_plans_currency"),
        ),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_finance_sip_plans_notes_length")),
        sa.ForeignKeyConstraint(
            ["funding_account_id", "workspace_id", "currency"],
            ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"],
            name="fk_finance_sip_plans_funding_account",
        ),
        sa.ForeignKeyConstraint(
            ["holding_id", "workspace_id", "currency"],
            ["finance_holdings.id", "finance_holdings.workspace_id", "finance_holdings.currency"],
            name="fk_finance_sip_plans_holding",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_sip_plans_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_sip_plans")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_sip_plans_id")),
    )
    with op.batch_alter_table("finance_sip_plans", schema=None) as batch_op:
        batch_op.create_index("ix_finance_sip_plans_workspace", ["workspace_id"], unique=False)

    op.create_table(
        "finance_investment_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("fees", sa.BigInteger(), nullable=False),
        sa.Column("holding_id", sa.Uuid(), nullable=True),
        sa.Column("deposit_id", sa.Uuid(), nullable=True),
        sa.Column("sip_plan_id", sa.Uuid(), nullable=True),
        sa.Column("sip_due_date", sa.Date(), nullable=True),
        sa.Column("quantity", sa.BigInteger(), nullable=True),
        sa.Column("plan", sa.String(length=16), nullable=True),
        sa.Column("settlement", sa.String(length=24), nullable=False),
        sa.Column("cash_account_id", sa.Uuid(), nullable=True),
        sa.Column("cash_transaction_id", sa.Uuid(), nullable=True),
        sa.Column("fee_transaction_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(sip_plan_id IS NULL AND sip_due_date IS NULL) OR (type = 'buy' AND plan = 'sip'"
            " AND sip_due_date IS NOT NULL)",
            name=op.f("ck_finance_investment_transactions_sip_installment"),
        ),
        sa.CheckConstraint(
            "(type = 'buy' AND plan IN ('lump_sum', 'sip')) OR (type <> 'buy' AND plan IS NULL)",
            name=op.f("ck_finance_investment_transactions_plan"),
        ),
        sa.CheckConstraint(
            "(type IN ('buy', 'sell') AND holding_id IS NOT NULL AND deposit_id IS NULL AND"
            " quantity IS NOT NULL AND quantity > 0 AND quantity <= 100000000000000000) OR (type"
            " IN ('deposit',"
            " 'withdrawal') AND deposit_id IS NOT NULL AND holding_id IS NULL AND quantity IS"
            " NULL AND fees = 0) OR (type = 'dividend' AND holding_id IS NOT NULL AND deposit_id"
            " IS NULL AND quantity IS NULL AND fees = 0) OR (type IN ('interest', 'fee') AND"
            " quantity IS NULL AND fees = 0 AND (holding_id IS NULL OR deposit_id IS NULL))",
            name=op.f("ck_finance_investment_transactions_shape"),
        ),
        sa.CheckConstraint(
            "settlement <> 'account' OR (cash_account_id IS NOT NULL AND cash_transaction_id IS"
            " NOT NULL)",
            name=op.f("ck_finance_investment_transactions_settlement_account"),
        ),
        sa.CheckConstraint(
            "settlement <> 'none' OR (type IN ('buy', 'deposit') AND fees = 0 AND"
            " cash_transaction_id IS NULL AND cash_account_id IS NULL)",
            name=op.f("ck_finance_investment_transactions_settlement_none"),
        ),
        sa.CheckConstraint(
            "settlement IN ('investment_account', 'account', 'none')",
            name=op.f("ck_finance_investment_transactions_settlement"),
        ),
        sa.CheckConstraint(
            "type IN ('buy', 'sell', 'dividend', 'interest', 'fee', 'deposit', 'withdrawal')",
            name=op.f("ck_finance_investment_transactions_type"),
        ),
        sa.CheckConstraint(
            "type NOT IN ('dividend', 'interest', 'fee') OR cash_transaction_id IS NOT NULL",
            name=op.f("ck_finance_investment_transactions_income_recorded"),
        ),
        sa.CheckConstraint(
            "(fees = 0 AND fee_transaction_id IS NULL) OR (fees > 0 AND fee_transaction_id IS"
            " NOT NULL)",
            name=op.f("ck_finance_investment_transactions_fees_recorded"),
        ),
        sa.CheckConstraint(
            "amount > 0 AND amount <= 10000000000000",
            name=op.f("ck_finance_investment_transactions_amount_range"),
        ),
        sa.CheckConstraint(
            "fees >= 0 AND fees <= 10000000000000",
            name=op.f("ck_finance_investment_transactions_fees_range"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_investment_transactions_currency"),
        ),
        sa.CheckConstraint(
            "length(notes) <= 2000", name=op.f("ck_finance_investment_transactions_notes_length")
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            [
                "finance_investment_accounts.account_id",
                "finance_investment_accounts.workspace_id",
                "finance_investment_accounts.currency",
            ],
            name="fk_finance_investment_transactions_account",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cash_account_id", "workspace_id", "currency"],
            ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"],
            name="fk_finance_investment_transactions_cash_account",
        ),
        sa.ForeignKeyConstraint(
            ["cash_transaction_id", "workspace_id"],
            ["finance_transactions.id", "finance_transactions.workspace_id"],
            name="fk_finance_investment_transactions_cash_tx",
        ),
        sa.ForeignKeyConstraint(
            ["deposit_id", "workspace_id"],
            ["finance_deposits.id", "finance_deposits.workspace_id"],
            name="fk_finance_investment_transactions_deposit",
        ),
        sa.ForeignKeyConstraint(
            ["fee_transaction_id", "workspace_id"],
            ["finance_transactions.id", "finance_transactions.workspace_id"],
            name="fk_finance_investment_transactions_fee_tx",
        ),
        sa.ForeignKeyConstraint(
            ["holding_id", "workspace_id", "currency"],
            ["finance_holdings.id", "finance_holdings.workspace_id", "finance_holdings.currency"],
            name="fk_finance_investment_transactions_holding",
        ),
        sa.ForeignKeyConstraint(
            ["sip_plan_id", "workspace_id"],
            ["finance_sip_plans.id", "finance_sip_plans.workspace_id"],
            name="fk_finance_investment_transactions_sip_plan",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_investment_transactions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_investment_transactions")),
        sa.UniqueConstraint(
            "cash_transaction_id", name="uq_finance_investment_transactions_cash_tx"
        ),
        sa.UniqueConstraint("fee_transaction_id", name="uq_finance_investment_transactions_fee_tx"),
        sa.UniqueConstraint(
            "sip_plan_id", "sip_due_date", name="uq_finance_investment_transactions_sip_due"
        ),
    )
    with op.batch_alter_table("finance_investment_transactions", schema=None) as batch_op:
        batch_op.create_index(
            "ix_finance_investment_transactions_deposit", ["deposit_id"], unique=False
        )
        batch_op.create_index(
            "ix_finance_investment_transactions_holding", ["holding_id"], unique=False
        )
        batch_op.create_index(
            "ix_finance_investment_transactions_workspace_date",
            ["workspace_id", "trade_date"],
            unique=False,
        )

    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("finance_deposit_id", sa.Uuid(), nullable=True))
        batch_op.create_unique_constraint("uq_reminders_finance_deposit_id", ["finance_deposit_id"])
        batch_op.create_foreign_key(
            "fk_reminders_finance_deposit",
            "finance_deposits",
            ["finance_deposit_id", "workspace_id"],
            ["id", "workspace_id"],
            ondelete="CASCADE",
        )
        batch_op.drop_constraint(op.f("ck_reminders_one_commitment"), type_="check")
        batch_op.create_check_constraint(op.f("ck_reminders_one_commitment"), NEW_ONE_COMMITMENT)

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Deposit reminders can't survive without their link; their notifications stay.
    op.execute("DELETE FROM reminders WHERE finance_deposit_id IS NOT NULL")
    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_reminders_one_commitment"), type_="check")
        batch_op.create_check_constraint(op.f("ck_reminders_one_commitment"), OLD_ONE_COMMITMENT)
        batch_op.drop_constraint("fk_reminders_finance_deposit", type_="foreignkey")
        batch_op.drop_constraint("uq_reminders_finance_deposit_id", type_="unique")
        batch_op.drop_column("finance_deposit_id")

    with op.batch_alter_table("finance_investment_transactions", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_investment_transactions_workspace_date")
        batch_op.drop_index("ix_finance_investment_transactions_holding")
        batch_op.drop_index("ix_finance_investment_transactions_deposit")

    op.drop_table("finance_investment_transactions")
    with op.batch_alter_table("finance_sip_plans", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_sip_plans_workspace")

    op.drop_table("finance_sip_plans")
    with op.batch_alter_table("finance_holding_prices", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_holding_prices_workspace")

    op.drop_table("finance_holding_prices")
    with op.batch_alter_table("finance_holdings", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_holdings_workspace_account")

    op.drop_table("finance_holdings")
    with op.batch_alter_table("finance_deposits", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_deposits_workspace")

    op.drop_table("finance_deposits")
    with op.batch_alter_table("finance_asset_valuations", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_asset_valuations_workspace")

    op.drop_table("finance_asset_valuations")
    with op.batch_alter_table("finance_investment_accounts", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_finance_investment_accounts_workspace_id"))

    op.drop_table("finance_investment_accounts")
    op.drop_table("finance_assets")
    op.drop_table("finance_net_worth_snapshots")
