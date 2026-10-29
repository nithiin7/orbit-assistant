"""Local-mode accounts: email and password sign-in with server-side sessions.

Passwords are stored only as Argon2id hashes. A session is an opaque random bearer token; the
database stores only its SHA-256 digest, so a copy of the database cannot be replayed as a
session. Sessions expire after a fixed lifetime and are deleted on sign-out.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from anyio import to_thread

from orbit_api.services.accounts import AccountRepository, AccountService, User
from orbit_api.services.transactions import ConflictError, Transaction

SESSION_TOKEN_BYTES = 32


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


class PasswordHasher(Protocol):
    def hash(self, password: str) -> str: ...

    def verify(self, password_hash: str, password: str) -> bool: ...

    def needs_rehash(self, password_hash: str) -> bool: ...

    def verify_dummy(self, password: str) -> None:
        """Spend the same time as `verify` on a fixed hash, to hide whether an email exists."""
        ...


class LocalAuthRepository(Protocol):
    async def find_credential(self, email: str) -> LocalCredential | None: ...

    async def add_credential(self, user_id: uuid.UUID, email: str, password_hash: str) -> None: ...

    async def update_password_hash(self, user_id: uuid.UUID, password_hash: str) -> None: ...

    async def add_session(
        self, user_id: uuid.UUID, token_hash: str, created_at: datetime, expires_at: datetime
    ) -> None: ...

    async def find_session_user(self, token_hash: str, now: datetime) -> User | None:
        """The user of an unexpired session with this token digest."""
        ...

    async def delete_session(self, token_hash: str) -> None: ...

    async def delete_expired_sessions(self, user_id: uuid.UUID, now: datetime) -> None: ...


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LocalAuthService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        credentials: LocalAuthRepository,
        account_service: AccountService,
        transaction: Transaction,
        hasher: PasswordHasher,
        session_ttl: timedelta,
        open_registration: bool,
    ) -> None:
        self._accounts = accounts
        self._credentials = credentials
        self._account_service = account_service
        self._transaction = transaction
        self._hasher = hasher
        self._session_ttl = session_ttl
        self._open_registration = open_registration

    async def registration_open(self) -> bool:
        """Only the first account may register, unless open registration is configured."""
        return self._open_registration or await self._accounts.count("local") == 0

    async def sign_up(self, *, email: str, password: str, display_name: str) -> LocalSession:
        """Create an account with its personal workspace, and sign it in. `email` must already
        be normalized (trimmed and lowercase)."""
        if not await self.registration_open():
            raise RegistrationClosedError
        if await self._credentials.find_credential(email) is not None:
            raise EmailAlreadyRegisteredError

        # Argon2 is deliberately CPU-heavy; keep it off the event loop.
        password_hash = await to_thread.run_sync(self._hasher.hash, password)
        try:
            user = await self._account_service.onboard(
                provider="local", subject=None, email=email, display_name=display_name
            )
            await self._credentials.add_credential(user.id, email, password_hash)
            session = await self._start_session(user)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise EmailAlreadyRegisteredError from None
        return session

    async def sign_in(self, *, email: str, password: str) -> LocalSession:
        credential = await self._credentials.find_credential(email)
        if credential is None:
            await to_thread.run_sync(self._hasher.verify_dummy, password)
            raise InvalidCredentialsError
        if not await to_thread.run_sync(self._hasher.verify, credential.password_hash, password):
            raise InvalidCredentialsError

        user = await self._accounts.get(credential.user_id)
        if user is None:  # Prevented by the foreign key; fail closed regardless.
            raise InvalidCredentialsError
        if self._hasher.needs_rehash(credential.password_hash):
            new_hash = await to_thread.run_sync(self._hasher.hash, password)
            await self._credentials.update_password_hash(user.id, new_hash)
        await self._credentials.delete_expired_sessions(user.id, datetime.now(UTC))
        session = await self._start_session(user)
        await self._transaction.commit()
        return session

    async def authenticate(self, token: str) -> User | None:
        """The user of a valid, unexpired session token, or `None`."""
        return await self._credentials.find_session_user(
            hash_session_token(token), datetime.now(UTC)
        )

    async def sign_out(self, token: str) -> None:
        await self._credentials.delete_session(hash_session_token(token))
        await self._transaction.commit()

    async def _start_session(self, user: User) -> LocalSession:
        token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
        now = datetime.now(UTC)
        expires_at = now + self._session_ttl
        await self._credentials.add_session(user.id, hash_session_token(token), now, expires_at)
        return LocalSession(token=token, expires_at=expires_at, user=user)
