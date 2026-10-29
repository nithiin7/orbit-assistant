"""Workspaces and the ownership checks that authorize access to them."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol

from orbit_api.services.transactions import Transaction

PERSONAL_WORKSPACE_NAME = "Personal"

# Only owners exist until shared workspaces are designed.
WorkspaceRole = Literal["owner"]


@dataclass(frozen=True, slots=True)
class Workspace:
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    is_personal: bool
    created_at: datetime
    updated_at: datetime


class WorkspaceNotFoundError(Exception):
    """The workspace does not exist or the user may not access it. The two are deliberately
    indistinguishable, so responses never reveal other users' workspaces."""


class PersonalWorkspaceError(Exception):
    """The personal workspace cannot be deleted; every user keeps exactly one."""


class WorkspaceRepository(Protocol):
    async def add(self, workspace: Workspace) -> None: ...

    async def list_owned(self, owner_id: uuid.UUID) -> list[Workspace]: ...

    async def get_owned(self, owner_id: uuid.UUID, workspace_id: uuid.UUID) -> Workspace | None:
        """The workspace, only if `owner_id` owns it."""
        ...

    async def rename(self, workspace_id: uuid.UUID, name: str) -> Workspace: ...

    async def delete(self, workspace_id: uuid.UUID) -> None:
        """Delete the workspace; its data goes with it through `ON DELETE CASCADE`."""
        ...


def new_workspace(owner_id: uuid.UUID, name: str, *, is_personal: bool) -> Workspace:
    now = datetime.now(UTC)
    return Workspace(
        id=uuid.uuid4(),
        owner_id=owner_id,
        name=name,
        is_personal=is_personal,
        created_at=now,
        updated_at=now,
    )


class WorkspaceService:
    def __init__(self, workspaces: WorkspaceRepository, transaction: Transaction) -> None:
        self._workspaces = workspaces
        self._transaction = transaction

    async def list_for(self, user_id: uuid.UUID) -> list[Workspace]:
        return await self._workspaces.list_owned(user_id)

    async def authorize(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> Workspace:
        """Return the workspace if `user_id` may access it, else raise `WorkspaceNotFoundError`.

        Every workspace-scoped operation must pass through here (via the `WorkspaceDep` API
        dependency) before touching data. A workspace ID from a client is a selector, never
        proof of access.
        """
        workspace = await self._workspaces.get_owned(user_id, workspace_id)
        if workspace is None:
            raise WorkspaceNotFoundError
        return workspace

    async def create(self, user_id: uuid.UUID, name: str) -> Workspace:
        workspace = new_workspace(user_id, name, is_personal=False)
        await self._workspaces.add(workspace)
        await self._transaction.commit()
        return workspace

    async def rename(self, user_id: uuid.UUID, workspace_id: uuid.UUID, name: str) -> Workspace:
        await self.authorize(user_id, workspace_id)
        workspace = await self._workspaces.rename(workspace_id, name)
        await self._transaction.commit()
        return workspace

    async def delete(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
        workspace = await self.authorize(user_id, workspace_id)
        if workspace.is_personal:
            raise PersonalWorkspaceError
        await self._workspaces.delete(workspace_id)
        await self._transaction.commit()
