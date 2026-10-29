"""Sign-in configuration and local-mode accounts. Cloud mode signs in with Supabase directly."""

from fastapi import APIRouter, Depends, HTTPException, Response, status

from orbit_api.api.auth import BearerTokenDep, CurrentUserDep, require_local_mode
from orbit_api.api.dependencies import LocalAuthServiceDep, SettingsDep
from orbit_api.schemas.auth import (
    AuthConfigResponse,
    LocalAuthConfig,
    LocalSessionResponse,
    LocalSignInRequest,
    LocalSignUpRequest,
    SupabaseAuthConfig,
)
from orbit_api.schemas.users import UserProfile
from orbit_api.services.local_auth import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    LocalSession,
    RegistrationClosedError,
)

router = APIRouter(prefix="/auth", tags=["auth"])
local_router = APIRouter(prefix="/local", dependencies=[Depends(require_local_mode)])


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
    },
)
async def sign_up(
    body: LocalSignUpRequest, local_auth: LocalAuthServiceDep
) -> LocalSessionResponse:
    """Create an account and its Personal workspace, and sign it in."""
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
    responses={401: {"description": "The email or password is incorrect."}},
)
async def sign_in(
    body: LocalSignInRequest, local_auth: LocalAuthServiceDep
) -> LocalSessionResponse:
    try:
        session = await local_auth.sign_in(email=body.email, password=body.password)
    except InvalidCredentialsError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "The email or password is incorrect."
        ) from None
    return _session_response(session)


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
