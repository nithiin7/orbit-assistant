"""Local-mode credential and session types."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from orbit_api.services.accounts.models import User


@dataclass(frozen=True, slots=True)
class LocalCredential:
    user_id: uuid.UUID
    password_hash: str


@dataclass(frozen=True, slots=True)
class LocalSession:
    """A new session. `token` is shown to the client once and never stored."""

    token: str
    expires_at: datetime
    user: User


class RegistrationClosedError(Exception):
    """This installation does not accept new local accounts."""


class EmailAlreadyRegisteredError(Exception):
    pass


class InvalidCredentialsError(Exception):
    """Unknown email or wrong password. The two are deliberately indistinguishable."""
