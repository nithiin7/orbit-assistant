"""The monthly plan's arithmetic: lines, the variable budget, and what remains."""

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime
from typing import Any

from orbit_api.services.planning.calculation import summarize
from orbit_api.services.planning.models import (
    FixedCommitments,
    LedgerFlows,
    Line,
    MonthlyPlan,
    PlanInputs,
)

MONTH = date(2026, 3, 1)


def plan(income: int) -> MonthlyPlan:
    now = datetime(2026, 3, 1, tzinfo=UTC)
    return MonthlyPlan(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        currency="INR",
        month=MONTH,
        expected_income=income,
        notes="",
        created_at=now,
        updated_at=now,
    )


BASE = PlanInputs(
    currency="INR",
    month=MONTH,
    plan=plan(1_00_000_00),
    expected_income_source="this_month",
    actual_income=1_00_000_00,
    # ₹40,000 spent: ₹15,000 of it paid the rent bill, a subscription, and EMI interest.
    net_spending=40_000_00,
    flows=LedgerFlows(
        invested=10_000_00,
        divested=2_000_00,
        loan_principal=8_000_00,
        commitment_expenses=15_000_00,
    ),
    fixed=FixedCommitments(
        emi=Line(planned=10_000_00, actual=10_000_00),
        rent=Line(planned=12_000_00, actual=12_000_00),
        subscriptions=Line(planned=1_000_00, actual=1_000_00),
        bills=Line(planned=3_000_00, actual=0),
        planned_interest=2_000_00,
    ),
    overall_budget=50_000_00,
    category_budgets=None,
    planned_savings=5_000_00,
    actual_savings=4_000_00,
    planned_investments=10_000_00,
)


def inputs(**overrides: Any) -> PlanInputs:
    return replace(BASE, **overrides)


def test_fixed_commitments_add_up_their_lines() -> None:
    summary = summarize(inputs())
    assert summary.fixed.total == Line(planned=26_000_00, actual=23_000_00)


def test_an_overall_budget_leaves_out_the_commitment_spending_it_already_covers() -> None:
    summary = summarize(inputs())
    # ₹50,000 - (rent 12,000 + subscriptions 1,000 + bills 3,000 + interest 2,000) = ₹32,000.
    assert summary.variable == Line(planned=32_000_00, actual=25_000_00)
    assert summary.variable_basis == "overall_budget"


def test_category_budgets_plan_variable_spending_as_they_are() -> None:
    summary = summarize(inputs(overall_budget=None, category_budgets=20_000_00))
    assert summary.variable.planned == 20_000_00
    assert summary.variable_basis == "category_budgets"
    unplanned = summarize(inputs(overall_budget=None))
    assert unplanned.variable.planned is None
    assert unplanned.variable_basis is None


def test_remaining_is_income_less_every_line_without_double_counting() -> None:
    summary = summarize(inputs())
    # Planned: 1,00,000 - (26,000 + 32,000 + 5,000 + 10,000) = 27,000.
    assert summary.remaining.planned == 27_000_00
    # Actual: 1,00,000 - (23,000 + 25,000 + 4,000 + 10,000) = 38,000.
    assert summary.remaining.actual == 38_000_00


def test_spending_and_allocations_are_kept_apart() -> None:
    summary = summarize(inputs())
    # Spending is consumption only; principal, net investments, and savings are allocations.
    assert summary.spending == 40_000_00
    assert summary.allocations == 8_000_00 + 10_000_00 - 2_000_00 + 4_000_00


def test_without_expected_income_nothing_remaining_is_planned() -> None:
    summary = summarize(inputs(plan=None, expected_income_source=None))
    assert summary.income == Line(planned=None, actual=1_00_000_00)
    assert summary.remaining.planned is None


def test_variable_spending_never_goes_below_zero() -> None:
    summary = summarize(inputs(net_spending=1_000_00, overall_budget=5_000_00))
    assert summary.variable == Line(planned=0, actual=0)
