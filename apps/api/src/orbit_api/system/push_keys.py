"""The server's VAPID key pair, which identifies this Orbit server to browser push services.

The private key comes from `ORBIT_WEB_PUSH_PRIVATE_KEY`, or in local mode from a key file beside
the SQLite database, created on first use with mode `0600`. Replacing the key means every device
has to turn push on again.
"""

import base64
import contextlib
import logging
import os
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from orbit_api.config import Settings
from orbit_api.services.push.models import decode_key

logger = logging.getLogger(__name__)


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


class VapidKeys:
    def __init__(self, enabled: bool, key: str | None, key_file: Path | None) -> None:
        self._enabled = enabled
        self._key = key
        self._key_file = key_file
        self._private: ec.EllipticCurvePrivateKey | None = None

    @classmethod
    def from_settings(cls, settings: Settings) -> "VapidKeys":
        key = settings.web_push_private_key
        return cls(
            settings.web_push_enabled,
            key.get_secret_value() if key else None,
            settings.web_push_key_file,
        )

    def private_key(self) -> ec.EllipticCurvePrivateKey | None:
        """The private key, or `None` when push is off or this server has no key."""
        if not self._enabled:
            return None
        if self._private is None:
            try:
                encoded = self._key or self._load_key_file()
                if encoded is None:
                    return None
                value = int.from_bytes(decode_key(encoded), "big")
                self._private = ec.derive_private_key(value, ec.SECP256R1())
            except (OSError, ValueError) as exc:
                # Only the error's type: the message could quote the key.
                logger.error("The web push key is unusable: %s", type(exc).__name__)
                return None
        return self._private

    def public_key(self) -> str | None:
        private = self.private_key()
        if private is None:
            return None
        return _encode(
            private.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
        )

    def _load_key_file(self) -> str | None:
        path = self._key_file
        if path is None:
            return None
        try:
            return path.read_text().strip()
        except FileNotFoundError:
            pass
        private = ec.generate_private_key(ec.SECP256R1())
        encoded = _encode(private.private_numbers().private_value.to_bytes(32, "big"))
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Written in full under another name, then linked into place: a process starting at the
        # same moment sees either no file or a complete one, and the first link wins.
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".web-push-")
        try:
            with os.fdopen(descriptor, "w") as file:
                file.write(encoded)
            with contextlib.suppress(FileExistsError):
                os.link(temporary, path)
        finally:
            Path(temporary).unlink()
        return path.read_text().strip()
