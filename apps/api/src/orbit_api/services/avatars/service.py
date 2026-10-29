"""Profile photos. The web app resizes photos before upload; the API checks what it stores."""

import uuid
from datetime import UTC, datetime
from typing import Protocol

from orbit_api.services.avatars.models import (
    Avatar,
    AvatarContentType,
    AvatarTooLargeError,
    UnsupportedImageError,
)
from orbit_api.services.transactions import Transaction

# Far above a 256px photo (tens of KB), and small enough to store inline in the database.
MAX_AVATAR_BYTES = 512 * 1024


class AvatarRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> Avatar | None: ...

    async def put(self, user_id: uuid.UUID, avatar: Avatar) -> None: ...

    async def delete(self, user_id: uuid.UUID) -> None: ...


def detect_image_type(data: bytes) -> AvatarContentType | None:
    """The image format from the file's signature. The declared content type is not trusted;
    in particular SVG, which can carry scripts, is never accepted."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class AvatarService:
    def __init__(self, avatars: AvatarRepository, transaction: Transaction) -> None:
        self._avatars = avatars
        self._transaction = transaction

    async def get(self, user_id: uuid.UUID) -> Avatar | None:
        return await self._avatars.get(user_id)

    async def replace(self, user_id: uuid.UUID, data: bytes) -> Avatar:
        if len(data) > MAX_AVATAR_BYTES:
            raise AvatarTooLargeError
        content_type = detect_image_type(data)
        if content_type is None:
            raise UnsupportedImageError
        avatar = Avatar(content_type=content_type, data=data, updated_at=datetime.now(UTC))
        await self._avatars.put(user_id, avatar)
        await self._transaction.commit()
        return avatar

    async def remove(self, user_id: uuid.UUID) -> None:
        await self._avatars.delete(user_id)
        await self._transaction.commit()
