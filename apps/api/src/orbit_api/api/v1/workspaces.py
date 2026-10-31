"""Workspaces the signed-in user can access."""

from typing import Any

from fastapi import APIRouter, HTTPException, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import AttachmentStoreDep, WorkspaceServiceDep
from orbit_api.schemas.workspaces import (
    CreateWorkspaceRequest,
    UpdateWorkspaceRequest,
    WorkspaceListResponse,
    WorkspaceResponse,
)
from orbit_api.services.workspaces.models import PersonalWorkspaceError

router = APIRouter(
    prefix="/workspaces",
    tags=["workspaces"],
    responses={401: {"description": "Not signed in."}},
)
NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"description": "The workspace does not exist or is not accessible."}
}


@router.get("", summary="List workspaces")
async def list_workspaces(
    user: CurrentUserDep, workspaces: WorkspaceServiceDep
) -> WorkspaceListResponse:
    items = await workspaces.list_for(user.id)
    return WorkspaceListResponse(workspaces=[WorkspaceResponse.of(item) for item in items])


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a workspace")
async def create_workspace(
    body: CreateWorkspaceRequest, user: CurrentUserDep, workspaces: WorkspaceServiceDep
) -> WorkspaceResponse:
    """Create a private workspace owned by the signed-in user."""
    return WorkspaceResponse.of(await workspaces.create(user.id, body.name))


@router.get("/{workspace_id}", summary="Get a workspace", responses=NOT_FOUND)
async def get_workspace(workspace: WorkspaceDep) -> WorkspaceResponse:
    return WorkspaceResponse.of(workspace)


@router.patch("/{workspace_id}", summary="Rename a workspace", responses=NOT_FOUND)
async def update_workspace(
    body: UpdateWorkspaceRequest,
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    workspaces: WorkspaceServiceDep,
) -> WorkspaceResponse:
    return WorkspaceResponse.of(await workspaces.rename(user.id, workspace.id, body.name))


@router.delete(
    "/{workspace_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a workspace",
    responses={
        **NOT_FOUND,
        409: {"description": "The personal workspace cannot be deleted."},
    },
)
async def delete_workspace(
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    workspaces: WorkspaceServiceDep,
    attachments: AttachmentStoreDep,
) -> Response:
    """Permanently delete a workspace and everything in it, including note attachment files."""
    try:
        await workspaces.delete(user.id, workspace.id)
    except PersonalWorkspaceError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Your personal workspace cannot be deleted."
        ) from None
    await attachments.delete_workspace(workspace.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
