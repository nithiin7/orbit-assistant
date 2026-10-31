"""User profile models."""

import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from orbit_api.schemas.common import Name, TimeZoneName
from orbit_api.services.accounts.models import User
from orbit_api.utils.changes import UNSET, Change


class UserProfile(BaseModel):
    """The signed-in user's profile."""

    id: uuid.UUID
    email: str
    display_name: str
    auth_provider: Literal["local", "supabase"] = Field(
        description="`local` (an account on this installation) or `supabase` (Supabase Auth)."
    )
    timezone: str | None = Field(
        description="The user's IANA time zone, used by default for new reminders; `null` "
        "until they choose one."
    )
    created_at: datetime

    @classmethod
    def of(cls, user: User) -> "UserProfile":
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            auth_provider=user.auth_provider,
            timezone=user.timezone,
            created_at=user.created_at,
        )


class UpdateProfileRequest(BaseModel):
    """Change some profile fields. Omitted fields keep their values; `timezone: null` clears
    the time zone preference."""

    model_config = ConfigDict(extra="forbid")

    display_name: Name | None = None
    timezone: TimeZoneName | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        if "display_name" in self.model_fields_set and self.display_name is None:
            raise ValueError("display_name cannot be null")
        return self

    @property
    def timezone_change(self) -> Change[str | None]:
        return self.timezone if "timezone" in self.model_fields_set else UNSET
