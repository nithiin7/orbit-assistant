"""User profiles and the credentials and sessions of local-mode accounts."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class UserModel(Base):
    """An Orbit user profile, bound to exactly one authentication identity.

    `(auth_provider, auth_subject)` is the identity: `supabase` with the Supabase user ID in
    cloud mode, `local` with the profile's own ID in local mode.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("auth_provider", "auth_subject", name="uq_users_auth_identity"),
        CheckConstraint("auth_provider IN ('local', 'supabase')", name="auth_provider"),
        CheckConstraint("length(auth_subject) BETWEEN 1 AND 255", name="auth_subject_length"),
        CheckConstraint("length(email) BETWEEN 3 AND 320", name="email_length"),
        CheckConstraint("length(display_name) BETWEEN 1 AND 100", name="display_name_length"),
        CheckConstraint("length(timezone) BETWEEN 1 AND 64", name="timezone_length"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    auth_provider: Mapped[str] = mapped_column(String(16))
    auth_subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(100))
    # The user's IANA time zone, such as `Europe/Paris`; `None` until they choose one.
    timezone: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class LocalCredentialModel(Base):
    """The sign-in email and password hash of a local-mode account. Never used in cloud mode."""

    __tablename__ = "local_credentials"
    __table_args__ = (
        # Emails are stored normalized so uniqueness is case-insensitive on both databases.
        CheckConstraint("email = lower(email)", name="email_normalized"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class LocalSessionModel(Base):
    """A signed-in local-mode session. Only a SHA-256 digest of the bearer token is stored."""

    __tablename__ = "local_sessions"
    __table_args__ = (CheckConstraint("expires_at > created_at", name="expires_after_creation"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
