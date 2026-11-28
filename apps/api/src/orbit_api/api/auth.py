"""Authentication and authorization dependencies: the single gate for protected routes.

- `CurrentUserDep` derives the user from the `Authorization: Bearer` token only. Requests
  without a valid token fail with 401; identity is never taken from bodies or query strings.
  With app lock on, a locked session fails with 423 until it unlocks, and a session signed out
  by the lock (idle too long, too many wrong PINs) fails with 401.
- `CallerDep` is the same check without refusing locked sessions, for the few routes a locked
  session needs: unlocking, signing out, and the profile the lock screen greets.
- `WorkspaceDep` authorizes a `{workspace_id}` path parameter for the current user. Unknown
  workspaces and other users' workspaces both return the same 404.

Workspace-scoped routes declare `workspace: WorkspaceDep` and pass `workspace.id` to
repositories, which filter every query by it.
"""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, Path, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from orbit_api.api.dependencies import (
    AccountServiceDep,
    AppLockServiceDep,
    LocalAuthServiceDep,
    SettingsDep,
    WorkspaceServiceDep,
)
from orbit_api.auth.supabase import (
    AuthProviderUnavailableError,
    InvalidAccessTokenError,
    SupabaseTokenVerifier,
)
from orbit_api.db.columns import utc_now
from orbit_api.services.accounts.models import User
from orbit_api.services.accounts.service import AccountService
from orbit_api.services.app_lock.models import SignedInSession
from orbit_api.services.local_auth.service import LocalAuthService, hash_session_token
from orbit_api.services.workspaces.models import Workspace, WorkspaceNotFoundError

# Real tokens are far shorter; reject oversized input before doing any work.
MAX_TOKEN_LENGTH = 4096

bearer_scheme = HTTPBearer(
    auto_error=False,
    description="A local session token (local mode) or a Supabase access token (cloud mode).",
)


@dataclass(frozen=True, slots=True)
class Authentication:
    user: User
    # Identifies the sign-in session (a digest, never the token) for app lock.
    session_key: str
    signed_in_at: datetime | None


class Authenticator(Protocol):
    """Turns a bearer token into a user for the configured storage mode, or `None`."""

    async def authenticate(
        self, token: str, accounts: AccountService, local_auth: LocalAuthService
    ) -> Authentication | None: ...


class LocalAuthenticator:
    """Local mode: opaque session tokens checked against the sessions table."""

    async def authenticate(
        self, token: str, accounts: AccountService, local_auth: LocalAuthService
    ) -> Authentication | None:
        session = await local_auth.authenticate(token)
        if session is None:
            return None
        return Authentication(
            user=session.user,
            session_key=hash_session_token(token),
            signed_in_at=session.started_at,
        )


class SupabaseAuthenticator:
    """Cloud mode: Supabase access tokens, verified locally against the project's JWKS."""

    def __init__(self, verifier: SupabaseTokenVerifier) -> None:
        self._verifier = verifier

    async def authenticate(
        self, token: str, accounts: AccountService, local_auth: LocalAuthService
    ) -> Authentication | None:
        try:
            identity = await run_in_threadpool(self._verifier.verify, token)
        except InvalidAccessTokenError:
            return None
        except AuthProviderUnavailableError:
            # Fail closed, but as 503 rather than 401 so clients keep their session.
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Sign-in could not be verified. Try again shortly.",
            ) from None
        user = await accounts.resolve_external(identity)
        # Supabase names the sign-in session, which outlives token refreshes. Without it, lock
        # state is kept per person instead: stricter, never looser.
        session = (
            f"session:{identity.session_id}" if identity.session_id else f"user:{identity.subject}"
        )
        return Authentication(
            user=user,
            session_key=hashlib.sha256(f"supabase:{session}".encode()).hexdigest(),
            signed_in_at=identity.authenticated_at,
        )


def get_authenticator(request: Request) -> Authenticator:
    return request.app.state.authenticator


def unauthenticated() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Sign in to continue.",
        headers={"WWW-Authenticate": "Bearer"},
    )


BearerDep = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]


def get_bearer_token(credentials: BearerDep) -> str:
    if credentials is None or not 0 < len(credentials.credentials) <= MAX_TOKEN_LENGTH:
        raise unauthenticated()
    return credentials.credentials


BearerTokenDep = Annotated[str, Depends(get_bearer_token)]


def app_locked() -> HTTPException:
    return HTTPException(status.HTTP_423_LOCKED, "Orbit is locked. Unlock it to continue.")


@dataclass(frozen=True, slots=True)
class Caller:
    """The signed-in user, their session, and whether app lock has locked that session."""

    user: User
    session: SignedInSession
    locked: bool


async def get_caller(
    token: BearerTokenDep,
    authenticator: Annotated[Authenticator, Depends(get_authenticator)],
    accounts: AccountServiceDep,
    local_auth: LocalAuthServiceDep,
    app_lock: AppLockServiceDep,
) -> Caller:
    authentication = await authenticator.authenticate(token, accounts, local_auth)
    if authentication is None:
        raise unauthenticated()
    session = SignedInSession(
        user_id=authentication.user.id,
        session_key=authentication.session_key,
        signed_in_at=authentication.signed_in_at,
    )
    state = await app_lock.check(session, utc_now())
    if state == "ended":
        raise unauthenticated()
    return Caller(user=authentication.user, session=session, locked=state == "locked")


CallerDep = Annotated[Caller, Depends(get_caller)]


def get_unlocked_caller(caller: CallerDep) -> Caller:
    if caller.locked:
        raise app_locked()
    return caller


UnlockedCallerDep = Annotated[Caller, Depends(get_unlocked_caller)]


def get_current_user(caller: UnlockedCallerDep) -> User:
    return caller.user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


async def get_workspace(
    workspace_id: Annotated[uuid.UUID, Path()],
    user: CurrentUserDep,
    workspaces: WorkspaceServiceDep,
) -> Workspace:
    try:
        return await workspaces.authorize(user.id, workspace_id)
    except WorkspaceNotFoundError:
        raise workspace_not_found() from None


WorkspaceDep = Annotated[Workspace, Depends(get_workspace)]


def workspace_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found.")


def require_local_mode(settings: SettingsDep) -> None:
    """Local account endpoints do not exist in cloud mode, where Supabase handles sign-in."""
    if settings.storage_mode != "local":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Local accounts are not available in cloud mode."
        )
