"""Sign-in configuration and local-mode accounts. Cloud mode signs in with Supabase directly."""

import math
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from orbit_api.api.auth import BearerTokenDep, CurrentUserDep, require_local_mode
from orbit_api.api.dependencies import LocalAuthServiceDep, SettingsDep, SignInThrottleDep
from orbit_api.schemas.auth import (
    AuthConfigResponse,
    ChangePasswordRequest,
    LocalAuthConfig,
    LocalSessionResponse,
    LocalSignInRequest,
    LocalSignUpRequest,
    SupabaseAuthConfig,
)
from orbit_api.schemas.users import UserProfile
from orbit_api.services.local_auth.models import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    LocalSession,
    RegistrationClosedError,
)

router = APIRouter(prefix="/auth", tags=["auth"])
local_router = APIRouter(prefix="/local", dependencies=[Depends(require_local_mode)])

_TOO_MANY = {429: {"description": "Too many attempts. Wait for `Retry-After` seconds."}}


@router.get("/config", summary="Get sign-in configuration")
async def auth_config(settings: SettingsDep, local_auth: LocalAuthServiceDep) -> AuthConfigResponse:
    """How the web app should sign users in. Public, and contains no secrets."""
    if settings.storage_mode == "cloud" and settings.supabase_publishable_key:
        return SupabaseAuthConfig(
            provider="supabase",
            supabase_url=settings.supabase_base_url,
            supabase_publishable_key=settings.supabase_publishable_key,
        )
    return LocalAuthConfig(provider="local", registration_open=await local_auth.registration_open())


@local_router.post(
    "/sign-up",
    status_code=status.HTTP_201_CREATED,
    summary="Create a local account",
    responses={
        403: {"description": "This installation does not accept new accounts."},
        409: {"description": "An account with this email already exists."},
        **_TOO_MANY,
    },
)
async def sign_up(
    body: LocalSignUpRequest,
    request: Request,
    local_auth: LocalAuthServiceDep,
    throttle: SignInThrottleDep,
) -> LocalSessionResponse:
    """Create an account and its Personal workspace, and sign it in."""
    client = _client(request)
    if (wait := throttle.sign_up_retry_after(client)) is not None:
        raise _too_many(wait)
    throttle.sign_up_attempted(client)
    try:
        session = await local_auth.sign_up(
            email=body.email, password=body.password, display_name=body.display_name
        )
    except RegistrationClosedError:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This Orbit installation does not accept new accounts. Sign in instead.",
        ) from None
    except EmailAlreadyRegisteredError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists."
        ) from None
    return _session_response(session)


@local_router.post(
    "/sign-in",
    summary="Sign in to a local account",
    responses={401: {"description": "The email or password is incorrect."}, **_TOO_MANY},
)
async def sign_in(
    body: LocalSignInRequest,
    request: Request,
    local_auth: LocalAuthServiceDep,
    throttle: SignInThrottleDep,
) -> LocalSessionResponse:
    """Repeated failures for one account, or from one address, are refused for a while."""
    client = _client(request)
    if (wait := throttle.sign_in_retry_after(body.email, client)) is not None:
        raise _too_many(wait)
    try:
        session = await local_auth.sign_in(email=body.email, password=body.password)
    except InvalidCredentialsError:
        throttle.sign_in_failed(body.email, client)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "The email or password is incorrect."
        ) from None
    throttle.sign_in_succeeded(body.email)
    return _session_response(session)


@local_router.post(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change the local account's password",
    responses={
        401: {"description": "Not signed in."},
        403: {"description": "The current password is incorrect."},
        **_TOO_MANY,
    },
)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: CurrentUserDep,
    token: BearerTokenDep,
    local_auth: LocalAuthServiceDep,
    throttle: SignInThrottleDep,
) -> Response:
    """Every other session of this account is signed out; this one stays signed in."""
    client = _client(request)
    if (wait := throttle.sign_in_retry_after(user.email, client)) is not None:
        raise _too_many(wait)
    try:
        await local_auth.change_password(
            user=user,
            token=token,
            current_password=body.current_password,
            new_password=body.new_password,
        )
    except InvalidCredentialsError:
        throttle.sign_in_failed(user.email, client)
        # 403, not 401: the session is valid, and a 401 would sign the web app out.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "The current password is incorrect."
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@local_router.post(
    "/sign-out",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="End the current local session",
    responses={401: {"description": "Not signed in."}},
)
async def sign_out(
    _user: CurrentUserDep, token: BearerTokenDep, local_auth: LocalAuthServiceDep
) -> Response:
    """Revoke the session token used for this request."""
    await local_auth.sign_out(token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


router.include_router(local_router)


def _session_response(session: LocalSession) -> LocalSessionResponse:
    return LocalSessionResponse(
        access_token=session.token,
        token_type="bearer",
        expires_at=session.expires_at,
        user=UserProfile.of(session.user),
    )


def _client(request: Request) -> str:
    """The caller's address: the proxy's, unless `ORBIT_FORWARDED_ALLOW_IPS` trusts it."""
    return request.client.host if request.client else "unknown"


def _too_many(wait: timedelta) -> HTTPException:
    seconds = max(1, math.ceil(wait.total_seconds()))
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "Too many attempts. Wait a few minutes, then try again.",
        headers={"Retry-After": str(seconds)},
    )
