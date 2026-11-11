"""Profile and cover photos, always addressed by the owning user's ID."""

import uuid
from typing import cast

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import UserAvatarModel, UserCoverModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.avatars.models import Avatar, AvatarContentType

type ImageModel = type[UserAvatarModel] | type[UserCoverModel]


class SqlAvatarRepository:
    """One image per user in `model`'s table: the profile photo by default, or the cover."""

    def __init__(self, session: AsyncSession, model: ImageModel = UserAvatarModel) -> None:
        self._session = session
        self._model = model

    async def get(self, user_id: uuid.UUID) -> Avatar | None:
        model = await self._session.get(self._model, user_id)
        if model is None:
            return None
        return Avatar(
            # Guaranteed by the table's `content_type` check constraint.
            content_type=cast(AvatarContentType, model.content_type),
            data=model.data,
            updated_at=model.updated_at,
        )

    async def put(self, user_id: uuid.UUID, avatar: Avatar) -> None:
        model = await self._session.get(self._model, user_id)
        if model is None:
            self._session.add(
                self._model(
                    user_id=user_id,
                    content_type=avatar.content_type,
                    data=avatar.data,
                    updated_at=avatar.updated_at,
                )
            )
        else:
            model.content_type = avatar.content_type
            model.data = avatar.data
            model.updated_at = avatar.updated_at
        await flush(self._session)

    async def delete(self, user_id: uuid.UUID) -> None:
        await self._session.execute(delete(self._model).where(self._model.user_id == user_id))


class SqlCoverRepository(SqlAvatarRepository):
    """Cover photos, in `user_covers`."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, UserCoverModel)
