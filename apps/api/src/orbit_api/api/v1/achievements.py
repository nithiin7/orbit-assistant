"""The signed-in user's achievements, XP, and XP store. Per person: every route acts on the
user from the session only."""

from collections.abc import Generator
from contextlib import contextmanager

from fastapi import APIRouter, HTTPException, status

from orbit_api.api.auth import CurrentUserDep
from orbit_api.api.dependencies import AchievementServiceDep
from orbit_api.schemas.achievements import (
    AchievementProfileResponse,
    RewardItemRequest,
    UnequipRewardRequest,
)
from orbit_api.services.achievements.models import (
    LevelTooLowError,
    NotEnoughXpError,
    RewardNotFoundError,
    RewardNotOwnedError,
    RewardOwnedError,
)

router = APIRouter(
    prefix="/me/achievements",
    tags=["achievements"],
    responses={401: {"description": "Not signed in."}},
)


@contextmanager
def _store_errors() -> Generator[None]:
    """Map store errors to safe HTTP responses."""
    try:
        yield
    except RewardNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store item not found.") from None
    except RewardOwnedError:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already own this item.") from None
    except RewardNotOwnedError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Buy this item before wearing it.") from None
    except LevelTooLowError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Reach a higher level to unlock this item."
        ) from None
    except NotEnoughXpError:
        raise HTTPException(status.HTTP_409_CONFLICT, "You don't have enough XP yet.") from None


_STORE_RESPONSES: dict[int | str, dict[str, str]] = {
    404: {"description": "No store item has that key."},
    409: {"description": "Already owned, not owned, level too low, or not enough XP."},
}


@router.get("", summary="Get achievements, XP, and the store")
async def get_achievements(
    user: CurrentUserDep, achievements: AchievementServiceDep
) -> AchievementProfileResponse:
    """Read-only: achievements newly reached stay locked until a check."""
    return AchievementProfileResponse.of(await achievements.profile(user.id))


@router.post("/check", summary="Unlock achievements the user has reached")
async def check_achievements(
    user: CurrentUserDep, achievements: AchievementServiceDep
) -> AchievementProfileResponse:
    """Counts the user's data and unlocks whatever it now reaches, listing those in
    `new_unlocks`. Safe to repeat: an achievement unlocks once."""
    return AchievementProfileResponse.of(await achievements.check(user.id))


@router.post("/store/purchases", summary="Buy a store item with XP", responses=_STORE_RESPONSES)
async def buy_reward(
    body: RewardItemRequest, user: CurrentUserDep, achievements: AchievementServiceDep
) -> AchievementProfileResponse:
    with _store_errors():
        return AchievementProfileResponse.of(await achievements.buy(user.id, body.item_key))


@router.put("/store/equipped", summary="Wear an owned item", responses=_STORE_RESPONSES)
async def equip_reward(
    body: RewardItemRequest, user: CurrentUserDep, achievements: AchievementServiceDep
) -> AchievementProfileResponse:
    """Replaces whatever was worn in the item's slot."""
    with _store_errors():
        return AchievementProfileResponse.of(await achievements.equip(user.id, body.item_key))


@router.post("/store/unequip", summary="Take off the item in a slot")
async def unequip_reward(
    body: UnequipRewardRequest, user: CurrentUserDep, achievements: AchievementServiceDep
) -> AchievementProfileResponse:
    return AchievementProfileResponse.of(await achievements.unequip(user.id, body.slot))
