"""Monthly financial planning in a workspace: expected income against commitments, budgets,
savings, and investments, compared with the ledger. Every route authorizes the workspace through
`WorkspaceDep` first. Routes log nothing about amounts."""

from typing import Annotated

from fastapi import APIRouter, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import PlanningServiceDep
from orbit_api.api.v1.commitments import local_today
from orbit_api.schemas.finance import Month, parse_month
from orbit_api.schemas.planning import (
    MonthlyPlanResponse,
    PlanParams,
    PlanResponse,
    SetIncomeRequest,
)
from orbit_api.services.finance.money import DEFAULT_CURRENCY, Currency

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance",
    tags=["finance planning"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace does not exist or is not accessible."},
    },
)

PlanMonth = Annotated[Month, Path(description="`YYYY-MM`.")]


@router.get("/plan", summary="A month's plan against actual cash flow")
async def get_plan(
    params: Annotated[PlanParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    planning: PlanningServiceDep,
) -> PlanResponse:
    """Income, fixed commitments, variable spending, savings, and investments, planned and
    actual, and what remains. Loan principal, savings, and investments are allocations, not
    spending."""
    today = local_today(user, params.today)
    month = parse_month(params.month) if params.month else today.replace(day=1)
    return PlanResponse.of(await planning.summary(workspace.id, params.currency, month, today))


@router.put("/plan/{month}", summary="Set a month's expected income")
async def set_plan(
    month: PlanMonth,
    body: SetIncomeRequest,
    workspace: WorkspaceDep,
    planning: PlanningServiceDep,
) -> MonthlyPlanResponse:
    """Later months without their own expected income use this one."""
    plan = await planning.set_income(
        workspace.id, body.currency, parse_month(month), body.expected_income, body.notes
    )
    return MonthlyPlanResponse.of(plan)


@router.delete(
    "/plan/{month}", status_code=status.HTTP_204_NO_CONTENT, summary="Clear a month's income"
)
async def clear_plan(
    month: PlanMonth,
    workspace: WorkspaceDep,
    planning: PlanningServiceDep,
    currency: Annotated[Currency, Query()] = DEFAULT_CURRENCY,
) -> Response:
    """The month falls back to an earlier month's expected income, if any. Idempotent."""
    await planning.clear_income(workspace.id, currency, parse_month(month))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
