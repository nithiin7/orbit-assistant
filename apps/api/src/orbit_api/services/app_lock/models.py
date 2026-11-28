"""App lock types and rules."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final, Literal, Protocol

PIN_MIN_LENGTH: Final = 4
PIN_MAX_LENGTH: Final = 8
LOCK_AFTER_MIN_MINUTES: Final = 1
LOCK_AFTER_MAX_MINUTES: Final = 24 * 60
SIGN_OUT_AFTER_MAX_MINUTES: Final = 30 * 24 * 60
DEFAULT_LOCK_AFTER_MINUTES: Final = 5
# Wrong PINs (or current PINs) a session may enter before it is signed out.
MAX_PIN_ATTEMPTS: Final = 5
# A session this new may reset or turn off the lock without the PIN: signing in again with the
# account password is how someone who forgot their PIN gets back in.
RECENT_SIGN_IN: Final = timedelta(minutes=10)
# The browser reports activity at most every 15 seconds; don't lock a session for that delay.
IDLE_GRACE: Final = timedelta(seconds=20)
CHALLENGE_TTL: Final = timedelta(minutes=2)
# Lock state of sessions unused for this long is forgotten.
SESSION_RETENTION: Final = timedelta(days=30)
MAX_DEVICES: Final = 10

SessionState = Literal["unlocked", "locked", "ended"]


@dataclass(frozen=True, slots=True)
class LockSettings:
    user_id: uuid.UUID
    pin_hash: str
    pin_length: int
    lock_after_minutes: int
    sign_out_after_minutes: int | None


@dataclass(frozen=True, slots=True)
class LockTiming:
    lock_after_minutes: int
    sign_out_after_minutes: int | None


@dataclass(frozen=True, slots=True)
class LockCredential:
    id: uuid.UUID
    user_id: uuid.UUID
    credential_id: bytes
    public_key: bytes
    sign_count: int
    rp_id: str
    label: str
    created_at: datetime
    last_used_at: datetime | None


@dataclass(slots=True)
class LockSession:
    session_key: str
    user_id: uuid.UUID
    created_at: datetime
    last_active_at: datetime
    locked_at: datetime | None = None
    ended_at: datetime | None = None
    failed_attempts: int = 0
    challenge: bytes | None = None
    challenge_expires_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class SignedInSession:
    """Who is calling, and which of their sign-in sessions (a browser) the call came from."""

    user_id: uuid.UUID
    # A digest identifying the session; never the token itself.
    session_key: str
    # When the person signed in with their password, if known.
    signed_in_at: datetime | None


@dataclass(frozen=True, slots=True)
class AppLockStatus:
    enabled: bool
    state: SessionState
    pin_length: int | None
    timing: LockTiming
    attempts_left: int
    recently_signed_in: bool
    credentials: list[LockCredential]


@dataclass(frozen=True, slots=True)
class RegisteredKey:
    credential_id: bytes
    public_key: bytes
    sign_count: int


@dataclass(frozen=True, slots=True)
class RelyingParty:
    """The web address Orbit is opened from: WebAuthn keys belong to its host name."""

    id: str
    origin: str


class AppLockNotEnabledError(Exception):
    pass


class CurrentPinRequiredError(Exception):
    """Changing or turning off the lock needs the current PIN."""


class IncorrectPinError(Exception):
    def __init__(self, attempts_left: int) -> None:
        super().__init__("Incorrect PIN.")
        self.attempts_left = attempts_left


class SessionEndedError(Exception):
    """The session was signed out: idle too long, or too many wrong PINs."""


class InvalidDeviceResponseError(Exception):
    """The browser's Touch ID or Windows Hello response didn't verify."""


class DeviceLimitError(Exception):
    pass


class LockCredentialNotFoundError(Exception):
    pass


class DeviceAuthenticator(Protocol):
    """WebAuthn ceremonies. Options are JSON objects for the browser; responses are the
    browser's credentials as JSON. Verification raises `InvalidDeviceResponseError`."""

    def registration_options(
        self,
        *,
        party: RelyingParty,
        user_id: uuid.UUID,
        user_name: str,
        display_name: str,
        challenge: bytes,
        exclude: list[bytes],
    ) -> dict[str, Any]: ...

    def verify_registration(
        self, *, credential: dict[str, Any], challenge: bytes, party: RelyingParty
    ) -> RegisteredKey: ...

    def authentication_options(
        self, *, party: RelyingParty, challenge: bytes, allow: list[bytes]
    ) -> dict[str, Any]: ...

    def credential_id(self, credential: dict[str, Any]) -> bytes: ...

    def verify_authentication(
        self,
        *,
        credential: dict[str, Any],
        challenge: bytes,
        party: RelyingParty,
        public_key: bytes,
        sign_count: int,
    ) -> int:
        """Verify the assertion and return the authenticator's new signature count."""
        ...


def check_pin(pin: str) -> None:
    if not (PIN_MIN_LENGTH <= len(pin) <= PIN_MAX_LENGTH and pin.isascii() and pin.isdigit()):
        raise ValueError(f"A PIN is {PIN_MIN_LENGTH} to {PIN_MAX_LENGTH} digits.")


def check_timing(timing: LockTiming) -> None:
    if not LOCK_AFTER_MIN_MINUTES <= timing.lock_after_minutes <= LOCK_AFTER_MAX_MINUTES:
        raise ValueError("Lock after must be between 1 minute and 24 hours.")
    sign_out = timing.sign_out_after_minutes
    if sign_out is not None and not (
        timing.lock_after_minutes < sign_out <= SIGN_OUT_AFTER_MAX_MINUTES
    ):
        raise ValueError("Sign out after must be longer than lock after, and at most 30 days.")


def session_state(settings: LockSettings, session: LockSession, now: datetime) -> SessionState:
    """Signed out once idle past the sign-out delay; locked once idle past the lock delay or
    locked on purpose. Unlocking resets idle time, so it can't revive a signed-out session."""
    if session.ended_at is not None:
        return "ended"
    idle = now - session.last_active_at
    sign_out = settings.sign_out_after_minutes
    if sign_out is not None and idle >= timedelta(minutes=sign_out):
        return "ended"
    if session.locked_at is not None or idle >= (
        timedelta(minutes=settings.lock_after_minutes) + IDLE_GRACE
    ):
        return "locked"
    return "unlocked"
