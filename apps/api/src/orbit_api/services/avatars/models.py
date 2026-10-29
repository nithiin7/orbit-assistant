"""Profile photo types."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

AvatarContentType = Literal["image/png", "image/jpeg", "image/webp"]


@dataclass(frozen=True, slots=True)
class Avatar:
    content_type: AvatarContentType
    data: bytes
    updated_at: datetime


class UnsupportedImageError(Exception):
    """The upload is not a PNG, JPEG, or WebP image."""


class AvatarTooLargeError(Exception):
    pass
