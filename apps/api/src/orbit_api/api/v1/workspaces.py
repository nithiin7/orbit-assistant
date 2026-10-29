"""Workspaces the signed-in user can access."""

from typing import Any

from fastapi import APIRouter, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import WorkspaceServiceDep
from orbit_api.schemas.workspaces import (
    CreateWorkspaceRequest,
    UpdateWorkspaceRequest,
    WorkspaceListResponse,
    WorkspaceResponse,
)

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
