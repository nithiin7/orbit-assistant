"""Password-protected backup archives.

Built only from standard primitives in `cryptography` and `argon2-cffi`; nothing here is a new
algorithm:

- **Password → key:** Argon2id (RFC 9106) with a random 16-byte salt, 64 MiB of memory, three
  passes, and four lanes.
- **Backup key:** an X25519 key pair. The private key is sealed with AES-256-GCM under the
  password-derived key. Automatic backups need only the public key, so the server encrypts them
  without ever holding the password; restoring needs the password to unseal the private key.
- **File key:** a random 256-bit key per archive, wrapped for the backup key the way ECIES and
  HPKE do it: an ephemeral X25519 key agreement, HKDF-SHA256 over the shared secret and both
  public keys, and AES-256-GCM.
- **Content:** the archive in 64 KiB chunks, each sealed with AES-256-GCM under the file key.
  Chunk nonces are a random 7-byte prefix, a 4-byte counter, and a final-chunk flag (the STREAM
  construction), and every chunk authenticates the header, so chunks can't be reordered,
  dropped, truncated, or moved between archives, and no nonce repeats under a key.

Each archive carries its own sealed private key, so it opens with its password alone, on any
Orbit installation. Passwords are never stored or logged. A wrong password fails on the sealed
key, before any content is read; damage or tampering fails on the first bad chunk.

File layout: `ORBITENC` magic, a version byte, the header's length (4 bytes, big-endian), the
header (JSON), then the chunks.
"""

import base64
import hashlib
import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Final, cast

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from orbit_api.services.backup.models import InvalidArchiveError, WrongPasswordError

MAGIC: Final = b"ORBITENC"
VERSION: Final = 1
CHUNK_SIZE: Final = 64 * 1024
_TAG: Final = 16
_MAX_HEADER: Final = 64 * 1024
_SEAL_CONTEXT: Final = b"orbit-backup v1 private key"
_WRAP_CONTEXT: Final = b"orbit-backup v1 file key"


@dataclass(frozen=True, slots=True)
class KdfParams:
    time_cost: int = 3
    memory_kib: int = 64 * 1024
    parallelism: int = 4


DEFAULT_KDF: Final = KdfParams()
# Bounds on what an archive's header may ask for, so a crafted header can't exhaust memory.
_KDF_LIMITS: Final = {"time_cost": (1, 10), "memory_kib": (8, 1024 * 1024), "parallelism": (1, 16)}


@dataclass(frozen=True, slots=True)
class BackupKey:
    """A backup key ready to store: the public key and the password-sealed private key."""

    public_key: str
    sealed_private_key: dict[str, Any]


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _unb64(value: object, *, length: int | None = None) -> bytes:
    if not isinstance(value, str):
        raise InvalidArchiveError("The backup's encryption header is damaged.")
    try:
        data = base64.b64decode(value, validate=True)
    except ValueError:
        raise InvalidArchiveError("The backup's encryption header is damaged.") from None
    if length is not None and len(data) != length:
        raise InvalidArchiveError("The backup's encryption header is damaged.")
    return data


def _raw_public(key: X25519PublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def _derive(password: str, salt: bytes, params: KdfParams) -> bytes:
    return hash_secret_raw(
        password.encode(),
        salt,
        time_cost=params.time_cost,
        memory_cost=params.memory_kib,
        parallelism=params.parallelism,
        hash_len=32,
        type=Type.ID,
    )


def create_key(password: str, params: KdfParams = DEFAULT_KDF) -> BackupKey:
    """A new backup key, its private half sealed with `password`."""
    private = X25519PrivateKey.generate()
    public = _raw_public(private.public_key())
    salt = os.urandom(16)
    nonce = os.urandom(12)
    sealed = AESGCM(_derive(password, salt, params)).encrypt(
        nonce,
        private.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        ),
        _SEAL_CONTEXT + public,
    )
    return BackupKey(
        public_key=_b64(public),
        sealed_private_key={
            "kdf": "argon2id",
            "time_cost": params.time_cost,
            "memory_kib": params.memory_kib,
            "parallelism": params.parallelism,
            "salt": _b64(salt),
            "nonce": _b64(nonce),
            "ciphertext": _b64(sealed),
        },
    )


