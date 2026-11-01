"""Tasks in a workspace. Every route authorizes the workspace through `WorkspaceDep` first."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import TaskServiceDep
from orbit_api.schemas.tasks import (
    CreateTaskRequest,
    TaskListParams,
    TaskListResponse,
    TaskResponse,
    TaskSummaryParams,
    TaskSummaryResponse,
    UpdateTaskRequest,
)
from orbit_api.services.tasks.models import InvalidTaskScheduleError, TaskNotFoundError

router = APIRouter(
    prefix="/workspaces/{workspace_id}/tasks",
    tags=["tasks"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or task does not exist or is not accessible."},
    },
)

TaskId = Annotated[uuid.UUID, Path(description="The task's ID.")]


def task_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")


def invalid_schedule(exc: InvalidTaskScheduleError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))


@router.get("", summary="List tasks")
async def list_tasks(
    params: Annotated[TaskListParams, Query()], workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskListResponse:
    """Filter by status and priority, search titles and descriptions, and sort by due date,
    priority, or creation time."""
    page = await tasks.find(workspace.id, params.to_query())
    return TaskListResponse(tasks=[TaskResponse.of(task) for task in page.tasks], total=page.total)


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a task")
async def create_task(
    body: CreateTaskRequest, workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskResponse:
    try:
        return TaskResponse.of(await tasks.create(workspace.id, body.to_draft()))
    except InvalidTaskScheduleError as exc:
        raise invalid_schedule(exc) from None


@router.get("/summary", summary="Count tasks by state")
async def summarize_tasks(
    params: Annotated[TaskSummaryParams, Query()], workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskSummaryResponse:
    today = params.today or datetime.now(UTC).date()
    return TaskSummaryResponse.of(await tasks.summarize(workspace.id, today))


@router.get("/{task_id}", summary="Get a task")
async def get_task(task_id: TaskId, workspace: WorkspaceDep, tasks: TaskServiceDep) -> TaskResponse:
    try:
        return TaskResponse.of(await tasks.get(workspace.id, task_id))
    except TaskNotFoundError:
        raise task_not_found() from None


@router.patch("/{task_id}", summary="Update a task")
async def update_task(
    task_id: TaskId, body: UpdateTaskRequest, workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskResponse:
    try:
        return TaskResponse.of(await tasks.update(workspace.id, task_id, body.to_changes()))
    except TaskNotFoundError:
        raise task_not_found() from None
    except InvalidTaskScheduleError as exc:
        raise invalid_schedule(exc) from None


@router.post("/{task_id}/complete", summary="Complete a task")
async def complete_task(
    task_id: TaskId, workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskResponse:
    """Idempotent: completing a completed task keeps its original completion time."""
    try:
        return TaskResponse.of(await tasks.complete(workspace.id, task_id))
    except TaskNotFoundError:
        raise task_not_found() from None


@router.post("/{task_id}/reopen", summary="Reopen a task")
async def reopen_task(
    task_id: TaskId, workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskResponse:
    try:
        return TaskResponse.of(await tasks.reopen(workspace.id, task_id))
    except TaskNotFoundError:
        raise task_not_found() from None


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a task")
async def delete_task(task_id: TaskId, workspace: WorkspaceDep, tasks: TaskServiceDep) -> Response:
    """Permanently delete a task."""
    try:
        await tasks.delete(workspace.id, task_id)
    except TaskNotFoundError:
        raise task_not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
