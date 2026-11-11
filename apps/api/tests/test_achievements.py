"""Achievements, XP, levels, and the XP store: the catalog, the rules, the routes, and isolation
between people."""

import asyncio
import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.services.achievements.catalog import ACHIEVEMENTS, REWARDS, REWARDS_BY_KEY
from orbit_api.services.achievements.models import (
    LevelTooLowError,
    Metrics,
    NotEnoughXpError,
    Purchase,
    RewardNotFoundError,
    RewardNotOwnedError,
    RewardOwnedError,
    Slot,
    Unlock,
)
from orbit_api.services.achievements.service import (
    AchievementService,
    level_for,
    longest_streak,
)
from tests.support import bearer, sign_up

ACHIEVEMENTS_URL = "/api/v1/me/achievements"
WORKSPACES = "/api/v1/workspaces"
NOW = datetime(2026, 11, 11, 9, 0, tzinfo=UTC)

Headers = dict[str, str]
Json = dict[str, Any]

TIER_XP = {"easy": (15, 25), "medium": (50, 100), "hard": (250, 500), "legendary": (1000, 1000)}


# The catalog


def test_catalog_keys_are_unique() -> None:
    assert len({a.key for a in ACHIEVEMENTS}) == len(ACHIEVEMENTS)
    assert len({r.key for r in REWARDS}) == len(REWARDS)


def test_achievement_xp_fits_its_tier() -> None:
    for achievement in ACHIEVEMENTS:
        low, high = TIER_XP[achievement.tier]
        assert low <= achievement.xp <= high, achievement.key
        assert achievement.target >= 1, achievement.key


def test_every_tier_and_slot_is_used() -> None:
    assert {a.tier for a in ACHIEVEMENTS} == set(TIER_XP)
    assert {r.slot for r in REWARDS} == {"frame", "banner", "title", "confetti"}


# Levels and streaks


@pytest.mark.parametrize(
    ("xp", "level", "floor", "next_"),
    [(0, 1, 0, 100), (99, 1, 0, 100), (100, 2, 100, 300), (299, 2, 100, 300), (600, 4, 600, 1000)],
)
def test_level_for_xp(xp: int, level: int, floor: int, next_: int) -> None:
    result = level_for(xp)
    assert (result.level, result.floor, result.next) == (level, floor, next_)


def test_longest_streak_counts_consecutive_days() -> None:
    days = [date(2026, 1, d) for d in (1, 2, 3, 5, 6, 6, 7, 8)]
    assert longest_streak(days) == 4
    assert longest_streak([]) == 0
    assert longest_streak([date(2026, 12, 31), date(2027, 1, 1)]) == 2


# The service, with in-memory records


class FakeRecords:
    def __init__(self) -> None:
        self.unlocked: dict[str, Unlock] = {}
        self.bought: dict[str, Purchase] = {}
        self.worn: dict[str, str] = {}

    async def unlocks(self, user_id: uuid.UUID) -> list[Unlock]:
        return list(self.unlocked.values())

    async def add_unlocks(self, user_id: uuid.UUID, unlocks: list[Unlock]) -> None:
        self.unlocked.update({unlock.key: unlock for unlock in unlocks})

    async def purchases(self, user_id: uuid.UUID) -> list[Purchase]:
        return list(self.bought.values())

    async def add_purchase(self, user_id: uuid.UUID, purchase: Purchase) -> None:
        self.bought[purchase.key] = purchase

    async def equipped(self, user_id: uuid.UUID) -> dict[str, str]:
        return dict(self.worn)

    async def equip(self, user_id: uuid.UUID, slot: Slot, item_key: str) -> None:
        self.worn[slot] = item_key

    async def unequip(self, user_id: uuid.UUID, slot: Slot) -> None:
        self.worn.pop(slot, None)


class FakeMetrics:
    def __init__(self) -> None:
        self.values: Metrics = {}

    async def metrics(self, user_id: uuid.UUID) -> Metrics:
        return dict(self.values)


class FakeTransaction:
    async def commit(self) -> None: ...

    async def rollback(self) -> None: ...


USER = uuid.uuid4()


def service() -> tuple[AchievementService, FakeRecords, FakeMetrics]:
    records, metrics = FakeRecords(), FakeMetrics()
    return (
        AchievementService(records, metrics, FakeTransaction(), clock=lambda: NOW),
        records,
        metrics,
    )


def earn(records: FakeRecords, xp: int) -> None:
    records.unlocked["bonus"] = Unlock(key="bonus", xp=xp, unlocked_at=NOW)