def unseal(key: BackupKey, password: str) -> X25519PrivateKey:
    """The private key, or `WrongPasswordError`."""
    sealed = key.sealed_private_key
    if sealed.get("kdf") != "argon2id":
        raise InvalidArchiveError("The backup uses an encryption method this Orbit can't read.")
    values: dict[str, int] = {}
    for name, (low, high) in _KDF_LIMITS.items():
        value = sealed.get(name)
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise InvalidArchiveError("The backup's encryption header is damaged.")
        values[name] = value
    params = KdfParams(**values)
    public = _unb64(key.public_key, length=32)
    salt = _unb64(sealed.get("salt"))
    if not 16 <= len(salt) <= 64:
        raise InvalidArchiveError("The backup's encryption header is damaged.")
    nonce = _unb64(sealed.get("nonce"), length=12)
    try:
        raw = AESGCM(_derive(password, salt, params)).decrypt(
            nonce, _unb64(sealed.get("ciphertext")), _SEAL_CONTEXT + public
        )
    except InvalidTag:
        raise WrongPasswordError from None
    private = X25519PrivateKey.from_private_bytes(raw)
    if _raw_public(private.public_key()) != public:
        raise InvalidArchiveError("The backup's encryption header is damaged.")
    return private


def check_password(key: BackupKey, password: str) -> None:
    unseal(key, password)


def _wrapping_key(shared: bytes, ephemeral: bytes, recipient: bytes) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=ephemeral + recipient, info=_WRAP_CONTEXT
    ).derive(shared)


def _nonce(prefix: bytes, counter: int, last: bool) -> bytes:
    return prefix + struct.pack(">I", counter) + (b"\x01" if last else b"\x00")


def is_encrypted(path: Path) -> bool:
    with path.open("rb") as file:
        return file.read(len(MAGIC)) == MAGIC


def encrypt_file(source: Path, target: Path, key: BackupKey) -> None:
    """Encrypt `source` into `target` (created `0600`) for `key`. Blocking; run in a thread."""
    recipient = _unb64(key.public_key, length=32)
    file_key = AESGCM.generate_key(bit_length=256)
    ephemeral = X25519PrivateKey.generate()
    ephemeral_public = _raw_public(ephemeral.public_key())
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(recipient))
    wrap_nonce = os.urandom(12)
    wrapped = AESGCM(_wrapping_key(shared, ephemeral_public, recipient)).encrypt(
        wrap_nonce, file_key, _WRAP_CONTEXT + recipient
    )
    prefix = os.urandom(7)
    header = json.dumps(
        {
            "public_key": key.public_key,
            "sealed_private_key": key.sealed_private_key,
            "ephemeral_public_key": _b64(ephemeral_public),
            "wrapped_file_key": {"nonce": _b64(wrap_nonce), "ciphertext": _b64(wrapped)},
            "chunk_size": CHUNK_SIZE,
            "nonce_prefix": _b64(prefix),
        },
        separators=(",", ":"),
    ).encode()
    preamble = MAGIC + bytes([VERSION]) + struct.pack(">I", len(header)) + header
    aad = hashlib.sha256(preamble).digest()
    cipher = AESGCM(file_key)
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "wb") as out, source.open("rb") as plain:
        out.write(preamble)
        counter = 0
        chunk = plain.read(CHUNK_SIZE)
        while True:
            if len(chunk) < CHUNK_SIZE:
                # The last chunk is always short (empty when the size is a multiple), so a
                # full-size chunk is never last and truncation can't go unnoticed.
                out.write(cipher.encrypt(_nonce(prefix, counter, True), chunk, aad))
                break
            following = plain.read(CHUNK_SIZE)
            out.write(cipher.encrypt(_nonce(prefix, counter, False), chunk, aad))
            counter += 1
            chunk = following
        out.flush()
        os.fsync(out.fileno())


