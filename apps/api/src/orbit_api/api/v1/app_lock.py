"""App lock: the signed-in person's PIN and devices, and locking and unlocking this session.

Routes that a locked session needs (status, lock, unlock) take `CallerDep`; the rest need an
unlocked session, like every other route.
"""

import uuid
from typing import NoReturn
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response, status

from orbit_api.api.auth import CallerDep, UnlockedCallerDep, unauthenticated
from orbit_api.api.dependencies import AppLockServiceDep, SettingsDep
from orbit_api.db.columns import utc_now
from orbit_api.schemas.app_lock import (
    AppLockDeviceOptionsResponse,
    AppLockStatusResponse,
    AppLockTimingRequest,
    DisableAppLockRequest,
    RegisterAppLockDeviceRequest,
    SetAppLockPinRequest,
    UnlockWithDeviceRequest,
    UnlockWithPinRequest,
)
from orbit_api.services.app_lock.models import (
    MAX_DEVICES,
    AppLockNotEnabledError,
    CurrentPinRequiredError,
    DeviceLimitError,
    IncorrectPinError,
    InvalidDeviceResponseError,
    LockCredentialNotFoundError,
    LockTiming,
    RelyingParty,
    SessionEndedError,
)

router = APIRouter(
    prefix="/me/app-lock",
    tags=["app lock"],
    responses={
        401: {"description": "Not signed in, or signed out by app lock."},
        423: {"description": "This session is locked."},
    },
)

_NOT_ENABLED = "App lock is off."
_PIN_RESPONSES: dict[int | str, dict[str, str]] = {
    409: {"description": _NOT_ENABLED},
    422: {"description": "The PIN is wrong or missing; the detail says how many tries are left."},
}
_DEVICE_RESPONSES: dict[int | str, dict[str, str]] = {
    409: {"description": _NOT_ENABLED},
    422: {"description": "The device's response didn't verify, or Orbit's address is unknown."},
}


@router.get("", summary="Get app lock settings and this session's lock state")
async def get_app_lock(caller: CallerDep, app_lock: AppLockServiceDep) -> AppLockStatusResponse:
    return AppLockStatusResponse.of(await app_lock.status(caller.session, utc_now()))


@router.put(
    "/pin", summary="Turn app lock on with a PIN, or change the PIN", responses=_PIN_RESPONSES
)
async def set_app_lock_pin(
    body: SetAppLockPinRequest, caller: UnlockedCallerDep, app_lock: AppLockServiceDep
) -> AppLockStatusResponse:
    try:
        result = await app_lock.set_pin(caller.session, body.pin, body.current_pin, utc_now())
    except (CurrentPinRequiredError, IncorrectPinError, SessionEndedError) as exc:
        _pin_error(exc)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return AppLockStatusResponse.of(result)


@router.put(
    "/timing",
    summary="Choose how soon Orbit locks and signs out when idle",
    responses={409: {"description": _NOT_ENABLED}},
)
async def update_app_lock_timing(
    body: AppLockTimingRequest, caller: UnlockedCallerDep, app_lock: AppLockServiceDep
) -> AppLockStatusResponse:
    timing = LockTiming(body.lock_after_minutes, body.sign_out_after_minutes)
    try:
        result = await app_lock.update_timing(caller.session, timing, utc_now())
    except AppLockNotEnabledError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, _NOT_ENABLED) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return AppLockStatusResponse.of(result)


@router.post("/disable", summary="Turn app lock off", responses=_PIN_RESPONSES)
async def disable_app_lock(
    body: DisableAppLockRequest, caller: UnlockedCallerDep, app_lock: AppLockServiceDep
) -> AppLockStatusResponse:
    try:
        result = await app_lock.disable(caller.session, body.current_pin, utc_now())
    except AppLockNotEnabledError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, _NOT_ENABLED) from exc
    except (CurrentPinRequiredError, IncorrectPinError, SessionEndedError) as exc:
        _pin_error(exc)
    return AppLockStatusResponse.of(result)


@router.post("/lock", summary="Lock this session now")
async def lock_app(caller: CallerDep, app_lock: AppLockServiceDep) -> AppLockStatusResponse:
    return AppLockStatusResponse.of(await app_lock.lock(caller.session, utc_now()))


@router.post(
    "/activity",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Report that the person is using Orbit in this session",
)
async def record_app_lock_activity(
    caller: UnlockedCallerDep, app_lock: AppLockServiceDep
) -> Response:
    await app_lock.record_activity(caller.session, utc_now())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/unlock", summary="Unlock this session with the PIN", responses=_PIN_RESPONSES)
async def unlock_with_pin(
    body: UnlockWithPinRequest, caller: CallerDep, app_lock: AppLockServiceDep
) -> AppLockStatusResponse:
    try:
        result = await app_lock.unlock_with_pin(caller.session, body.pin, utc_now())
    except AppLockNotEnabledError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, _NOT_ENABLED) from exc
    except (CurrentPinRequiredError, IncorrectPinError, SessionEndedError) as exc:
        _pin_error(exc)
    return AppLockStatusResponse.of(result)


