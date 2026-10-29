"""User profile types, shared by local and Supabase authentication."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

AuthProvider = Literal["local", "supabase"]


@dataclass(frozen=True, slots=True)
class User:
    id: uuid.UUID
    auth_provider: AuthProvider
    email: str
    display_name: str
    created_at: datetime
    # An IANA time zone name; `None` until the user chooses one.
    timezone: str | None = None


@dataclass(frozen=True, slots=True)
class ExternalIdentity:
    """A user identity asserted by a verified Supabase access token."""

    subject: str
    email: str
    display_name: str | None
