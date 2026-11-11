"""Achievements and the XP store: what a person has unlocked, bought, and is wearing.

Per person, like the profile photo. The achievements themselves and the store's items are a
catalog in code (`services/achievements/catalog.py`); these tables only record what happened.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

REWARD_SLOTS = "('frame', 'banner', 'title', 'confetti')"


class AchievementUnlockModel(Base):
    """An achievement a user unlocked. The XP is kept as earned, so rebalancing the catalog
    later never changes what someone already has."""

    __tablename__ = "achievement_unlocks"
    __table_args__ = (CheckConstraint("xp >= 0", name="xp"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    achievement_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    xp: Mapped[int] = mapped_column(Integer)
    unlocked_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class RewardPurchaseModel(Base):
    """A store item a user bought with XP, at the price they paid."""

    __tablename__ = "reward_purchases"
    __table_args__ = (CheckConstraint("cost >= 0", name="cost"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    item_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    cost: Mapped[int] = mapped_column(Integer)
    purchased_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class RewardEquipModel(Base):
    """The item a user wears in one slot. Only owned items can be worn."""

    __tablename__ = "reward_equips"
    __table_args__ = (
        CheckConstraint(f"slot IN {REWARD_SLOTS}", name="slot"),
        ForeignKeyConstraint(
            ["user_id", "item_key"],
            ["reward_purchases.user_id", "reward_purchases.item_key"],
            name="fk_reward_equips_purchase",
            ondelete="CASCADE",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    slot: Mapped[str] = mapped_column(String(16), primary_key=True)
    item_key: Mapped[str] = mapped_column(String(64))
    equipped_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
