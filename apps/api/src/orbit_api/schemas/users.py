"""User profile models."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from orbit_api.schemas.common import Name
from orbit_api.services.accounts.models import User


class UserProfile(BaseModel):
    """The signed-in user's profile."""

    id: uuid.UUID
    email: str
    display_name: str
    auth_provider: Literal["local", "supabase"] = Field(
        description="`local` (an account on this installation) or `supabase` (Supabase Auth)."
    )
    created_at: datetime

    @classmethod
    def of(cls, user: User) -> "UserProfile":
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            auth_provider=user.auth_provider,
            created_at=user.created_at,
        )


class UpdateProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: Name
