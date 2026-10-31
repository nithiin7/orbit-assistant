"""Monthly plan models: planned against actual cash flow for one month in one currency.

Amounts are integers in the currency's minor unit and must be JSON integers.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, Strict

from orbit_api.schemas.finance import Month, Notes, TransactionDate, format_month
from orbit_api.services.finance.money import DEFAULT_CURRENCY, MAX_AMOUNT, Currency
from orbit_api.services.planning.models import (
    FixedCommitments,
    IncomeSource,
    Line,
    MonthlyPlan,
    PlanSummary,
    VariableBasis,
)

Income = Annotated[int, Strict(), Field(ge=0, le=MAX_AMOUNT, description="Minor units.")]


class PlanParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: Month | None = Field(
        default=None, description="`YYYY-MM` in your time zone. Defaults to the month of `today`."
    )
    currency: Currency = DEFAULT_CURRENCY
    today: TransactionDate | None = Field(
        default=None,
        description="Your local date. Defaults to today in your time zone preference, else UTC.",
    )


class LineResponse(BaseModel):
    planned: int | None = Field(description="`null` when nothing is planned for the line.")
    actual: int

    @classmethod
    def of(cls, line: Line) -> "LineResponse":
        return cls(planned=line.planned, actual=line.actual)


class FixedCommitmentsResponse(BaseModel):
    """Commitments due in the month: everything scheduled (except skipped) is planned; what
    was paid is actual. An EMI's principal is a transfer to the loan, not spending; only its
    interest is."""

    total: LineResponse
    emi: LineResponse
    rent: LineResponse = Field(description="Bills in the built-in Rent category.")
    subscriptions: LineResponse
    bills: LineResponse
    planned_interest: int

    @classmethod
    def of(cls, fixed: FixedCommitments) -> "FixedCommitmentsResponse":
        return cls(
            total=LineResponse.of(fixed.total),
            emi=LineResponse.of(fixed.emi),
            rent=LineResponse.of(fixed.rent),
            subscriptions=LineResponse.of(fixed.subscriptions),
            bills=LineResponse.of(fixed.bills),
            planned_interest=fixed.planned_interest,
        )


class FlowsResponse(BaseModel):
    invested: int = Field(description="Moved into investment accounts from other accounts.")
    divested: int = Field(description="Moved out of investment accounts to other accounts.")
    loan_principal: int = Field(description="Moved into loan accounts: principal repaid.")
    commitment_expenses: int = Field(
        description="Expenses paying subscriptions, bills, and EMI interest."
    )


class PlanResponse(BaseModel):
    month: str = Field(description="`YYYY-MM`.")
    currency: Currency
    expected_income: int | None
    income_source: IncomeSource | None = Field(
        description="`this_month` when entered for this month; `earlier` when carried from "
        "`income_month`."
    )
    income_month: str | None
    notes: str
    income: LineResponse
    fixed: FixedCommitmentsResponse
    variable: LineResponse = Field(
        description="Spending that pays no commitment. Planned from an overall budget (less the "
        "month's subscription, bill, and interest payments) or category budgets."
    )
    variable_basis: VariableBasis | None
    savings: LineResponse = Field(
        description="Planned: active goals' suggested monthly contributions. Actual: "
        "contributions minus withdrawals recorded this month."
    )
    investments: LineResponse = Field(
        description="Planned: SIPs due this month. Actual: money moved into investment accounts."
    )
    remaining: LineResponse = Field(
        description="Income minus every line above: available to spend (planned) or left over "
        "(actual)."
    )
    spending: int = Field(
        description="Consumption only: net expenses, including subscription, bill, and interest "
        "payments. Principal, savings, and investments aren't spending."
    )
    allocations: int = Field(
        description="Money moved to your own accounts: loan principal, net investments, and "
        "goal savings."
    )
    flows: FlowsResponse

    @classmethod
    def of(cls, summary: PlanSummary) -> "PlanResponse":
        plan = summary.plan
        flows = summary.flows
        return cls(
            month=format_month(summary.month),
            currency=summary.currency,
            expected_income=plan.expected_income if plan else None,
            income_source=summary.income_source,
            income_month=format_month(plan.month) if plan else None,
            notes=plan.notes if plan and summary.income_source == "this_month" else "",
            income=LineResponse.of(summary.income),
            fixed=FixedCommitmentsResponse.of(summary.fixed),
            variable=LineResponse.of(summary.variable),
            variable_basis=summary.variable_basis,
            savings=LineResponse.of(summary.savings),
            investments=LineResponse.of(summary.investments),
            remaining=LineResponse.of(summary.remaining),
            spending=summary.spending,
            allocations=summary.allocations,
            flows=FlowsResponse(
                invested=flows.invested,
                divested=flows.divested,
                loan_principal=flows.loan_principal,
                commitment_expenses=flows.commitment_expenses,
            ),
        )


class SetIncomeRequest(BaseModel):
    """A month's expected income. Later months without their own use it too."""

    model_config = ConfigDict(extra="forbid")

    currency: Currency = DEFAULT_CURRENCY
    expected_income: Income
    notes: Notes = ""


class MonthlyPlanResponse(BaseModel):
    month: str
    currency: Currency
    expected_income: int
    notes: str

    @classmethod
    def of(cls, plan: MonthlyPlan) -> "MonthlyPlanResponse":
        return cls(
            month=format_month(plan.month),
            currency=plan.currency,
            expected_income=plan.expected_income,
            notes=plan.notes,
        )