@router.post(
    "/devices/options",
    summary="Start adding this device's Touch ID or Windows Hello",
    responses={
        **_DEVICE_RESPONSES,
        409: {"description": f"App lock is off, or {MAX_DEVICES} devices were added already."},
    },
)
async def app_lock_device_options(
    request: Request,
    caller: UnlockedCallerDep,
    app_lock: AppLockServiceDep,
    settings: SettingsDep,
) -> AppLockDeviceOptionsResponse:
    party = _party(request, settings.cors_origins)
    try:
        options = await app_lock.registration_options(
            caller.session,
            party,
            user_name=caller.user.email,
            display_name=caller.user.display_name,
            now=utc_now(),
        )
    except (AppLockNotEnabledError, DeviceLimitError) as exc:
        _device_error(exc)
    return AppLockDeviceOptionsResponse(options=options)


@router.post(
    "/devices",
    summary="Finish adding this device's Touch ID or Windows Hello",
    responses=_DEVICE_RESPONSES,
)
async def add_app_lock_device(
    request: Request,
    body: RegisterAppLockDeviceRequest,
    caller: UnlockedCallerDep,
    app_lock: AppLockServiceDep,
    settings: SettingsDep,
) -> AppLockStatusResponse:
    party = _party(request, settings.cors_origins)
    label = body.label.strip() or "This device"
    try:
        result = await app_lock.register_device(
            caller.session, party, body.credential, label, utc_now()
        )
    except (AppLockNotEnabledError, DeviceLimitError, InvalidDeviceResponseError) as exc:
        _device_error(exc)
    return AppLockStatusResponse.of(result)


@router.delete(
    "/devices/{device_id}",
    summary="Stop a device from unlocking Orbit",
    responses={404: {"description": "Device not found."}},
)
async def remove_app_lock_device(
    device_id: uuid.UUID, caller: UnlockedCallerDep, app_lock: AppLockServiceDep
) -> AppLockStatusResponse:
    try:
        result = await app_lock.remove_device(caller.session, device_id, utc_now())
    except LockCredentialNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found.") from exc
    return AppLockStatusResponse.of(result)


@router.post(
    "/unlock/options",
    summary="Start unlocking with Touch ID or Windows Hello",
    responses={
        **_DEVICE_RESPONSES,
        404: {"description": "No device can unlock Orbit at this address."},
    },
)
async def unlock_options(
    request: Request, caller: CallerDep, app_lock: AppLockServiceDep, settings: SettingsDep
) -> AppLockDeviceOptionsResponse:
    party = _party(request, settings.cors_origins)
    try:
        options = await app_lock.unlock_options(caller.session, party, utc_now())
    except AppLockNotEnabledError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, _NOT_ENABLED) from exc
    except LockCredentialNotFoundError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No device can unlock Orbit at this address."
        ) from exc
    except SessionEndedError as exc:
        raise unauthenticated() from exc
    return AppLockDeviceOptionsResponse(options=options)


@router.post(
    "/unlock/device",
    summary="Unlock this session with Touch ID or Windows Hello",
    responses=_DEVICE_RESPONSES,
)
async def unlock_with_device(
    request: Request,
    body: UnlockWithDeviceRequest,
    caller: CallerDep,
    app_lock: AppLockServiceDep,
    settings: SettingsDep,
) -> AppLockStatusResponse:
    party = _party(request, settings.cors_origins)
    try:
        result = await app_lock.unlock_with_device(
            caller.session, party, body.credential, utc_now()
        )
    except (AppLockNotEnabledError, InvalidDeviceResponseError) as exc:
        _device_error(exc)
    except SessionEndedError as exc:
        raise unauthenticated() from exc
    return AppLockStatusResponse.of(result)


def _party(request: Request, origins: list[str]) -> RelyingParty:
    """WebAuthn keys belong to the address Orbit's web app is opened from, which must be one of
    the configured web origins."""
    origin = request.headers.get("origin")
    host = urlsplit(origin).hostname if origin else None
    if origin is None or origin not in origins or not host:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Open Orbit from its usual address to use Touch ID or Windows Hello.",
        )
    return RelyingParty(id=host, origin=origin)


def _pin_error(exc: Exception) -> NoReturn:
    if isinstance(exc, SessionEndedError):
        raise unauthenticated() from exc
    if isinstance(exc, IncorrectPinError):
        tries = "1 try" if exc.attempts_left == 1 else f"{exc.attempts_left} tries"
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Incorrect PIN. {tries} left."
        ) from exc
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter your current PIN.") from exc


def _device_error(exc: Exception) -> NoReturn:
    if isinstance(exc, AppLockNotEnabledError):
        raise HTTPException(status.HTTP_409_CONFLICT, _NOT_ENABLED) from exc
    if isinstance(exc, DeviceLimitError):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"You can add up to {MAX_DEVICES} devices."
        ) from exc
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "Your device couldn't confirm it's you. Try again, or use your PIN.",
    ) from exc
