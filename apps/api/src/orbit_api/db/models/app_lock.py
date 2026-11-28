"""App lock: a PIN (and optionally Touch ID or Windows Hello) that unlocks Orbit after it has
been idle, enforced by the API per signed-in session."""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class AppLockSettingsModel(Base):
    """One person's lock: their PIN (an Argon2id hash) and how quickly Orbit locks and signs out.
    App lock is on exactly when this row exists."""

    __tablename__ = "app_lock_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    pin_hash: Mapped[str] = mapped_column(String(255))
    pin_length: Mapped[int] = mapped_column(Integer)
    lock_after_minutes: Mapped[int] = mapped_column(Integer)
    sign_out_after_minutes: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class AppLockCredentialModel(Base):
    """A device's built-in authenticator (Touch ID, Windows Hello) registered to unlock Orbit.
    Only the public key is stored; the private key never leaves the device."""

    __tablename__ = "app_lock_credentials"
    __table_args__ = (
        UniqueConstraint("credential_id", name="uq_app_lock_credentials_credential_id"),
        Index("ix_app_lock_credentials_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    credential_id: Mapped[bytes] = mapped_column(LargeBinary)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(Integer)
    rp_id: Mapped[str] = mapped_column(String(255))
    label: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AppLockSessionModel(Base):
    """Lock state of one signed-in session (a browser), keyed by a digest of the session. The
    session is locked once `last_active_at` is older than the lock delay, or after `locked_at`."""

    __tablename__ = "app_lock_sessions"
    __table_args__ = (Index("ix_app_lock_sessions_user_id", "user_id"),)

    session_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    last_active_at: Mapped[datetime] = mapped_column(UTCDateTime)
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    # A WebAuthn challenge this session asked for, valid until `challenge_expires_at`.
    challenge: Mapped[bytes | None] = mapped_column(LargeBinary)
    challenge_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
