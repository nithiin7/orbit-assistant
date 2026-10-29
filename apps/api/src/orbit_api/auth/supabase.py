"""Verification of Supabase Auth access tokens.

Tokens are checked against the project's public signing keys (JWKS), so the API needs no
Supabase secret. Projects must use asymmetric JWT signing keys (ES256 or RS256), the Supabase
default for new projects; legacy shared-secret (HS256) tokens are rejected.
"""

import uuid
from typing import Any, Protocol, cast

import jwt
from jwt import PyJWK, PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientConnectionError, PyJWKClientError

from orbit_api.services.accounts import ExternalIdentity

ALGORITHMS = ["ES256", "RS256"]
AUDIENCE = "authenticated"
JWKS_CACHE_SECONDS = 600
JWKS_TIMEOUT_SECONDS = 5
# Allow for small clock differences between Supabase and this server.
LEEWAY_SECONDS = 30


class InvalidAccessTokenError(Exception):
    """The token is malformed, expired, forged, or not a signed-in user's token."""


class AuthProviderUnavailableError(Exception):
    """Supabase's signing keys could not be fetched, so no token can be verified."""


class SigningKeySource(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> PyJWK: ...


class SupabaseTokenVerifier:
    def __init__(self, project_url: str, keys: SigningKeySource | None = None) -> None:
        self._issuer = f"{project_url}/auth/v1"
        self._keys: SigningKeySource = keys or PyJWKClient(
            f"{self._issuer}/.well-known/jwks.json",
            cache_keys=True,
            lifespan=JWKS_CACHE_SECONDS,
            timeout=JWKS_TIMEOUT_SECONDS,
        )

    def verify(self, token: str) -> ExternalIdentity:
        """Verify signature, expiry, issuer, and audience, then extract the identity.

        Blocking: it may fetch the signing keys over the network. Call it from a thread.
        """
        try:
            key = self._keys.get_signing_key_from_jwt(token)
        except PyJWKClientConnectionError as exc:
            raise AuthProviderUnavailableError from exc
        except (PyJWKClientError, InvalidTokenError) as exc:
            raise InvalidAccessTokenError from exc

        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key=key,
                algorithms=ALGORITHMS,
                audience=AUDIENCE,
                issuer=self._issuer,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except InvalidTokenError as exc:
            raise InvalidAccessTokenError from exc
        return _identity(claims)


def _identity(claims: dict[str, Any]) -> ExternalIdentity:
    subject = claims.get("sub")
    email = claims.get("email")
    if not isinstance(subject, str) or not _is_uuid(subject):
        raise InvalidAccessTokenError
    # Only full users: anonymous sign-ins and service tokens are not Orbit accounts.
    if claims.get("role") != AUDIENCE or claims.get("is_anonymous") is True:
        raise InvalidAccessTokenError
    if not isinstance(email, str) or not email:
        raise InvalidAccessTokenError

    metadata = claims.get("user_metadata")
    display_name = (
        cast(dict[str, object], metadata).get("display_name")
        if isinstance(metadata, dict)
        else None
    )
    return ExternalIdentity(
        subject=subject,
        email=email.lower(),
        display_name=display_name if isinstance(display_name, str) else None,
    )


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True
