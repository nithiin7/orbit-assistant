"""Sending Web Push messages: payload encryption (RFC 8291) and server identification (VAPID,
RFC 8292). Push services see only the destination and an encrypted payload."""

import asyncio
import json
import logging
import os
import struct
import time
from collections.abc import Sequence
from typing import Final
from urllib.parse import urlsplit

import httpx2
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from orbit_api.config import Settings
from orbit_api.services.push.models import (
    PushMessage,
    PushOutcome,
    PushSubscription,
    decode_key,
    is_push_endpoint,
)
from orbit_api.system.push_keys import VapidKeys

logger = logging.getLogger(__name__)

_RECORD_SIZE: Final = 4096
_SEND_TIMEOUT_SECONDS: Final = 8.0
_VAPID_LIFETIME_SECONDS: Final = 12 * 60 * 60


def _hkdf(salt: bytes, secret: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(secret)


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def encrypt_payload(
    plaintext: bytes,
    p256dh: bytes,
    auth: bytes,
    *,
    sender_key: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """Encrypt `plaintext` for one device as a single `aes128gcm` record. `sender_key` and `salt`
    are fresh for every message; tests pass the RFC's values."""
    device_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), p256dh)
    ephemeral = sender_key or ec.generate_private_key(ec.SECP256R1())
    ephemeral_public = _public_bytes(ephemeral.public_key())
    message_salt = salt or os.urandom(16)

    shared_secret = ephemeral.exchange(ec.ECDH(), device_key)
    key_info = b"WebPush: info\x00" + p256dh + ephemeral_public
    input_key = _hkdf(auth, shared_secret, key_info, 32)
    content_key = _hkdf(message_salt, input_key, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(message_salt, input_key, b"Content-Encoding: nonce\x00", 12)

    # 0x02 marks the last (here, only) record.
    record = AESGCM(content_key).encrypt(nonce, plaintext + b"\x02", None)
    header = message_salt + struct.pack("!IB", _RECORD_SIZE, len(ephemeral_public))
    return header + ephemeral_public + record


class WebPushSender:
    def __init__(
        self,
        keys: VapidKeys,
        contact: str,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._keys = keys
        self._contact = contact
        self._transport = transport

    @classmethod
    def from_settings(cls, settings: Settings) -> "WebPushSender":
        return cls(VapidKeys.from_settings(settings), settings.web_push_contact)

    def public_key(self) -> str | None:
        return self._keys.public_key()

    async def send(
        self, subscriptions: Sequence[PushSubscription], message: PushMessage
    ) -> list[PushOutcome]:
        private_key = self._keys.private_key()
        public_key = self._keys.public_key()
        if private_key is None or public_key is None:
            return ["failed"] * len(subscriptions)
        payload = json.dumps(
            {"title": message.title, "body": message.body, "link": message.link, "tag": message.tag}
        ).encode()
        async with httpx2.AsyncClient(
            timeout=_SEND_TIMEOUT_SECONDS, follow_redirects=False, transport=self._transport
        ) as client:
            return list(
                await asyncio.gather(
                    *(
                        self._send_one(client, item, payload, message, private_key, public_key)
                        for item in subscriptions
                    )
                )
            )

    async def _send_one(
        self,
        client: httpx2.AsyncClient,
        subscription: PushSubscription,
        payload: bytes,
        message: PushMessage,
        private_key: ec.EllipticCurvePrivateKey,
        public_key: str,
    ) -> PushOutcome:
        # Checked again here: the row may predate a change to the allowed services.
        if not is_push_endpoint(subscription.endpoint):
            return "gone"
        url = urlsplit(subscription.endpoint)
        token = jwt.encode(
            {
                "aud": f"{url.scheme}://{url.netloc}",
                "exp": int(time.time()) + _VAPID_LIFETIME_SECONDS,
                "sub": self._contact,
            },
            private_key,
            algorithm="ES256",
        )
        try:
            body = encrypt_payload(
                payload, decode_key(subscription.p256dh), decode_key(subscription.auth)
            )
            response = await client.post(
                subscription.endpoint,
                content=body,
                headers={
                    "Authorization": f"vapid t={token}, k={public_key}",
                    "Content-Encoding": "aes128gcm",
                    "Content-Type": "application/octet-stream",
                    "TTL": str(message.ttl_seconds),
                    "Urgency": message.urgency,
                },
            )
        except (httpx2.HTTPError, ValueError) as exc:
            # The endpoint identifies a device, so only the error's type is logged.
            logger.warning("Sending a push notification failed: %s", type(exc).__name__)
            return "failed"
        if response.status_code in (404, 410):
            return "gone"
        if response.is_success:
            return "sent"
        logger.warning("A push service refused a notification: HTTP %d", response.status_code)
        return "failed"