def test_check_unlocks_once_and_keeps_the_xp() -> None:
    achievements, _, metrics = service()
    metrics.values = {"tasks_completed": 12}

    first = asyncio.run(achievements.check(USER))
    assert set(first.new_unlocks) == {"first_task", "tasks_10"}
    assert first.earned_xp == 40
    assert asyncio.run(achievements.check(USER)).new_unlocks == ()

    # Deleting the data behind an achievement doesn't take it back.
    metrics.values = {}
    profile = asyncio.run(achievements.profile(USER))
    assert profile.earned_xp == 40
    progress = {p.achievement.key: p for p in profile.achievements}
    assert progress["first_task"].unlocked_at == NOW
    assert progress["tasks_100"].unlocked_at is None


def test_profile_reports_progress_without_unlocking() -> None:
    achievements, records, metrics = service()
    metrics.values = {"tasks_completed": 250}

    profile = asyncio.run(achievements.profile(USER))

    assert records.unlocked == {}
    progress = {p.achievement.key: p.current for p in profile.achievements}
    assert progress["tasks_100"] == 100
    assert progress["tasks_500"] == 250


def test_buying_spends_xp_but_keeps_the_level() -> None:
    achievements, records, _ = service()
    earn(records, 150)

    profile = asyncio.run(achievements.buy(USER, "frame_ocean"))

    assert profile.spent_xp == 120
    assert profile.balance == 30
    assert profile.level.level == 2
    assert next(e for e in profile.store if e.item.key == "frame_ocean").owned


def test_buying_checks_the_item_the_level_and_the_balance() -> None:
    achievements, records, _ = service()
    with pytest.raises(RewardNotFoundError):
        asyncio.run(achievements.buy(USER, "frame_unknown"))
    with pytest.raises(NotEnoughXpError):
        asyncio.run(achievements.buy(USER, "frame_sunrise"))
    earn(records, 299)  # Level 2 only.
    with pytest.raises(LevelTooLowError):
        asyncio.run(achievements.buy(USER, "frame_rose"))
    asyncio.run(achievements.buy(USER, "frame_sunrise"))
    with pytest.raises(RewardOwnedError):
        asyncio.run(achievements.buy(USER, "frame_sunrise"))


def test_equip_needs_ownership_and_replaces_the_slot() -> None:
    achievements, records, _ = service()
    earn(records, 1000)
    with pytest.raises(RewardNotOwnedError):
        asyncio.run(achievements.equip(USER, "frame_sunrise"))

    asyncio.run(achievements.buy(USER, "frame_sunrise"))
    asyncio.run(achievements.buy(USER, "frame_ocean"))
    asyncio.run(achievements.equip(USER, "frame_sunrise"))
    profile = asyncio.run(achievements.equip(USER, "frame_ocean"))
    assert profile.equipped == {"frame": "frame_ocean"}
    assert [e.item.key for e in profile.store if e.equipped] == ["frame_ocean"]

    assert asyncio.run(achievements.unequip(USER, "frame")).equipped == {}


def test_retired_items_drop_off_quietly() -> None:
    achievements, records, _ = service()
    records.bought["frame_retired"] = Purchase(key="frame_retired", cost=10, purchased_at=NOW)
    records.worn["frame"] = "frame_retired"

    profile = asyncio.run(achievements.profile(USER))

    assert profile.equipped == {}
    assert profile.spent_xp == 10


# Routes


