"""App lock: after a set idle time, a signed-in session must be unlocked with the person's PIN or
a device authenticator (Touch ID, Windows Hello) before the API serves it again.

The lock is enforced here, per session, not by the browser: a locked session's requests are
refused until it unlocks, whatever the page does. Browsers report activity (input, not
background refreshes), and a session idle past the lock delay is locked even if the browser was
closed or asleep. Past the optional sign-out delay, or after too many wrong PINs, the session is
signed out for good.

PINs are stored only as Argon2id hashes. Device authenticators register a public key; unlocking
with one verifies a signature over a one-time challenge this session asked for.
"""

import secrets
import uuid
from datetime import datetime
from typing import Any, Protocol

from anyio import to_thread

from orbit_api.services.app_lock.models import (
    CHALLENGE_TTL,
    DEFAULT_LOCK_AFTER_MINUTES,
    MAX_DEVICES,
    MAX_PIN_ATTEMPTS,
    RECENT_SIGN_IN,
    SESSION_RETENTION,
    AppLockNotEnabledError,
    AppLockStatus,
    CurrentPinRequiredError,
    DeviceAuthenticator,
    DeviceLimitError,
    IncorrectPinError,
    InvalidDeviceResponseError,
    LockCredential,
    LockCredentialNotFoundError,
    LockSession,
    LockSettings,
    LockTiming,
    RegisteredKey,
    RelyingParty,
    SessionEndedError,
    SessionState,
    SignedInSession,
    check_pin,
    check_timing,
    session_state,
)
from orbit_api.services.local_auth.service import PasswordHasher
from orbit_api.services.transactions import ConflictError, Transaction

CHALLENGE_BYTES = 32


class AppLockRepository(Protocol):
    async def settings(self, user_id: uuid.UUID) -> LockSettings | None: ...

    async def save_settings(self, settings: LockSettings) -> None: ...

    async def delete_all(self, user_id: uuid.UUID) -> None:
        """Remove the person's settings, devices, and session lock state."""
        ...

    async def session(self, session_key: str) -> LockSession | None: ...

    async def add_session(self, session: LockSession) -> None: ...

    async def save_session(self, session: LockSession) -> None: ...

    async def delete_stale_sessions(self, user_id: uuid.UUID, before: datetime) -> None: ...

    async def credentials(self, user_id: uuid.UUID) -> list[LockCredential]: ...

    async def add_credential(
        self, user_id: uuid.UUID, key: RegisteredKey, rp_id: str, label: str, now: datetime
    ) -> None: ...

    async def find_credential(
        self, user_id: uuid.UUID, credential_id: bytes
    ) -> LockCredential | None: ...

    async def credential_used(self, id: uuid.UUID, sign_count: int, now: datetime) -> None: ...

    async def delete_credential(self, user_id: uuid.UUID, id: uuid.UUID) -> bool: ...


