"""The focus timer on tasks. Every route authorizes the workspace through `WorkspaceDep` first."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import FocusServiceDep
from orbit_api.schemas.focus import (
    FocusSessionResponse,
    FocusSummaryParams,
    FocusSummaryResponse,
    RecordFocusSessionRequest,
)
from orbit_api.services.focus.models import InvalidFocusSessionError
from orbit_api.services.tasks.models import TaskNotFoundError

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["tasks"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or task does not exist or is not accessible."},
    },
)

TaskId = Annotated[uuid.UUID, Path(description="The task's ID.")]


@router.post(
    "/tasks/{task_id}/focus-sessions",
    status_code=status.HTTP_201_CREATED,
    summary="Record a focus session",
)
async def record_focus_session(
    task_id: TaskId,
    body: RecordFocusSessionRequest,
    workspace: WorkspaceDep,
    focus: FocusServiceDep,
) -> FocusSessionResponse:
    """Record time spent on a task with the focus timer, once the session ends."""
    try:
        return FocusSessionResponse.of(await focus.record(workspace.id, task_id, body.to_draft()))
    except TaskNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.") from None
    except InvalidFocusSessionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None


@router.get("/focus/summary", summary="Summarize focus time")
async def summarize_focus(
    params: Annotated[FocusSummaryParams, Query()], workspace: WorkspaceDep, focus: FocusServiceDep
) -> FocusSummaryResponse:
    """Focus time today and on each task."""
    return FocusSummaryResponse.of(await focus.summary(workspace.id, params.today))
