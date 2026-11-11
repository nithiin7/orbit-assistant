"""Achievements, XP, levels, and the XP store.

Achievements are worked out from data a person already has (tasks done, habit streaks, countries
visited, and so on), so there is no event stream to keep in sync: `check` counts, then records
any achievement newly reached. An unlock is permanent and keeps the XP it earned, even if the
data behind it is later deleted.

XP spent in the store lowers the balance but never the level, which follows XP earned.

Everything is per person, addressed by the signed-in user's ID; the metrics source counts only
that user's own workspaces and private health records.
"""

import uuid
from collections.abc import Callable, Iterable
from datetime import date, datetime, timedelta
from typing import Protocol

from orbit_api.services.achievements.catalog import ACHIEVEMENTS, REWARDS, REWARDS_BY_KEY
from orbit_api.services.achievements.models import (
    AchievementProgress,
    Level,
    LevelTooLowError,
    Metrics,
    NotEnoughXpError,
    Profile,
    Purchase,
    RewardNotFoundError,
    RewardNotOwnedError,
    RewardOwnedError,
    Slot,
    StoreEntry,
    Unlock,
)
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.clock import utc_now

# Level n starts at 50·n·(n-1) XP: 0, 100, 300, 600, 1000, … so each level asks 100 XP more than
# the one before.
_LEVEL_STEP = 50


def level_start(level: int) -> int:
    return _LEVEL_STEP * level * (level - 1)


def level_for(xp: int) -> Level:
    level = 1
    while level_start(level + 1) <= xp:
        level += 1
    return Level(level=level, floor=level_start(level), next=level_start(level + 1))


def longest_streak(days: Iterable[date]) -> int:
    """The longest run of consecutive dates."""
    best = run = 0
    previous: date | None = None
    for day in sorted(set(days)):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    return best


class AchievementRecords(Protocol):
    async def unlocks(self, user_id: uuid.UUID) -> list[Unlock]: ...

    async def add_unlocks(self, user_id: uuid.UUID, unlocks: list[Unlock]) -> None: ...

    async def purchases(self, user_id: uuid.UUID) -> list[Purchase]: ...

    async def add_purchase(self, user_id: uuid.UUID, purchase: Purchase) -> None: ...

    async def equipped(self, user_id: uuid.UUID) -> dict[str, str]:
        """Item keys by slot."""
        ...

    async def equip(self, user_id: uuid.UUID, slot: Slot, item_key: str) -> None:
        """Wear the item in its slot, replacing whatever was there."""
        ...

    async def unequip(self, user_id: uuid.UUID, slot: Slot) -> None: ...


class MetricSource(Protocol):
    async def metrics(self, user_id: uuid.UUID) -> Metrics:
        """Every metric for the user; missing ones count as zero."""
        ...


class AchievementService:
    def __init__(
        self,
        records: AchievementRecords,
        metrics: MetricSource,
        transaction: Transaction,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._records = records
        self._metrics = metrics
        self._transaction = transaction
        self._clock = clock

    async def profile(self, user_id: uuid.UUID) -> Profile:
        """Progress, XP, and the store, without unlocking anything."""
        return await self._build(user_id, await self._metrics.metrics(user_id), ())

    async def check(self, user_id: uuid.UUID) -> Profile:
        """Unlock every achievement the user's data now reaches; the profile lists them in
        `new_unlocks`."""
        metrics = await self._metrics.metrics(user_id)
        have = {unlock.key for unlock in await self._records.unlocks(user_id)}
        now = self._clock()
        new = [
            Unlock(key=achievement.key, xp=achievement.xp, unlocked_at=now)
            for achievement in ACHIEVEMENTS
            if achievement.key not in have
            and metrics.get(achievement.metric, 0) >= achievement.target
        ]
        if new:
            try:
                await self._records.add_unlocks(user_id, new)
                await self._transaction.commit()
            except ConflictError:
                # Another request (another tab) unlocked them first; its record stands.
                await self._transaction.rollback()
                new = []
        return await self._build(user_id, metrics, tuple(unlock.key for unlock in new))

    async def buy(self, user_id: uuid.UUID, item_key: str) -> Profile:
        item = REWARDS_BY_KEY.get(item_key)
        if item is None:
            raise RewardNotFoundError
        purchases = await self._records.purchases(user_id)
        if any(purchase.key == item_key for purchase in purchases):
            raise RewardOwnedError
        earned = sum(unlock.xp for unlock in await self._records.unlocks(user_id))
        if level_for(earned).level < item.min_level:
            raise LevelTooLowError
        if earned - sum(purchase.cost for purchase in purchases) < item.cost:
            raise NotEnoughXpError
        try:
            await self._records.add_purchase(
                user_id, Purchase(key=item.key, cost=item.cost, purchased_at=self._clock())
            )
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise RewardOwnedError from None
        return await self.profile(user_id)

    async def equip(self, user_id: uuid.UUID, item_key: str) -> Profile:
        item = REWARDS_BY_KEY.get(item_key)
        if item is None:
            raise RewardNotFoundError
        if not any(purchase.key == item_key for purchase in await self._records.purchases(user_id)):
            raise RewardNotOwnedError
        await self._records.equip(user_id, item.slot, item.key)
        await self._transaction.commit()
        return await self.profile(user_id)

    async def unequip(self, user_id: uuid.UUID, slot: Slot) -> Profile:
        await self._records.unequip(user_id, slot)
        await self._transaction.commit()
        return await self.profile(user_id)

    async def _build(
        self, user_id: uuid.UUID, metrics: Metrics, new_unlocks: tuple[str, ...]
    ) -> Profile:
        unlocks = {unlock.key: unlock for unlock in await self._records.unlocks(user_id)}
        purchases = await self._records.purchases(user_id)
        owned = {purchase.key for purchase in purchases}
        # Only known, owned items count as worn; a retired item quietly drops off.
        equipped: dict[Slot, str] = {
            item.slot: item.key
            for key in (await self._records.equipped(user_id)).values()
            if (item := REWARDS_BY_KEY.get(key)) is not None and key in owned
        }
        earned = sum(unlock.xp for unlock in unlocks.values())
        progress = tuple(
            AchievementProgress(
                achievement=achievement,
                current=min(metrics.get(achievement.metric, 0), achievement.target),
                unlocked_at=unlock.unlocked_at if unlock else None,
                earned_xp=unlock.xp if unlock else None,
            )
            for achievement in ACHIEVEMENTS
            for unlock in (unlocks.get(achievement.key),)
        )
        return Profile(
            earned_xp=earned,
            spent_xp=sum(purchase.cost for purchase in purchases),
            level=level_for(earned),
            achievements=progress,
            store=tuple(
                StoreEntry(
                    item=item,
                    owned=item.key in owned,
                    equipped=equipped.get(item.slot) == item.key,
                )
                for item in REWARDS
            ),
            equipped=equipped,
            new_unlocks=new_unlocks,
        )
