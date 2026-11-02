"""Encrypting provider API keys at rest with Fernet (AES-128-CBC with HMAC-SHA256).

The key comes from `ORBIT_AI_SECRET_KEY`, or in local mode from a key file beside the SQLite
database, created on first use with mode `0600`. Keeping the key out of the database means a
copied database file (a backup, a synced folder) doesn't reveal API keys by itself. It doesn't
protect against someone who can read both files; use the OS's disk encryption for that.
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from orbit_api.config import Settings
from orbit_api.services.ai.models import CredentialsUnavailableError


class FernetSecretBox:
    def __init__(self, key: bytes | None, key_file: Path | None) -> None:
        self._key = key
        self._key_file = key_file
        self._fernet: Fernet | None = None

    @classmethod
    def from_settings(cls, settings: Settings) -> "FernetSecretBox":
        key = settings.ai_secret_key
        return cls(key.get_secret_value().encode() if key else None, settings.ai_key_file)

    def encrypt(self, plaintext: str) -> str:
        return self._cipher().encrypt(plaintext.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._cipher().decrypt(token.encode()).decode()
        except InvalidToken:
            # The secret key changed since the API key was stored.
            raise CredentialsUnavailableError from None

    def _cipher(self) -> Fernet:
        if self._fernet is None:
            self._fernet = Fernet(self._key or self._load_key_file())
        return self._fernet

    def _load_key_file(self) -> bytes:
        path = self._key_file
        if path is None:
            raise CredentialsUnavailableError
        try:
            return path.read_bytes().strip()
        except FileNotFoundError:
            pass
        key = Fernet.generate_key()
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            # O_EXCL: if another process created the file first, use its key.
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return path.read_bytes().strip()
        with os.fdopen(descriptor, "wb") as file:
            file.write(key)
        return key
