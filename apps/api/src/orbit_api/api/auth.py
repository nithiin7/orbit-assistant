"""Authentication and authorization dependencies: the single gate for protected routes.

- `CurrentUserDep` derives the user from the `Authorization: Bearer` token only. Requests
  without a valid token fail with 401; identity is never taken from bodies or query strings.
- `WorkspaceDep` authorizes a `{workspace_id}` path parameter for the current user. Unknown
  workspaces and other users' workspaces both return the same 404.

Workspace-scoped routes declare `workspace: WorkspaceDep` and pass `workspace.id` to
repositories, which filter every query by it.
"""

import uuid
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, Path, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from orbit_api.api.dependencies import (
    AccountServiceDep,
    LocalAuthServiceDep,
    SettingsDep,
    WorkspaceServiceDep,
)
from orbit_api.auth.supabase import (
    AuthProviderUnavailableError,
    InvalidAccessTokenError,
    SupabaseTokenVerifier,
)
from orbit_api.services.accounts import AccountService, User
from orbit_api.services.local_auth import LocalAuthService
from orbit_api.services.workspaces import Workspace, WorkspaceNotFoundError

# Real tokens are far shorter; reject oversized input before doing any work.
MAX_TOKEN_LENGTH = 4096

bearer_scheme = HTTPBearer(
    auto_error=False,
    description="A local session token (local mode) or a Supabase access token (cloud mode).",
)


class Authenticator(Protocol):
    """Turns a bearer token into a user for the configured storage mode, or `None`."""

    async def authenticate(
        self, token: str, accounts: AccountService, local_auth: LocalAuthService
    ) -> User | None: ...


class LocalAuthenticator:
    """Local mode: opaque session tokens checked against the sessions table."""

    async def authenticate(
        self, token: str, accounts: AccountService, local_auth: LocalAuthService
    ) -> User | None:
        return await local_auth.authenticate(token)


class SupabaseAuthenticator:
    """Cloud mode: Supabase access tokens, verified locally against the project's JWKS."""

    def __init__(self, verifier: SupabaseTokenVerifier) -> None:
        self._verifier = verifier

    async def authenticate(
        self, token: str, accounts: AccountService, local_auth: LocalAuthService
    ) -> User | None:
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
        return await accounts.resolve_external(identity)


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


async def get_current_user(
    token: BearerTokenDep,
    authenticator: Annotated[Authenticator, Depends(get_authenticator)],
    accounts: AccountServiceDep,
    local_auth: LocalAuthServiceDep,
) -> User:
    user = await authenticator.authenticate(token, accounts, local_auth)
    if user is None:
        raise unauthenticated()
    return user


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