def personal_id(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return workspace["id"]


def complete_task(client: TestClient, headers: Headers) -> None:
    tasks = f"{WORKSPACES}/{personal_id(client, headers)}/tasks"
    task = client.post(tasks, json={"title": "Water the plants"}, headers=headers).json()
    assert client.post(f"{tasks}/{task['id']}/complete", headers=headers).status_code == 200


def visit(client: TestClient, headers: Headers, country: str) -> None:
    places = f"{WORKSPACES}/{personal_id(client, headers)}/places/items"
    body = {"name": f"Somewhere in {country}", "country_code": country, "status": "visited"}
    assert client.post(places, json=body, headers=headers).status_code == 201


def test_requires_sign_in(client: TestClient) -> None:
    assert client.get(ACHIEVEMENTS_URL).status_code == 401
    assert client.post(f"{ACHIEVEMENTS_URL}/check").status_code == 401


def test_new_account_starts_at_level_one(client: TestClient) -> None:
    ada = bearer(sign_up(client))

    body = client.post(f"{ACHIEVEMENTS_URL}/check", headers=ada).json()

    assert body["earned_xp"] == 0
    assert body["level"] == {"level": 1, "floor_xp": 0, "next_xp": 100}
    assert body["equipped"] == {"frame": None, "banner": None, "title": None, "confetti": None}
    assert len(body["achievements"]) == len(ACHIEVEMENTS)
    assert len(body["store"]) == len(REWARDS)


def test_check_unlocks_from_real_data(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    complete_task(client, ada)
    visit(client, ada, "PT")
    visit(client, ada, "JP")

    # Reading alone unlocks nothing.
    peek = client.get(ACHIEVEMENTS_URL, headers=ada).json()
    assert peek["earned_xp"] == 0
    first_task = next(a for a in peek["achievements"] if a["key"] == "first_task")
    assert first_task["current"] == 1
    assert first_task["unlocked_at"] is None

    checked = client.post(f"{ACHIEVEMENTS_URL}/check", headers=ada).json()
    assert set(checked["new_unlocks"]) == {"first_task", "first_place"}
    assert checked["earned_xp"] == 30
    countries = next(a for a in checked["achievements"] if a["key"] == "countries_5")
    assert (countries["current"], countries["target"]) == (2, 5)

    again = client.post(f"{ACHIEVEMENTS_URL}/check", headers=ada).json()
    assert again["new_unlocks"] == []
    assert again["earned_xp"] == 30


def test_secret_achievements_stay_hidden_until_unlocked(client: TestClient) -> None:
    ada = bearer(sign_up(client))

    body = client.get(ACHIEVEMENTS_URL, headers=ada).json()

    secret = next(a for a in body["achievements"] if a["key"] == "renaissance")
    assert secret["secret"] is True
    assert secret["title"] == "Secret achievement"
    assert "12" not in secret["description"]
    assert (secret["current"], secret["target"]) == (0, 1)


def test_store_errors(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    purchases = f"{ACHIEVEMENTS_URL}/store/purchases"

    missing = client.post(purchases, json={"item_key": "frame_nope"}, headers=ada)
    assert missing.status_code == 404
    poor = client.post(purchases, json={"item_key": "frame_sunrise"}, headers=ada)
    assert poor.status_code == 409
    assert poor.json()["detail"] == "You don't have enough XP yet."
    unowned = client.put(
        f"{ACHIEVEMENTS_URL}/store/equipped", json={"item_key": "frame_sunrise"}, headers=ada
    )
    assert unowned.status_code == 409
    bad_slot = client.post(f"{ACHIEVEMENTS_URL}/store/unequip", json={"slot": "hat"}, headers=ada)
    assert bad_slot.status_code == 422
    assert client.post(purchases, json={}, headers=ada).status_code == 422


def test_buy_equip_and_unequip(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    # 4 easy achievements: 60 XP, just enough for Sunrise.
    complete_task(client, ada)
    visit(client, ada, "PT")
    workspace = f"{WORKSPACES}/{personal_id(client, ada)}"
    note = client.post(f"{workspace}/notes", json={"title": "Hello"}, headers=ada)
    assert note.status_code == 201
    link = {"url": "https://example.com/a"}
    assert client.post(f"{workspace}/bookmarks/items", json=link, headers=ada).status_code == 201
    earned = client.post(f"{ACHIEVEMENTS_URL}/check", headers=ada).json()["earned_xp"]
    assert earned >= REWARDS_BY_KEY["frame_sunrise"].cost, earned

    bought = client.post(
        f"{ACHIEVEMENTS_URL}/store/purchases", json={"item_key": "frame_sunrise"}, headers=ada
    ).json()
    assert bought["spent_xp"] == 60
    assert bought["balance"] == earned - 60
    assert bought["level"]["level"] == level_for(earned).level

    worn = client.put(
        f"{ACHIEVEMENTS_URL}/store/equipped", json={"item_key": "frame_sunrise"}, headers=ada
    ).json()
    assert worn["equipped"]["frame"] == "frame_sunrise"

    again = client.post(
        f"{ACHIEVEMENTS_URL}/store/purchases", json={"item_key": "frame_sunrise"}, headers=ada
    )
    assert again.status_code == 409

    off = client.post(f"{ACHIEVEMENTS_URL}/store/unequip", json={"slot": "frame"}, headers=ada)
    assert off.json()["equipped"]["frame"] is None


def test_one_persons_data_never_counts_for_another(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    grace = bearer(sign_up(client, email="grace@example.com", display_name="Grace"))
    complete_task(client, ada)
    visit(client, ada, "PT")
    client.post(f"{ACHIEVEMENTS_URL}/check", headers=ada)

    graces = client.post(f"{ACHIEVEMENTS_URL}/check", headers=grace).json()

    assert graces["earned_xp"] == 0
    assert graces["new_unlocks"] == []
    first_task = next(a for a in graces["achievements"] if a["key"] == "first_task")
    assert first_task["current"] == 0
