"""Monthly plan types: planned against actual cash flow for one month in one currency.

A plan separates **cash flow** from **spending**. Everything that leaves the month's income is a
line (commitments, variable spending, savings, investments), but only expenses are spending:
loan principal, savings moves, and investment contributions move money between the user's own
accounts and are allocations, not consumption.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from orbit_api.services.finance.money import Currency

# Where the expected income came from: this month's plan, or the latest earlier one carried
# forward (so a steady salary is entered once).
IncomeSource = Literal["this_month", "earlier"]
# What planned variable spending is based on: an overall budget (less the month's expected
# commitment expenses, which it also covers), category budgets, or nothing.
VariableBasis = Literal["overall_budget", "category_budgets"]


@dataclass(frozen=True, slots=True)
class MonthlyPlan:
    """What the user expects for a month. Only income is entered; every other planned figure
    comes from commitments, budgets, goals, and SIPs."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    currency: Currency
    month: date
    expected_income: int
    notes: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class LedgerFlows:
    """One month's ledger movements that aren't plain income or spending, in one currency."""

    # Transfers into investment accounts from other accounts, and back out.
    invested: int
    divested: int
    # Transfers into loan accounts: EMI principal and prepayments.
    loan_principal: int
    # Expenses that record a subscription, bill, or EMI interest payment.
    commitment_expenses: int


@dataclass(frozen=True, slots=True)
class Line:
    # `None` when nothing is planned for the line (no income entered, no budget).
    planned: int | None
    actual: int


@dataclass(frozen=True, slots=True)
class FixedCommitments:
    emi: Line
    rent: Line
    subscriptions: Line
    bills: Line
    # Of the planned EMIs, the interest: the only part of an EMI that is spending.
    planned_interest: int

    @property
    def total(self) -> Line:
        lines = (self.emi, self.rent, self.subscriptions, self.bills)
        return Line(
            planned=sum(line.planned or 0 for line in lines),
            actual=sum(line.actual for line in lines),
        )


@dataclass(frozen=True, slots=True)
class PlanInputs:
    """Everything a month's plan is computed from."""

    currency: Currency
    month: date
    plan: MonthlyPlan | None
    expected_income_source: IncomeSource | None
    actual_income: int
    # Net expenses (expenses minus refunds): the month's consumption spending.
    net_spending: int
    flows: LedgerFlows
    fixed: FixedCommitments
    # An overall budget's available amount for the month, else the sum of category budgets'.
    overall_budget: int | None
    category_budgets: int | None
    planned_savings: int | None
    actual_savings: int
    planned_investments: int | None


@dataclass(frozen=True, slots=True)
class PlanSummary:
    currency: Currency
    month: date
    plan: MonthlyPlan | None
    income: Line
    income_source: IncomeSource | None
    fixed: FixedCommitments
    variable: Line
    variable_basis: VariableBasis | None
    savings: Line
    investments: Line
    # Income minus every outflow line: what is left to spend (planned) or was left (actual).
    remaining: Line
    # Consumption only: net expenses, including subscription, bill, and interest payments.
    spending: int
    # Money moved to the user's own accounts, never spending: loan principal, investments (net
    # of withdrawals), and goal savings.
    allocations: int
    flows: LedgerFlows
