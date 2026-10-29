"""Workspaces. Every read is filtered by owner, so callers cannot reach other users' rows."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import WorkspaceModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.workspaces import Workspace


def _to_workspace(model: WorkspaceModel) -> Workspace:
    return Workspace(
        id=model.id,
        owner_id=model.owner_id,
        name=model.name,
        is_personal=model.is_personal,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlWorkspaceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, workspace: Workspace) -> None:
        self._session.add(
            WorkspaceModel(
                id=workspace.id,
                owner_id=workspace.owner_id,
                name=workspace.name,
                is_personal=workspace.is_personal,
                created_at=workspace.created_at,
                updated_at=workspace.updated_at,
            )
        )
        await flush(self._session)

    async def list_owned(self, owner_id: uuid.UUID) -> list[Workspace]:
        models = await self._session.scalars(
            select(WorkspaceModel)
            .where(WorkspaceModel.owner_id == owner_id)
            # The personal workspace first, then in creation order.
            .order_by(
                WorkspaceModel.is_personal.desc(), WorkspaceModel.created_at, WorkspaceModel.id
            )
        )
        return [_to_workspace(model) for model in models]

    async def get_owned(self, owner_id: uuid.UUID, workspace_id: uuid.UUID) -> Workspace | None:
        model = await self._session.scalar(
            select(WorkspaceModel).where(
                WorkspaceModel.id == workspace_id, WorkspaceModel.owner_id == owner_id
            )
        )
        return _to_workspace(model) if model else None

    async def rename(self, workspace_id: uuid.UUID, name: str) -> Workspace:
        model = await self._session.get_one(WorkspaceModel, workspace_id)
        model.name = name
        await flush(self._session)
        return _to_workspace(model)

    async def delete(self, workspace_id: uuid.UUID) -> None:
        await self._session.execute(delete(WorkspaceModel).where(WorkspaceModel.id == workspace_id))
