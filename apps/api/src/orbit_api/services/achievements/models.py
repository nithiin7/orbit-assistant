"""Achievement, XP, and store types."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

Tier = Literal["easy", "medium", "hard", "legendary"]
Slot = Literal["frame", "banner", "title", "confetti"]
Area = Literal[
    "tasks",
    "habits",
    "notes",
    "shopping",
    "reminders",
    "calendar",
    "documents",
    "places",
    "watchlist",
    "saved",
    "finance",
    "health",
    "orbit",
]

# What the metrics source counts for a user. Each achievement watches one of these.
Metric = Literal[
    "tasks_completed",
    "inbox_zero",
    "habit_checkins",
    "habit_streak",
    "routines_completed",
    "notes",
    "shopping_purchased",
    "reminders",
    "events",
    "documents",
    "places_visited",
    "countries",
    "watched",
    "bookmarks",
    "transactions",
    "budgets",
    "savings_goals_completed",
    "workouts",
    "food_days",
    "water_days",
    "fitness_goals_completed",
    "areas_used",
]

Metrics = dict[Metric, int]


@dataclass(frozen=True, slots=True)
class Achievement:
    key: str
    title: str
    description: str
    area: Area
    tier: Tier
    xp: int
    metric: Metric
    target: int
    # Hidden ones show as a mystery until unlocked.
    secret: bool = False


@dataclass(frozen=True, slots=True)
class RewardItem:
    key: str
    slot: Slot
    name: str
    description: str
    cost: int
    # The level a user must reach before buying it.
    min_level: int = 1


@dataclass(frozen=True, slots=True)
class Unlock:
    key: str
    xp: int
    unlocked_at: datetime


@dataclass(frozen=True, slots=True)
class Purchase:
    key: str
    cost: int
    purchased_at: datetime


@dataclass(frozen=True, slots=True)
class Level:
    level: int
    # Total XP where this level starts and where the next one does.
    floor: int
    next: int


@dataclass(frozen=True, slots=True)
class AchievementProgress:
    achievement: Achievement
    # The metric's value, capped at the target.
    current: int
    unlocked_at: datetime | None
    # The XP actually earned, when unlocked.
    earned_xp: int | None


@dataclass(frozen=True, slots=True)
class StoreEntry:
    item: RewardItem
    owned: bool
    equipped: bool


@dataclass(frozen=True, slots=True)
class Profile:
    earned_xp: int
    spent_xp: int
    level: Level
    achievements: tuple[AchievementProgress, ...]
    store: tuple[StoreEntry, ...]
    equipped: dict[Slot, str]
    # Keys unlocked by the call that built this profile, for an unlock toast.
    new_unlocks: tuple[str, ...]

    @property
    def balance(self) -> int:
        return self.earned_xp - self.spent_xp


class RewardNotFoundError(Exception):
    """No store item has that key."""


class RewardOwnedError(Exception):
    """The item was already bought."""


class RewardNotOwnedError(Exception):
    """Only bought items can be worn."""


class NotEnoughXpError(Exception):
    """The XP balance is below the item's cost."""


class LevelTooLowError(Exception):
    """The item needs a higher level."""
