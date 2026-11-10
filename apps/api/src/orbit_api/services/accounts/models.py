"""User profile types, shared by local and Supabase authentication."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

AuthProvider = Literal["local", "supabase"]
# `pending` until the user opens the setup guide, `deferred` once they leave it for later, and
# `done` once they finish or dismiss it.
SetupStatus = Literal["pending", "deferred", "done"]


@dataclass(frozen=True, slots=True)
class User:
    id: uuid.UUID
    auth_provider: AuthProvider
    email: str
    display_name: str
    created_at: datetime
    # An IANA time zone name; `None` until the user chooses one.
    timezone: str | None = None
    setup_status: SetupStatus = "pending"


@dataclass(frozen=True, slots=True)
class ExternalIdentity:
    """A user identity asserted by a verified Supabase access token."""

    subject: str
    email: str
    display_name: str | None
