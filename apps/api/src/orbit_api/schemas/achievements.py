"""Achievement, XP, and store models."""

from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from orbit_api.services.achievements.models import (
    AchievementProgress,
    Area,
    Profile,
    Slot,
    StoreEntry,
    Tier,
)

ItemKey = Annotated[str, StringConstraints(min_length=1, max_length=64)]

SECRET_TITLE = "Secret achievement"
SECRET_DESCRIPTION = "Keep exploring Orbit to discover this one."


class AchievementResponse(BaseModel):
    key: str
    title: str
    description: str
    area: Area
    tier: Tier
    xp: int
    # How far along, capped at `target`.
    current: int
    target: int
    secret: bool
    unlocked_at: datetime | None
    earned_xp: int | None

    @classmethod
    def of(cls, progress: AchievementProgress) -> Self:
        achievement = progress.achievement
        # A secret stays a mystery, progress included, until it is unlocked.
        hidden = achievement.secret and progress.unlocked_at is None
        return cls(
            key=achievement.key,
            title=SECRET_TITLE if hidden else achievement.title,
            description=SECRET_DESCRIPTION if hidden else achievement.description,
            area=achievement.area,
            tier=achievement.tier,
            xp=achievement.xp,
            current=0 if hidden else progress.current,
            target=1 if hidden else achievement.target,
            secret=achievement.secret,
            unlocked_at=progress.unlocked_at,
            earned_xp=progress.earned_xp,
        )


class RewardItemResponse(BaseModel):
    key: str
    slot: Slot
    name: str
    description: str
    cost: int
    min_level: int
    owned: bool
    equipped: bool

    @classmethod
    def of(cls, entry: StoreEntry) -> Self:
        item = entry.item
        return cls(
            key=item.key,
            slot=item.slot,
            name=item.name,
            description=item.description,
            cost=item.cost,
            min_level=item.min_level,
            owned=entry.owned,
            equipped=entry.equipped,
        )


class AchievementLevelResponse(BaseModel):
    level: int
    # Total XP where this level starts and where the next one does.
    floor_xp: int
    next_xp: int


class EquippedRewardsResponse(BaseModel):
    """The item key worn in each slot; empty slots are null."""

    frame: str | None
    banner: str | None
    title: str | None
    confetti: str | None


class AchievementProfileResponse(BaseModel):
    earned_xp: int
    spent_xp: int
    balance: int
    level: AchievementLevelResponse
    achievements: list[AchievementResponse]
    store: list[RewardItemResponse]
    equipped: EquippedRewardsResponse
    new_unlocks: list[str] = Field(
        description="Achievements unlocked by this request, for a celebration."
    )

    @classmethod
    def of(cls, profile: Profile) -> Self:
        return cls(
            earned_xp=profile.earned_xp,
            spent_xp=profile.spent_xp,
            balance=profile.balance,
            level=AchievementLevelResponse(
                level=profile.level.level,
                floor_xp=profile.level.floor,
                next_xp=profile.level.next,
            ),
            achievements=[AchievementResponse.of(progress) for progress in profile.achievements],
            store=[RewardItemResponse.of(entry) for entry in profile.store],
            equipped=EquippedRewardsResponse(
                frame=profile.equipped.get("frame"),
                banner=profile.equipped.get("banner"),
                title=profile.equipped.get("title"),
                confetti=profile.equipped.get("confetti"),
            ),
            new_unlocks=list(profile.new_unlocks),
        )


class RewardItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_key: ItemKey


class UnequipRewardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slot: Slot
