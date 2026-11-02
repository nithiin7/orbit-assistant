"""OAuth 2.0 Authorization Code flow helpers: state and PKCE (RFC 7636, S256).

The state is 256 random bits, sent to the provider and back; Orbit stores only its SHA-256, so a
leaked database can't complete someone's authorization. The PKCE verifier stays on the server
(encrypted), so an intercepted authorization code is useless on its own.
"""

import base64
import hashlib
import hmac
import secrets


def new_state() -> str:
    return secrets.token_urlsafe(32)


def new_code_verifier() -> str:
    # 43 to 128 characters from the unreserved set (RFC 7636 §4.1): 64 bytes → 86 characters.
    return secrets.token_urlsafe(64)


def code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def matches(value: str, expected_digest: str | None) -> bool:
    """Constant-time comparison of a secret with a stored digest."""
    if not expected_digest:
        return False
    return hmac.compare_digest(digest(value), expected_digest)
