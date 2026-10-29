"""Authentication models."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from orbit_api.schemas.common import Email, Name
from orbit_api.schemas.users import UserProfile

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


class LocalAuthConfig(BaseModel):
    provider: Literal["local"]
    registration_open: bool = Field(description="Whether a new local account can be created.")


class SupabaseAuthConfig(BaseModel):
    """Public Supabase settings the web app needs to sign users in. Contains no secrets."""

    provider: Literal["supabase"]
    supabase_url: str
    supabase_publishable_key: str


AuthConfigResponse = Annotated[
    LocalAuthConfig | SupabaseAuthConfig, Field(discriminator="provider")
]


class LocalSignUpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email
    password: Annotated[
        str, StringConstraints(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    ]
    display_name: Name


class LocalSignInRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # No format or policy checks here: they would reveal nothing useful and only add noise.
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=320)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


class LocalSessionResponse(BaseModel):
    access_token: str = Field(description="Send as `Authorization: Bearer <token>`.")
    token_type: Literal["bearer"]
    expires_at: datetime
    user: UserProfile
