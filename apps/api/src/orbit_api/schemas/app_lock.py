"""App lock models. PINs are accepted, never returned; device keys are never returned."""

import base64
import json
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from orbit_api.services.app_lock.models import (
    LOCK_AFTER_MAX_MINUTES,
    LOCK_AFTER_MIN_MINUTES,
    PIN_MAX_LENGTH,
    PIN_MIN_LENGTH,
    SIGN_OUT_AFTER_MAX_MINUTES,
    AppLockStatus,
    LockCredential,
)

_PIN_PATTERN = rf"^[0-9]{{{PIN_MIN_LENGTH},{PIN_MAX_LENGTH}}}$"
# A WebAuthn response is a few kilobytes at most.
_MAX_CREDENTIAL_JSON = 16_384


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


class AppLockDeviceResponse(BaseModel):
    id: uuid.UUID
    label: str = Field(description="The name given when the device was added.")
    credential_id: str = Field(
        description="The authenticator's credential ID (base64url), so a browser can tell "
        "whether it is one of its own."
    )
    created_at: datetime
    last_used_at: datetime | None

    @classmethod
    def of(cls, credential: LockCredential) -> "AppLockDeviceResponse":
        return cls(
            id=credential.id,
            label=credential.label,
            credential_id=_base64url(credential.credential_id),
            created_at=credential.created_at,
            last_used_at=credential.last_used_at,
        )


class AppLockStatusResponse(BaseModel):
    enabled: bool = Field(description="Whether app lock is on for this person.")
    locked: bool = Field(description="Whether this session is locked.")
    pin_length: int | None = Field(description="How many digits the PIN has, when it is on.")
    lock_after_minutes: int = Field(description="Idle minutes before the session locks.")
    sign_out_after_minutes: int | None = Field(
        description="Idle minutes before the session is signed out; `null` for never."
    )
    attempts_left: int = Field(description="Wrong PINs this session may enter before sign-out.")
    recently_signed_in: bool = Field(
        description="Whether this session signed in moments ago, so it may reset or turn off "
        "the lock without the current PIN."
    )
    devices: list[AppLockDeviceResponse]

    @classmethod
    def of(cls, status: AppLockStatus) -> "AppLockStatusResponse":
        return cls(
            enabled=status.enabled,
            locked=status.state == "locked",
            pin_length=status.pin_length,
            lock_after_minutes=status.timing.lock_after_minutes,
            sign_out_after_minutes=status.timing.sign_out_after_minutes,
            attempts_left=status.attempts_left,
            recently_signed_in=status.recently_signed_in,
            devices=[AppLockDeviceResponse.of(item) for item in status.credentials],
        )


class SetAppLockPinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str = Field(pattern=_PIN_PATTERN)
    current_pin: str | None = Field(
        default=None,
        pattern=_PIN_PATTERN,
        description="Needed to change an existing PIN, unless this session just signed in.",
    )


class AppLockTimingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lock_after_minutes: int = Field(ge=LOCK_AFTER_MIN_MINUTES, le=LOCK_AFTER_MAX_MINUTES)
    sign_out_after_minutes: int | None = Field(ge=1, le=SIGN_OUT_AFTER_MAX_MINUTES)


class DisableAppLockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_pin: str | None = Field(
        default=None,
        pattern=_PIN_PATTERN,
        description="Needed unless this session just signed in.",
    )


class UnlockWithPinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str = Field(pattern=_PIN_PATTERN)


def _small_credential(value: dict[str, Any]) -> dict[str, Any]:
    if len(json.dumps(value)) > _MAX_CREDENTIAL_JSON:
        raise ValueError("The device response is too large.")
    return value


class RegisterAppLockDeviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: dict[str, Any] = Field(description="The browser's new credential, as JSON.")
    label: str = Field(min_length=1, max_length=100)

    _check_credential = field_validator("credential")(_small_credential)


class UnlockWithDeviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: dict[str, Any] = Field(description="The browser's assertion, as JSON.")

    _check_credential = field_validator("credential")(_small_credential)


class AppLockDeviceOptionsResponse(BaseModel):
    options: dict[str, Any] = Field(
        description="WebAuthn options for `navigator.credentials` (binary values in base64url)."
    )
