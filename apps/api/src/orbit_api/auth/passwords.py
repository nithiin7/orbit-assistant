"""Password hashing with Argon2id (argon2-cffi, RFC 9106 parameters)."""

import secrets
from functools import cached_property

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


class Argon2PasswordHasher:
    def __init__(self, hasher: PasswordHasher | None = None) -> None:
        self._hasher = hasher or PasswordHasher()

    def hash(self, password: str) -> str:
        return self._hasher.hash(password)

    def verify(self, password_hash: str, password: str) -> bool:
        try:
            return self._hasher.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    def needs_rehash(self, password_hash: str) -> bool:
        return self._hasher.check_needs_rehash(password_hash)

    def verify_dummy(self, password: str) -> None:
        self.verify(self._dummy_hash, password)

    @cached_property
    def _dummy_hash(self) -> str:
        return self._hasher.hash(secrets.token_urlsafe(16))
