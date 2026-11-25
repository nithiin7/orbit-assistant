"""Push notifications: the devices a person turned them on for, and what they want to receive."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class PushSubscriptionModel(Base):
    """One browser or installed app that receives push notifications. The endpoint and keys are
    what the browser's push service needs to reach it; they are never returned or logged."""

    __tablename__ = "push_subscriptions"
    __table_args__ = (
        # A device belongs to whoever turned push on there last.
        UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
        Index("ix_push_subscriptions_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    endpoint: Mapped[str] = mapped_column(String(2048))
    p256dh: Mapped[str] = mapped_column(String(128))
    auth: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class PushPreferencesModel(Base):
    """What one person receives on every device they turned push on for."""

    __tablename__ = "push_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    reminders: Mapped[bool] = mapped_column(Boolean)
    briefing: Mapped[bool] = mapped_column(Boolean)
    show_details: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
