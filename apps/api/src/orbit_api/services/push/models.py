"""Push notification types and the rules for what a subscription may contain."""

import base64
import binascii
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Literal, Protocol
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric import ec

MAX_DEVICES: Final = 20

# The server posts to a subscription's endpoint, so only the browsers' own push services are
# accepted; anything else would let a signed-in person aim the server at an internal address.
_PUSH_HOSTS: Final = frozenset({"fcm.googleapis.com", "web.push.apple.com"})
_PUSH_HOST_SUFFIXES: Final = (
    ".push.apple.com",
    ".push.services.mozilla.com",
    ".notify.windows.com",
)

PushOutcome = Literal["sent", "gone", "failed"]
PushUrgency = Literal["normal", "high"]


class PushUnavailableError(Exception):
    """This server has no push key, or an operator turned push off."""


class InvalidPushSubscriptionError(Exception):
    """The endpoint isn't a known push service, or the keys aren't valid."""


@dataclass(frozen=True, slots=True)
class PushSubscription:
    id: uuid.UUID
    user_id: uuid.UUID
    endpoint: str
    p256dh: str
    auth: str


@dataclass(frozen=True, slots=True)
class PushPreferences:
    user_id: uuid.UUID
    reminders: bool = True
    briefing: bool = True
    # Off: notifications say only that something needs attention.
    show_details: bool = False


@dataclass(frozen=True, slots=True)
class PushStatus:
    public_key: str | None
    preferences: PushPreferences
    devices: int


@dataclass(frozen=True, slots=True)
class PushMessage:
    title: str
    body: str
    # An in-app path to open.
    link: str
    # A newer notification with the same tag replaces the older one on the device.
    tag: str
    # How long the push service keeps trying to reach a device that is offline.
    ttl_seconds: int
    urgency: PushUrgency


class PushSender(Protocol):
    def public_key(self) -> str | None:
        """The key browsers subscribe with; `None` when push is unavailable."""
        ...

    async def send(
        self, subscriptions: Sequence[PushSubscription], message: PushMessage
    ) -> list[PushOutcome]:
        """Send to each subscription, returning one outcome each, in order. Never raises for a
        device that can't be reached."""
        ...


def is_push_endpoint(endpoint: str) -> bool:
    """Whether `endpoint` is an HTTPS address of a known browser push service."""
    try:
        url = urlsplit(endpoint)
        port = url.port
    except ValueError:
        return False
    host = (url.hostname or "").lower()
    return (
        url.scheme == "https"
        and port in (None, 443)
        and url.username is None
        and url.password is None
        and (host in _PUSH_HOSTS or host.endswith(_PUSH_HOST_SUFFIXES))
    )


def decode_key(value: str) -> bytes:
    """Decode an unpadded URL-safe base64 key. Raises `ValueError` when it is malformed."""
    try:
        return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except binascii.Error as exc:
        raise ValueError("Not URL-safe base64.") from exc


def check_subscription(endpoint: str, p256dh: str, auth: str) -> None:
    """Raise `InvalidPushSubscriptionError` unless the subscription can be used."""
    if not is_push_endpoint(endpoint):
        raise InvalidPushSubscriptionError
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decode_key(p256dh))
        secret = decode_key(auth)
    except ValueError as exc:
        raise InvalidPushSubscriptionError from exc
    if len(secret) != 16:
        raise InvalidPushSubscriptionError
