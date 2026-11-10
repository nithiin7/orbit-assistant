"""Tasks in a workspace. Every route authorizes the workspace through `WorkspaceDep` first."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import TaskServiceDep
from orbit_api.schemas.tasks import (
    CreateTaskListRequest,
    CreateTaskRequest,
    TaskListDetailResponse,
    TaskListParams,
    TaskListResponse,
    TaskListsResponse,
    TaskResponse,
    TaskSummaryParams,
    TaskSummaryResponse,
    UpdateTaskListRequest,
    UpdateTaskRequest,
)
from orbit_api.services.tasks.models import (
    MAX_TASK_LISTS,
    InvalidTaskScheduleError,
    TaskListNameTakenError,
    TaskListNotFoundError,
    TaskNotFoundError,
    TooManyTaskListsError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/tasks",
    tags=["tasks"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or task does not exist or is not accessible."},
    },
)

lists_router = APIRouter(
    prefix="/workspaces/{workspace_id}/task-lists",
    tags=["tasks"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or list does not exist or is not accessible."},
    },
)

TaskId = Annotated[uuid.UUID, Path(description="The task's ID.")]
ListId = Annotated[uuid.UUID, Path(description="The list's ID.")]


def task_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")


def invalid_schedule(exc: InvalidTaskScheduleError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))


def unknown_list() -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT, "That list doesn't exist in this workspace."
    )


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
    except TaskListNotFoundError:
        raise unknown_list() from None


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
    except TaskListNotFoundError:
        raise unknown_list() from None


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


# Lists


def list_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "List not found.")


def list_name_taken() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "Another list already has that name.")


@lists_router.get("", summary="List task lists")
async def list_task_lists(workspace: WorkspaceDep, tasks: TaskServiceDep) -> TaskListsResponse:
    """The workspace's lists, oldest first, each with its number of open tasks."""
    overview = await tasks.lists(workspace.id)
    return TaskListsResponse(lists=[TaskListDetailResponse.of_overview(e) for e in overview])


@lists_router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a task list",
    responses={409: {"description": "The name is taken, or there are too many lists."}},
)
async def create_task_list(
    body: CreateTaskListRequest, workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskListDetailResponse:
    try:
        task_list = await tasks.create_list(workspace.id, body.name, body.color)
    except TaskListNameTakenError:
        raise list_name_taken() from None
    except TooManyTaskListsError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A workspace can have at most {MAX_TASK_LISTS} lists."
        ) from None
    return TaskListDetailResponse.of(task_list, open_tasks=0)


@lists_router.patch(
    "/{list_id}",
    summary="Rename or recolor a task list",
    responses={409: {"description": "The name is taken."}},
)
async def update_task_list(
    list_id: ListId, body: UpdateTaskListRequest, workspace: WorkspaceDep, tasks: TaskServiceDep
) -> TaskListDetailResponse:
    try:
        task_list = await tasks.update_list(workspace.id, list_id, body.to_changes())
    except TaskListNotFoundError:
        raise list_not_found() from None
    except TaskListNameTakenError:
        raise list_name_taken() from None
    overview = await tasks.lists(workspace.id)
    open_tasks = next((e.open for e in overview if e.task_list.id == task_list.id), 0)
    return TaskListDetailResponse.of(task_list, open_tasks)


@lists_router.delete(
    "/{list_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a task list"
)
async def delete_task_list(
    list_id: ListId, workspace: WorkspaceDep, tasks: TaskServiceDep
) -> Response:
    """Its tasks are kept, on no list."""
    try:
        await tasks.delete_list(workspace.id, list_id)
    except TaskListNotFoundError:
        raise list_not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
