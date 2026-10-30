"""The monthly plan's arithmetic, pure and unit-tested in `tests/test_planning_math.py`.

    Income
    - fixed commitments   (EMIs, rent, subscriptions, bills: scheduled, and paid)
    - variable spending   (the budget for it, and spending that pays no commitment)
    - planned savings     (goals' suggested contributions, and contributions recorded)
    - investments         (SIPs due, and money moved into investment accounts)
    = remaining available money

The lines never overlap. Commitment payments are taken out of variable spending (they are
already in fixed commitments), goals can't be kept in investment accounts, and loan principal,
savings, and investments are transfers rather than spending.
"""

from orbit_api.services.planning.models import Line, PlanInputs, PlanSummary, VariableBasis


def _planned_variable(inputs: PlanInputs) -> tuple[int | None, VariableBasis | None]:
    """An overall budget caps all spending, including the month's subscription, bill, and
    interest payments, so those are taken out of it; category budgets are taken as they are."""
    if inputs.overall_budget is not None:
        fixed = inputs.fixed
        commitment_spending = (
            (fixed.rent.planned or 0)
            + (fixed.subscriptions.planned or 0)
            + (fixed.bills.planned or 0)
            + fixed.planned_interest
        )
        return max(inputs.overall_budget - commitment_spending, 0), "overall_budget"
    if inputs.category_budgets is not None:
        return inputs.category_budgets, "category_budgets"
    return None, None


def summarize(inputs: PlanInputs) -> PlanSummary:
    fixed = inputs.fixed.total
    variable_planned, basis = _planned_variable(inputs)
    variable = Line(
        planned=variable_planned,
        actual=max(inputs.net_spending - inputs.flows.commitment_expenses, 0),
    )
    savings = Line(planned=inputs.planned_savings, actual=inputs.actual_savings)
    investments = Line(planned=inputs.planned_investments, actual=inputs.flows.invested)
    expected = inputs.plan.expected_income if inputs.plan is not None else None
    outflows = (fixed, variable, savings, investments)
    remaining = Line(
        planned=None
        if expected is None
        else expected - sum(line.planned or 0 for line in outflows),
        actual=inputs.actual_income - sum(line.actual for line in outflows),
    )
    return PlanSummary(
        currency=inputs.currency,
        month=inputs.month,
        plan=inputs.plan,
        income=Line(planned=expected, actual=inputs.actual_income),
        income_source=inputs.expected_income_source,
        fixed=inputs.fixed,
        variable=variable,
        variable_basis=basis,
        savings=savings,
        investments=investments,
        remaining=remaining,
        spending=inputs.net_spending,
        allocations=inputs.flows.loan_principal
        + inputs.flows.invested
        - inputs.flows.divested
        + inputs.actual_savings,
        flows=inputs.flows,
    )
