"""Workspace models."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from orbit_api.schemas.common import Name
from orbit_api.services.workspaces import Workspace


class WorkspaceResponse(BaseModel):
    id: uuid.UUID
    name: str
    is_personal: bool = Field(description="The default workspace created with the account.")
    role: Literal["owner"] = Field(description="The signed-in user's role in the workspace.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, workspace: Workspace) -> "WorkspaceResponse":
        return cls(
            id=workspace.id,
            name=workspace.name,
            is_personal=workspace.is_personal,
            role="owner",
            created_at=workspace.created_at,
            updated_at=workspace.updated_at,
        )


class WorkspaceListResponse(BaseModel):
    workspaces: list[WorkspaceResponse] = Field(
        description="Workspaces the user can access, the personal workspace first."
    )


class CreateWorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class UpdateWorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
