"""Savings goals in a workspace and their contributions. Every route authorizes the workspace
through `WorkspaceDep` first. Routes log nothing about goals or amounts."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import GoalServiceDep
from orbit_api.api.v1.commitments import local_today
from orbit_api.schemas.commitments import TodayParams
from orbit_api.schemas.goals import (
    ContributionListResponse,
    ContributionResponse,
    CreateContributionRequest,
    CreateGoalRequest,
    GoalListResponse,
    GoalResponse,
    UpdateGoalRequest,
)
from orbit_api.services.goals.models import (
    ContributionNotFoundError,
    GoalConflictError,
    GoalNotFoundError,
    InvalidGoalError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance",
    tags=["finance goals"],
    responses={
        401: {"description": "Not signed in."},
        404: {
            "description": "The workspace, goal, or contribution does not exist or is not "
            "accessible."
        },
    },
)

GoalId = Annotated[uuid.UUID, Path(description="The savings goal's ID.")]
ContributionId = Annotated[uuid.UUID, Path(description="The contribution's ID.")]

_RULES: dict[int | str, dict[str, Any]] = {
    409: {"description": "The transfer is already recorded, or the goal has history."},
    422: {
        "description": "Invalid input, or a rule broken: an account or transaction outside "
        "this workspace, a currency mismatch, an account that can't hold savings, or a "
        "withdrawal of more than was saved."
    },
}


def goal_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Savings goal not found.")


def _invalid(error: InvalidGoalError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message)


def _conflict(error: GoalConflictError) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, error.message)


@router.get("/savings-goals", summary="List savings goals")
async def list_goals(
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    goals: GoalServiceDep,
) -> GoalListResponse:
    views = await goals.views(workspace.id, local_today(user, params.today))
    return GoalListResponse(goals=[GoalResponse.of(view) for view in views])


@router.post(
    "/savings-goals",
    status_code=status.HTTP_201_CREATED,
    summary="Create a savings goal",
    responses=_RULES,
)
async def create_goal(
    body: CreateGoalRequest, workspace: WorkspaceDep, user: CurrentUserDep, goals: GoalServiceDep
) -> GoalResponse:
    try:
        view = await goals.create(workspace.id, body.to_draft(), local_today(user, None))
    except InvalidGoalError as error:
        raise _invalid(error) from None
    return GoalResponse.of(view)


@router.get("/savings-goals/{goal_id}", summary="Get a savings goal")
async def get_goal(
    goal_id: GoalId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    goals: GoalServiceDep,
) -> GoalResponse:
    try:
        return GoalResponse.of(
            await goals.view(workspace.id, goal_id, local_today(user, params.today))
        )
    except GoalNotFoundError:
        raise goal_not_found() from None


@router.patch("/savings-goals/{goal_id}", summary="Update a savings goal", responses=_RULES)
async def update_goal(
    goal_id: GoalId,
    body: UpdateGoalRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    goals: GoalServiceDep,
) -> GoalResponse:
    try:
        view = await goals.update(workspace.id, goal_id, body.to_changes(), local_today(user, None))
    except GoalNotFoundError:
        raise goal_not_found() from None
    except InvalidGoalError as error:
        raise _invalid(error) from None
    return GoalResponse.of(view)


@router.delete(
    "/savings-goals/{goal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a savings goal",
    responses=_RULES,
)
async def delete_goal(goal_id: GoalId, workspace: WorkspaceDep, goals: GoalServiceDep) -> Response:
    """Only a goal without contributions; cancel one with history instead."""
    try:
        await goals.delete(workspace.id, goal_id)
    except GoalNotFoundError:
        raise goal_not_found() from None
    except GoalConflictError as error:
        raise _conflict(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/savings-goals/{goal_id}/contributions", summary="List a goal's contributions")
async def list_contributions(
    goal_id: GoalId, workspace: WorkspaceDep, goals: GoalServiceDep
) -> ContributionListResponse:
    try:
        entries = await goals.contributions(workspace.id, goal_id)
    except GoalNotFoundError:
        raise goal_not_found() from None
    return ContributionListResponse(
        contributions=[ContributionResponse.of(entry) for entry in entries]
    )


@router.post(
    "/savings-goals/{goal_id}/contributions",
    status_code=status.HTTP_201_CREATED,
    summary="Record a contribution or withdrawal",
    responses=_RULES,
)
async def create_contribution(
    goal_id: GoalId,
    body: CreateContributionRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    goals: GoalServiceDep,
) -> ContributionResponse:
    """Never an expense: an allocation records no ledger row, and a transfer between your own
    accounts is neither income nor spending."""
    try:
        entry = await goals.contribute(
            workspace.id, goal_id, body.to_request(), local_today(user, None)
        )
    except GoalNotFoundError:
        raise goal_not_found() from None
    except InvalidGoalError as error:
        raise _invalid(error) from None
    except GoalConflictError as error:
        raise _conflict(error) from None
    return ContributionResponse.of(entry)


@router.delete(
    "/savings-goals/{goal_id}/contributions/{contribution_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Undo a contribution or withdrawal",
    responses=_RULES,
)
async def delete_contribution(
    goal_id: GoalId,
    contribution_id: ContributionId,
    workspace: WorkspaceDep,
    goals: GoalServiceDep,
    delete_transaction: Annotated[
        bool, Query(description="Also delete the transfer it recorded from the ledger.")
    ] = False,
) -> Response:
    try:
        await goals.undo(
            workspace.id, goal_id, contribution_id, delete_transaction=delete_transaction
        )
    except (GoalNotFoundError, ContributionNotFoundError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contribution not found.") from None
    except InvalidGoalError as error:
        raise _invalid(error) from None
    except GoalConflictError as error:
        raise _conflict(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
