"""Reminders in a workspace. Every route authorizes the workspace through `WorkspaceDep` first."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import ReminderServiceDep
from orbit_api.schemas.reminders import (
    CreateReminderRequest,
    ReminderListParams,
    ReminderListResponse,
    ReminderResponse,
    UpcomingRemindersParams,
    UpcomingRemindersResponse,
    UpdateReminderRequest,
)
from orbit_api.services.reminders.models import (
    ReminderInPastError,
    ReminderManagedError,
    ReminderNotFoundError,
    ReminderTaskNotFoundError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/reminders",
    tags=["reminders"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or reminder does not exist or is not accessible."},
    },
)

ReminderId = Annotated[uuid.UUID, Path(description="The reminder's ID.")]

_INVALID_CHANGE: dict[int | str, dict[str, Any]] = {
    422: {
        "description": "Invalid input, a task outside this workspace, or a one-time reminder "
        "in the past."
    }
}


def reminder_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Reminder not found.")


def task_not_found() -> HTTPException:
    # The same answer whether the task doesn't exist or is in another workspace.
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT, "That task doesn't exist in this workspace."
    )


def managed() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        "This reminder follows a loan, subscription, or bill. Change its reminder in Finance.",
    )


_MANAGED: dict[int | str, dict[str, Any]] = {
    409: {"description": "The reminder is managed by a loan, subscription, or bill."}
}


def in_the_past() -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "That time has already passed. Choose a time in the future, or make it repeat.",
    )


@router.get("", summary="List reminders")
async def list_reminders(
    params: Annotated[ReminderListParams, Query()],
    workspace: WorkspaceDep,
    reminders: ReminderServiceDep,
) -> ReminderListResponse:
    """Soonest next occurrence first; reminders with nothing left to fire come last."""
    page = await reminders.find(workspace.id, params.to_query())
    return ReminderListResponse(
        reminders=[ReminderResponse.of(view) for view in page.reminders], total=page.total
    )


@router.post(
    "", status_code=status.HTTP_201_CREATED, summary="Create a reminder", responses=_INVALID_CHANGE
)
async def create_reminder(
    body: CreateReminderRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    reminders: ReminderServiceDep,
) -> ReminderResponse:
    try:
        view = await reminders.create(workspace.id, body.to_draft(), default_timezone=user.timezone)
    except ReminderTaskNotFoundError:
        raise task_not_found() from None
    except ReminderInPastError:
        raise in_the_past() from None
    return ReminderResponse.of(view)


@router.get("/upcoming", summary="List upcoming reminders")
async def upcoming_reminders(
    params: Annotated[UpcomingRemindersParams, Query()],
    workspace: WorkspaceDep,
    reminders: ReminderServiceDep,
) -> UpcomingRemindersResponse:
    """Enabled reminders by next occurrence, soonest first, including any that are due but not
    delivered yet. Reminders about completed tasks are left out."""
    views = await reminders.upcoming(workspace.id, params.limit)
    return UpcomingRemindersResponse(reminders=[ReminderResponse.of(view) for view in views])


@router.get("/{reminder_id}", summary="Get a reminder")
async def get_reminder(
    reminder_id: ReminderId, workspace: WorkspaceDep, reminders: ReminderServiceDep
) -> ReminderResponse:
    try:
        return ReminderResponse.of(await reminders.get(workspace.id, reminder_id))
    except ReminderNotFoundError:
        raise reminder_not_found() from None


@router.patch(
    "/{reminder_id}", summary="Update a reminder", responses={**_INVALID_CHANGE, **_MANAGED}
)
async def update_reminder(
    reminder_id: ReminderId,
    body: UpdateReminderRequest,
    workspace: WorkspaceDep,
    reminders: ReminderServiceDep,
) -> ReminderResponse:
    """Also enables and disables reminders (`enabled`). Changing the schedule or `enabled`
    replaces the next occurrence."""
    try:
        view = await reminders.update(workspace.id, reminder_id, body.to_changes())
    except ReminderNotFoundError:
        raise reminder_not_found() from None
    except ReminderManagedError:
        raise managed() from None
    except ReminderTaskNotFoundError:
        raise task_not_found() from None
    except ReminderInPastError:
        raise in_the_past() from None
    return ReminderResponse.of(view)


@router.delete(
    "/{reminder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a reminder",
    responses=_MANAGED,
)
async def delete_reminder(
    reminder_id: ReminderId, workspace: WorkspaceDep, reminders: ReminderServiceDep
) -> Response:
    """Permanently delete a reminder and its pending occurrences. Notifications it already
    delivered stay in the inbox."""
    try:
        await reminders.delete(workspace.id, reminder_id)
    except ReminderNotFoundError:
        raise reminder_not_found() from None
    except ReminderManagedError:
        raise managed() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
