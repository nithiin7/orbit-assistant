"""Budgets, savings goals, and monthly plans.

- `finance_budgets`: spending limits, overall or per expense category, monthly or custom.
- `finance_budget_periods`: each budget's periods as they start, so history keeps its amounts,
  with the rollover carried in and the spending recorded when the period closed.
- `finance_budget_alerts`: thresholds crossed per period, unique so an alert is sent once; the
  notification itself is an ordinary row in `notifications`.
- `finance_savings_goals` and `finance_goal_contributions`: targets, and money earmarked for
  them, optionally linked (uniquely) to the ledger transfer that moved it.
- `finance_monthly_plans`: a month's expected income per currency.

Nothing is backfilled. On PostgreSQL every new table has Row Level Security enabled with no
policies, like the others; the API enforces access itself.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

TABLES = (
    "finance_budgets",
    "finance_budget_periods",
    "finance_budget_alerts",
    "finance_savings_goals",
    "finance_goal_contributions",
    "finance_monthly_plans",
)

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "finance_monthly_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("expected_income", sa.BigInteger(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "expected_income >= 0 AND expected_income <= 10000000000000",
            name=op.f("ck_finance_monthly_plans_income_range"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_monthly_plans_currency"),
        ),
        sa.CheckConstraint(
            "length(notes) <= 2000", name=op.f("ck_finance_monthly_plans_notes_length")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_monthly_plans_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_monthly_plans")),
        sa.UniqueConstraint(
            "workspace_id", "currency", "period_start", name="uq_finance_monthly_plans_month"
        ),
    )
    op.create_table(
        "finance_budgets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("period", sa.String(length=16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("rollover", sa.String(length=16), nullable=False),
        sa.Column("alerts_enabled", sa.Boolean(), nullable=False),
        sa.Column("alert_thresholds", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(scope = 'overall' AND category_id IS NULL)"
            " OR (scope = 'category' AND category_id IS NOT NULL)",
            name=op.f("ck_finance_budgets_scope_category"),
        ),
        sa.CheckConstraint(
            "(state = 'archived' AND archived_at IS NOT NULL)"
            " OR (state = 'active' AND archived_at IS NULL)",
            name=op.f("ck_finance_budgets_archived_matches_state"),
        ),
        sa.CheckConstraint(
            "period = 'monthly' OR (end_date IS NOT NULL AND rollover = 'none')",
            name=op.f("ck_finance_budgets_custom_shape"),
        ),
        sa.CheckConstraint(
            "period IN ('monthly', 'custom')", name=op.f("ck_finance_budgets_period")
        ),
        sa.CheckConstraint(
            "rollover IN ('none', 'surplus', 'full')", name=op.f("ck_finance_budgets_rollover")
        ),
        sa.CheckConstraint(
            "scope IN ('overall', 'category')", name=op.f("ck_finance_budgets_scope")
        ),
        sa.CheckConstraint(
            "state IN ('active', 'archived')", name=op.f("ck_finance_budgets_state")
        ),
        sa.CheckConstraint(
            "amount > 0 AND amount <= 10000000000000", name=op.f("ck_finance_budgets_amount_range")
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date", name=op.f("ck_finance_budgets_dates")
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_budgets_currency"),
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_finance_budgets_name_length")
        ),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_finance_budgets_notes_length")),
        sa.ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["finance_categories.id", "finance_categories.workspace_id"],
            name="fk_finance_budgets_category",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_budgets_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_budgets")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_budgets_id")),
    )
    with op.batch_alter_table("finance_budgets", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_finance_budgets_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "finance_savings_goals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("target_amount", sa.BigInteger(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(state = 'completed' AND completed_at IS NOT NULL)"
            " OR (state <> 'completed' AND completed_at IS NULL)",
            name=op.f("ck_finance_savings_goals_completed_matches_state"),
        ),
        sa.CheckConstraint(
            "category IN ('emergency_fund', 'vehicle', 'travel', 'home', 'electronics',"
            " 'education', 'wedding', 'other')",
            name=op.f("ck_finance_savings_goals_category"),
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'medium', 'high')", name=op.f("ck_finance_savings_goals_priority")
        ),
        sa.CheckConstraint(
            "state IN ('active', 'paused', 'completed', 'cancelled')",
            name=op.f("ck_finance_savings_goals_state"),
        ),
        sa.CheckConstraint(
            "length(currency) = 3 AND currency = upper(currency)",
            name=op.f("ck_finance_savings_goals_currency"),
        ),
        sa.CheckConstraint(
            "length(description) <= 500", name=op.f("ck_finance_savings_goals_description_length")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_finance_savings_goals_name_length")
        ),
        sa.CheckConstraint(
            "length(notes) <= 2000", name=op.f("ck_finance_savings_goals_notes_length")
        ),
        sa.CheckConstraint(
            "target_amount > 0 AND target_amount <= 10000000000000",
            name=op.f("ck_finance_savings_goals_target_range"),
        ),
        sa.CheckConstraint(
            "target_date IS NULL OR target_date >= start_date",
            name=op.f("ck_finance_savings_goals_dates"),
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "workspace_id", "currency"],
            ["finance_accounts.id", "finance_accounts.workspace_id", "finance_accounts.currency"],
            name="fk_finance_savings_goals_account",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_savings_goals_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_savings_goals")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_savings_goals_id")),
    )
    with op.batch_alter_table("finance_savings_goals", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_finance_savings_goals_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "finance_budget_periods",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("base_amount", sa.BigInteger(), nullable=False),
        sa.Column("rollover_amount", sa.BigInteger(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("spent_at_close", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(closed_at IS NULL AND spent_at_close IS NULL)"
            " OR (closed_at IS NOT NULL AND spent_at_close IS NOT NULL AND spent_at_close >= 0)",
            name=op.f("ck_finance_budget_periods_closed_shape"),
        ),
        sa.CheckConstraint(
            "base_amount > 0 AND base_amount <= 10000000000000",
            name=op.f("ck_finance_budget_periods_base_range"),
        ),
        sa.CheckConstraint(
            "period_end >= period_start", name=op.f("ck_finance_budget_periods_dates")
        ),
        sa.CheckConstraint(
            "rollover_amount BETWEEN -10000000000000 AND 1000000000000000",
            name=op.f("ck_finance_budget_periods_rollover_range"),
        ),
        sa.ForeignKeyConstraint(
            ["budget_id", "workspace_id"],
            ["finance_budgets.id", "finance_budgets.workspace_id"],
            name="fk_finance_budget_periods_budget",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_budget_periods_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_budget_periods")),
        sa.UniqueConstraint("budget_id", "period_start", name="uq_finance_budget_periods_start"),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_finance_budget_periods_id")),
    )
    with op.batch_alter_table("finance_budget_periods", schema=None) as batch_op:
        batch_op.create_index(
            "ix_finance_budget_periods_workspace_budget",
            ["workspace_id", "budget_id"],
            unique=False,
        )

    op.create_table(
        "finance_goal_contributions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("goal_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('contribution', 'withdrawal')",
            name=op.f("ck_finance_goal_contributions_type"),
        ),
        sa.CheckConstraint(
            "amount > 0 AND amount <= 10000000000000",
            name=op.f("ck_finance_goal_contributions_amount_range"),
        ),
        sa.CheckConstraint(
            "length(notes) <= 2000", name=op.f("ck_finance_goal_contributions_notes_length")
        ),
        sa.ForeignKeyConstraint(
            ["goal_id", "workspace_id"],
            ["finance_savings_goals.id", "finance_savings_goals.workspace_id"],
            name="fk_finance_goal_contributions_goal",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id", "workspace_id"],
            ["finance_transactions.id", "finance_transactions.workspace_id"],
            name="fk_finance_goal_contributions_tx",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_goal_contributions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_goal_contributions")),
        sa.UniqueConstraint("transaction_id", name="uq_finance_goal_contributions_transaction"),
    )
    with op.batch_alter_table("finance_goal_contributions", schema=None) as batch_op:
        batch_op.create_index(
            "ix_finance_goal_contributions_workspace_date",
            ["workspace_id", "occurred_on"],
            unique=False,
        )
        batch_op.create_index(
            "ix_finance_goal_contributions_workspace_goal",
            ["workspace_id", "goal_id"],
            unique=False,
        )

    op.create_table(
        "finance_budget_alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("period_id", sa.Uuid(), nullable=False),
        sa.Column("threshold", sa.Integer(), nullable=False),
        sa.Column("spent", sa.BigInteger(), nullable=False),
        sa.Column("available", sa.BigInteger(), nullable=False),
        sa.Column("notification_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "threshold BETWEEN 1 AND 200", name=op.f("ck_finance_budget_alerts_threshold")
        ),
        sa.ForeignKeyConstraint(
            ["notification_id"],
            ["notifications.id"],
            name=op.f("fk_finance_budget_alerts_notification_id_notifications"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["period_id", "workspace_id"],
            ["finance_budget_periods.id", "finance_budget_periods.workspace_id"],
            name="fk_finance_budget_alerts_period",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_finance_budget_alerts_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finance_budget_alerts")),
        sa.UniqueConstraint("period_id", "threshold", name="uq_finance_budget_alerts_threshold"),
    )
    with op.batch_alter_table("finance_budget_alerts", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_finance_budget_alerts_workspace_id"), ["workspace_id"], unique=False
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("finance_budget_alerts", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_finance_budget_alerts_workspace_id"))

    op.drop_table("finance_budget_alerts")
    with op.batch_alter_table("finance_goal_contributions", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_goal_contributions_workspace_goal")
        batch_op.drop_index("ix_finance_goal_contributions_workspace_date")

    op.drop_table("finance_goal_contributions")
    with op.batch_alter_table("finance_budget_periods", schema=None) as batch_op:
        batch_op.drop_index("ix_finance_budget_periods_workspace_budget")

    op.drop_table("finance_budget_periods")
    with op.batch_alter_table("finance_savings_goals", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_finance_savings_goals_workspace_id"))

    op.drop_table("finance_savings_goals")
    with op.batch_alter_table("finance_budgets", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_finance_budgets_workspace_id"))

    op.drop_table("finance_budgets")
    op.drop_table("finance_monthly_plans")