def _read_header(file: BinaryIO) -> tuple[dict[str, Any], bytes]:
    magic = file.read(len(MAGIC))
    if magic != MAGIC:
        raise InvalidArchiveError("This isn't an encrypted Orbit backup.")
    version = file.read(1)
    if version != bytes([VERSION]):
        raise InvalidArchiveError("This backup was encrypted by a newer version of Orbit.")
    length_bytes = file.read(4)
    if len(length_bytes) != 4:
        raise InvalidArchiveError("The backup is incomplete.")
    (length,) = struct.unpack(">I", length_bytes)
    if not 0 < length <= _MAX_HEADER:
        raise InvalidArchiveError("The backup's encryption header is damaged.")
    header_bytes = file.read(length)
    if len(header_bytes) != length:
        raise InvalidArchiveError("The backup is incomplete.")
    try:
        header: object = json.loads(header_bytes)
    except ValueError:
        raise InvalidArchiveError("The backup's encryption header is damaged.") from None
    if not isinstance(header, dict):
        raise InvalidArchiveError("The backup's encryption header is damaged.")
    preamble = magic + version + length_bytes + header_bytes
    return cast(dict[str, Any], header), preamble


def read_key(path: Path) -> BackupKey:
    """The backup key an encrypted archive was made for (still sealed)."""
    with path.open("rb") as file:
        header, _ = _read_header(file)
    return _key_of(header)


def _key_of(header: dict[str, Any]) -> BackupKey:
    public = header.get("public_key")
    sealed = header.get("sealed_private_key")
    if not isinstance(public, str) or not isinstance(sealed, dict):
        raise InvalidArchiveError("The backup's encryption header is damaged.")
    return BackupKey(public_key=public, sealed_private_key=cast(dict[str, Any], sealed))


def decrypt_file(source: Path, target: Path, password: str, *, max_bytes: int) -> None:
    """Decrypt `source` into `target` (`0600`), authenticating every chunk. Raises
    `WrongPasswordError`, or `InvalidArchiveError` if the archive is damaged, changed, or
    expands beyond `max_bytes`. Blocking; run in a thread. `target` is left for the caller to
    delete on failure."""
    with source.open("rb") as file:
        header, preamble = _read_header(file)
        key = _key_of(header)
        private = unseal(key, password)
        recipient = _unb64(key.public_key, length=32)
        ephemeral = _unb64(header.get("ephemeral_public_key"), length=32)
        wrapped = header.get("wrapped_file_key")
        if not isinstance(wrapped, dict) or header.get("chunk_size") != CHUNK_SIZE:
            raise InvalidArchiveError("The backup's encryption header is damaged.")
        wrap = cast(dict[str, Any], wrapped)
        shared = private.exchange(X25519PublicKey.from_public_bytes(ephemeral))
        try:
            file_key = AESGCM(_wrapping_key(shared, ephemeral, recipient)).decrypt(
                _unb64(wrap.get("nonce"), length=12),
                _unb64(wrap.get("ciphertext")),
                _WRAP_CONTEXT + recipient,
            )
        except InvalidTag:
            raise InvalidArchiveError("The backup's encryption header is damaged.") from None
        prefix = _unb64(header.get("nonce_prefix"), length=7)
        aad = hashlib.sha256(preamble).digest()
        cipher = AESGCM(file_key)
        written = 0
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as out:
            counter = 0
            while True:
                sealed = file.read(CHUNK_SIZE + _TAG)
                if len(sealed) < _TAG:
                    raise InvalidArchiveError("The backup is incomplete.")
                last = len(sealed) < CHUNK_SIZE + _TAG
                try:
                    chunk = cipher.decrypt(_nonce(prefix, counter, last), sealed, aad)
                except InvalidTag:
                    raise InvalidArchiveError(
                        "The backup is damaged or was changed after it was made."
                    ) from None
                written += len(chunk)
                if written > max_bytes:
                    raise InvalidArchiveError("The backup is larger than this server accepts.")
                out.write(chunk)
                if last:
                    break
                counter += 1
            if file.read(1):
                raise InvalidArchiveError("The backup has unexpected data after its end.")
            out.flush()
