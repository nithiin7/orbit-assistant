"""Budgets in a workspace: spending limits, their periods, the month overview, and history. Every
route authorizes the workspace through `WorkspaceDep` first.

Spending figures are personal data, so routes log nothing about them.
"""

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import BudgetServiceDep
from orbit_api.api.v1.commitments import local_today
from orbit_api.schemas.budgets import (
    BudgetDetailResponse,
    BudgetHistoryParams,
    BudgetHistoryResponse,
    BudgetListResponse,
    BudgetMonthParams,
    BudgetMonthResponse,
    BudgetResponse,
    CopyBudgetsRequest,
    CopyBudgetsResponse,
    CreateBudgetRequest,
    UpdateBudgetRequest,
)
from orbit_api.schemas.commitments import TodayParams
from orbit_api.schemas.finance import parse_month
from orbit_api.services.budgets.models import (
    BudgetConflictError,
    BudgetNotFoundError,
    BudgetView,
    InvalidBudgetError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance",
    tags=["finance budgets"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or budget does not exist or is not accessible."},
    },
)

BudgetId = Annotated[uuid.UUID, Path(description="The budget's ID.")]

_RULES: dict[int | str, dict[str, Any]] = {
    409: {
        "description": "Another active budget covers the same spending in an overlapping period."
    },
    422: {
        "description": "Invalid input, or a rule broken: a category outside this workspace or "
        "not an expense category, monthly dates that aren't whole months, rollover on a custom "
        "period, or a change to a finished period."
    },
}


def budget_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Budget not found.")


def _response(view: BudgetView) -> BudgetResponse:
    return BudgetResponse.of(view.budget, view.status, view.current)


def _month_of(month: str | None, today: date) -> date:
    return parse_month(month) if month is not None else today.replace(day=1)


@router.get("/budgets", summary="List budgets")
async def list_budgets(
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    budgets: BudgetServiceDep,
) -> BudgetListResponse:
    """Every budget with its current period's spending, remaining amount, and status."""
    views = await budgets.views(workspace.id, local_today(user, params.today))
    return BudgetListResponse(budgets=[_response(view) for view in views])


@router.post(
    "/budgets",
    status_code=status.HTTP_201_CREATED,
    summary="Create a budget",
    responses=_RULES,
)
async def create_budget(
    body: CreateBudgetRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    budgets: BudgetServiceDep,
) -> BudgetResponse:
    try:
        view = await budgets.create(workspace.id, body.to_draft(), local_today(user, None))
    except InvalidBudgetError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except BudgetConflictError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, error.message) from None
    return _response(view)


@router.get("/budgets/overview", summary="One month's budgets and spending")
async def budget_overview(
    params: Annotated[BudgetMonthParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    budgets: BudgetServiceDep,
) -> BudgetMonthResponse:
    """The month's total budget, spending, and each budget's period overlapping the month, with
    spending per category. Spending is the dashboard's net spending: transfers never count."""
    today = local_today(user, params.today)
    summary = await budgets.summary(
        workspace.id, params.currency, _month_of(params.month, today), today
    )
    return BudgetMonthResponse.of(summary, params.currency, today)


@router.get("/budgets/history", summary="Budget against spending per month")
async def budget_history(
    params: Annotated[BudgetHistoryParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    budgets: BudgetServiceDep,
) -> BudgetHistoryResponse:
    """The overview for each of `months` months ending at `month`. Past months use the amounts
    their budgets had then."""
    today = local_today(user, params.today)
    history = await budgets.history(
        workspace.id, params.currency, _month_of(params.month, today), params.months, today
    )
    return BudgetHistoryResponse(
        currency=params.currency,
        months=[BudgetMonthResponse.of(entry, params.currency, today) for entry in history],
    )


@router.post("/budgets/copy", summary="Copy a month's budgets", responses=_RULES)
async def copy_budgets(
    body: CopyBudgetsRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    budgets: BudgetServiceDep,
) -> CopyBudgetsResponse:
    """Copy `from_month`'s monthly budgets into `to_month` as one-month budgets with the amounts
    they had. Budgets that already cover `to_month` are skipped."""
    today = local_today(user, None)
    try:
        result = await budgets.copy_month(
            workspace.id, parse_month(body.from_month), parse_month(body.to_month), today
        )
    except InvalidBudgetError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    created = {budget.id for budget in result.created}
    views = [view for view in await budgets.views(workspace.id, today) if view.budget.id in created]
    return CopyBudgetsResponse(
        created=[_response(view) for view in views],
        skipped=[budget.id for budget in result.skipped],
    )


@router.get("/budgets/{budget_id}", summary="Get a budget with its periods")
async def get_budget(
    budget_id: BudgetId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    budgets: BudgetServiceDep,
) -> BudgetDetailResponse:
    try:
        detail = await budgets.detail(workspace.id, budget_id, local_today(user, params.today))
    except BudgetNotFoundError:
        raise budget_not_found() from None
    return BudgetDetailResponse.of(detail)


@router.patch("/budgets/{budget_id}", summary="Update a budget", responses=_RULES)
async def update_budget(
    budget_id: BudgetId,
    body: UpdateBudgetRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    budgets: BudgetServiceDep,
) -> BudgetResponse:
    """Changes apply from the current period on; finished periods keep their amounts."""
    try:
        view = await budgets.update(
            workspace.id, budget_id, body.to_changes(), local_today(user, None)
        )
    except BudgetNotFoundError:
        raise budget_not_found() from None
    except InvalidBudgetError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except BudgetConflictError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, error.message) from None
    return _response(view)


@router.post("/budgets/{budget_id}/archive", summary="Archive a budget")
async def archive_budget(
    budget_id: BudgetId, workspace: WorkspaceDep, user: CurrentUserDep, budgets: BudgetServiceDep
) -> BudgetResponse:
    """Stop tracking it and sending alerts; its history stays. Idempotent."""
    try:
        return _response(await budgets.archive(workspace.id, budget_id, local_today(user, None)))
    except BudgetNotFoundError:
        raise budget_not_found() from None


@router.post("/budgets/{budget_id}/restore", summary="Restore an archived budget", responses=_RULES)
async def restore_budget(
    budget_id: BudgetId, workspace: WorkspaceDep, user: CurrentUserDep, budgets: BudgetServiceDep
) -> BudgetResponse:
    try:
        return _response(await budgets.restore(workspace.id, budget_id, local_today(user, None)))
    except BudgetNotFoundError:
        raise budget_not_found() from None
    except BudgetConflictError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, error.message) from None


@router.delete(
    "/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a budget"
)
async def delete_budget(
    budget_id: BudgetId, workspace: WorkspaceDep, budgets: BudgetServiceDep
) -> Response:
    """Delete it with its period history. Transactions are untouched; notifications stay."""
    try:
        await budgets.delete(workspace.id, budget_id)
    except BudgetNotFoundError:
        raise budget_not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
