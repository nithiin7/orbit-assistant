"""Profile photos, always addressed by the owning user's ID."""

import uuid
from typing import cast

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import UserAvatarModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.avatars.models import Avatar, AvatarContentType


class SqlAvatarRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: uuid.UUID) -> Avatar | None:
        model = await self._session.get(UserAvatarModel, user_id)
        if model is None:
            return None
        return Avatar(
            # Guaranteed by the `ck_user_avatars_content_type` constraint.
            content_type=cast(AvatarContentType, model.content_type),
            data=model.data,
            updated_at=model.updated_at,
        )

    async def put(self, user_id: uuid.UUID, avatar: Avatar) -> None:
        model = await self._session.get(UserAvatarModel, user_id)
        if model is None:
            self._session.add(
                UserAvatarModel(
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
        await self._session.execute(
            delete(UserAvatarModel).where(UserAvatarModel.user_id == user_id)
        )