class AppLockService:
    def __init__(
        self,
        repository: AppLockRepository,
        transaction: Transaction,
        hasher: PasswordHasher,
        devices: DeviceAuthenticator,
    ) -> None:
        self._repository = repository
        self._transaction = transaction
        self._hasher = hasher
        self._devices = devices

    async def check(self, caller: SignedInSession, now: datetime) -> SessionState:
        """This session's lock state. A session seen for the first time is unlocked: it was
        just signed in with a password, or the lock was just turned on."""
        settings = await self._repository.settings(caller.user_id)
        if settings is None:
            return "unlocked"
        session = await self._repository.session(caller.session_key)
        if session is None:
            await self._start_session(caller, now)
            return "unlocked"
        if session.user_id != caller.user_id:  # Digests don't collide; fail closed regardless.
            return "ended"
        return session_state(settings, session, now)

    async def status(self, caller: SignedInSession, now: datetime) -> AppLockStatus:
        settings = await self._repository.settings(caller.user_id)
        recent = caller.signed_in_at is not None and now - caller.signed_in_at <= RECENT_SIGN_IN
        if settings is None:
            return AppLockStatus(
                enabled=False,
                state="unlocked",
                pin_length=None,
                timing=LockTiming(DEFAULT_LOCK_AFTER_MINUTES, None),
                attempts_left=MAX_PIN_ATTEMPTS,
                recently_signed_in=recent,
                credentials=[],
            )
        session = await self._repository.session(caller.session_key)
        return AppLockStatus(
            enabled=True,
            state=session_state(settings, session, now) if session else "unlocked",
            pin_length=settings.pin_length,
            timing=LockTiming(settings.lock_after_minutes, settings.sign_out_after_minutes),
            attempts_left=MAX_PIN_ATTEMPTS - (session.failed_attempts if session else 0),
            recently_signed_in=recent,
            credentials=await self._repository.credentials(caller.user_id),
        )

    async def set_pin(
        self, caller: SignedInSession, pin: str, current_pin: str | None, now: datetime
    ) -> AppLockStatus:
        """Turn the lock on with `pin`, or change the PIN (which needs the current one, unless
        this session signed in moments ago)."""
        check_pin(pin)
        settings = await self._repository.settings(caller.user_id)
        if settings is not None:
            await self._confirm_pin(caller, settings, current_pin, now)
        pin_hash = await to_thread.run_sync(self._hasher.hash, pin)
        await self._mark_active(caller, now)
        await self._repository.save_settings(
            LockSettings(
                user_id=caller.user_id,
                pin_hash=pin_hash,
                pin_length=len(pin),
                lock_after_minutes=settings.lock_after_minutes
                if settings
                else DEFAULT_LOCK_AFTER_MINUTES,
                sign_out_after_minutes=settings.sign_out_after_minutes if settings else None,
            )
        )
        await self._transaction.commit()
        return await self.status(caller, now)

    async def update_timing(
        self, caller: SignedInSession, timing: LockTiming, now: datetime
    ) -> AppLockStatus:
        check_timing(timing)
        settings = await self._require_settings(caller.user_id)
        await self._repository.save_settings(
            LockSettings(
                user_id=settings.user_id,
                pin_hash=settings.pin_hash,
                pin_length=settings.pin_length,
                lock_after_minutes=timing.lock_after_minutes,
                sign_out_after_minutes=timing.sign_out_after_minutes,
            )
        )
        await self._transaction.commit()
        return await self.status(caller, now)

    async def disable(
        self, caller: SignedInSession, current_pin: str | None, now: datetime
    ) -> AppLockStatus:
        settings = await self._require_settings(caller.user_id)
        await self._confirm_pin(caller, settings, current_pin, now)
        await self._repository.delete_all(caller.user_id)
        await self._transaction.commit()
        return await self.status(caller, now)

    async def lock(self, caller: SignedInSession, now: datetime) -> AppLockStatus:
        """Lock this session now. Does nothing when the lock is off."""
        if await self._repository.settings(caller.user_id) is not None:
            session = await self._session(caller, now)
            if session.locked_at is None:
                session.locked_at = now
                await self._repository.save_session(session)
                await self._transaction.commit()
        return await self.status(caller, now)

    async def record_activity(self, caller: SignedInSession, now: datetime) -> None:
        """The person used Orbit in this session; call only for unlocked sessions."""
        if await self._repository.settings(caller.user_id) is None:
            return
        session = await self._session(caller, now)
        session.last_active_at = now
        await self._repository.save_session(session)
        await self._transaction.commit()

    async def unlock_with_pin(
        self, caller: SignedInSession, pin: str, now: datetime
    ) -> AppLockStatus:
        settings = await self._require_settings(caller.user_id)
        await self._confirm_pin(caller, settings, pin, now, allow_recent=False)
        await self._unlock(caller, now)
        return await self.status(caller, now)

    async def registration_options(
        self,
        caller: SignedInSession,
        party: RelyingParty,
        user_name: str,
        display_name: str,
        now: datetime,
    ) -> dict[str, Any]:
        await self._require_settings(caller.user_id)
        credentials = await self._repository.credentials(caller.user_id)
        if len(credentials) >= MAX_DEVICES:
            raise DeviceLimitError
        challenge = await self._new_challenge(caller, now)
        return self._devices.registration_options(
            party=party,
            user_id=caller.user_id,
            user_name=user_name,
            display_name=display_name,
            challenge=challenge,
            exclude=[item.credential_id for item in credentials if item.rp_id == party.id],
        )

    async def register_device(
        self,
        caller: SignedInSession,
        party: RelyingParty,
        credential: dict[str, Any],
        label: str,
        now: datetime,
    ) -> AppLockStatus:
        await self._require_settings(caller.user_id)
        if len(await self._repository.credentials(caller.user_id)) >= MAX_DEVICES:
            raise DeviceLimitError
        challenge = await self._take_challenge(caller, now)
        key = self._devices.verify_registration(
            credential=credential, challenge=challenge, party=party
        )
        try:
            await self._repository.add_credential(caller.user_id, key, party.id, label, now)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise InvalidDeviceResponseError from None
        return await self.status(caller, now)

    async def remove_device(
        self, caller: SignedInSession, id: uuid.UUID, now: datetime
    ) -> AppLockStatus:
        if not await self._repository.delete_credential(caller.user_id, id):
            raise LockCredentialNotFoundError
        await self._transaction.commit()
        return await self.status(caller, now)

    async def unlock_options(
        self, caller: SignedInSession, party: RelyingParty, now: datetime
    ) -> dict[str, Any]:
        await self._require_settings(caller.user_id)
        await self._require_session(caller, now)
        credentials = await self._repository.credentials(caller.user_id)
        allow = [item.credential_id for item in credentials if item.rp_id == party.id]
        if not allow:
            raise LockCredentialNotFoundError
        challenge = await self._new_challenge(caller, now)
        return self._devices.authentication_options(party=party, challenge=challenge, allow=allow)

    async def unlock_with_device(
        self,
        caller: SignedInSession,
        party: RelyingParty,
        credential: dict[str, Any],
        now: datetime,
    ) -> AppLockStatus:
        await self._require_settings(caller.user_id)
        await self._require_session(caller, now)
        challenge = await self._take_challenge(caller, now)
        stored = await self._repository.find_credential(
            caller.user_id, self._devices.credential_id(credential)
        )
        if stored is None or stored.rp_id != party.id:
            raise InvalidDeviceResponseError
        sign_count = self._devices.verify_authentication(
            credential=credential,
            challenge=challenge,
            party=party,
            public_key=stored.public_key,
            sign_count=stored.sign_count,
        )
        await self._repository.credential_used(stored.id, sign_count, now)
        await self._unlock(caller, now)
        return await self.status(caller, now)

    async def _confirm_pin(
        self,
        caller: SignedInSession,
        settings: LockSettings,
        pin: str | None,
        now: datetime,
        *,
        allow_recent: bool = True,
    ) -> None:
        """Check `pin` against the person's PIN, counting failures against this session; past
        the limit, the session is signed out."""
        if pin is None:
            recent = caller.signed_in_at is not None and now - caller.signed_in_at <= RECENT_SIGN_IN
            if allow_recent and recent:
                return
            raise CurrentPinRequiredError
        session = await self._require_session(caller, now)
        if await to_thread.run_sync(self._hasher.verify, settings.pin_hash, pin):
            if session.failed_attempts:
                session.failed_attempts = 0
                await self._repository.save_session(session)
            return
        session.failed_attempts += 1
        if session.failed_attempts >= MAX_PIN_ATTEMPTS:
            session.ended_at = now
        await self._repository.save_session(session)
        await self._transaction.commit()
        if session.ended_at is not None:
            raise SessionEndedError
        raise IncorrectPinError(MAX_PIN_ATTEMPTS - session.failed_attempts)

    async def _unlock(self, caller: SignedInSession, now: datetime) -> None:
        session = await self._session(caller, now)
        session.locked_at = None
        session.failed_attempts = 0
        session.last_active_at = now
        await self._repository.save_session(session)
        await self._transaction.commit()

    async def _mark_active(self, caller: SignedInSession, now: datetime) -> None:
        session = await self._session(caller, now)
        session.locked_at = None
        session.last_active_at = now
        await self._repository.save_session(session)

    async def _require_settings(self, user_id: uuid.UUID) -> LockSettings:
        settings = await self._repository.settings(user_id)
        if settings is None:
            raise AppLockNotEnabledError
        return settings

    async def _require_session(self, caller: SignedInSession, now: datetime) -> LockSession:
        """This session, refusing one that was signed out."""
        session = await self._session(caller, now)
        settings = await self._repository.settings(caller.user_id)
        if settings is not None and session_state(settings, session, now) == "ended":
            raise SessionEndedError
        return session

    async def _session(self, caller: SignedInSession, now: datetime) -> LockSession:
        session = await self._repository.session(caller.session_key)
        if session is None:
            session = await self._start_session(caller, now)
        if session.user_id != caller.user_id:
            raise SessionEndedError
        return session

    async def _start_session(self, caller: SignedInSession, now: datetime) -> LockSession:
        session = LockSession(
            session_key=caller.session_key,
            user_id=caller.user_id,
            created_at=now,
            last_active_at=now,
        )
        try:
            await self._repository.delete_stale_sessions(caller.user_id, now - SESSION_RETENTION)
            await self._repository.add_session(session)
            await self._transaction.commit()
        except ConflictError:
            # Another request from this session got there first.
            await self._transaction.rollback()
            existing = await self._repository.session(caller.session_key)
            if existing is None:
                raise
            return existing
        return session

    async def _new_challenge(self, caller: SignedInSession, now: datetime) -> bytes:
        session = await self._session(caller, now)
        session.challenge = secrets.token_bytes(CHALLENGE_BYTES)
        session.challenge_expires_at = now + CHALLENGE_TTL
        await self._repository.save_session(session)
        await self._transaction.commit()
        return session.challenge

    async def _take_challenge(self, caller: SignedInSession, now: datetime) -> bytes:
        """This session's pending challenge, used up whether or not the response verifies."""
        session = await self._session(caller, now)
        challenge, expires_at = session.challenge, session.challenge_expires_at
        if challenge is None:
            raise InvalidDeviceResponseError
        session.challenge = None
        session.challenge_expires_at = None
        await self._repository.save_session(session)
        await self._transaction.commit()
        if expires_at is None or expires_at < now:
            raise InvalidDeviceResponseError
        return challenge
