"""The signed-in user's profile."""

from fastapi import APIRouter

from orbit_api.api.auth import CurrentUserDep
from orbit_api.api.dependencies import AccountServiceDep
from orbit_api.schemas.users import UpdateProfileRequest, UserProfile

router = APIRouter(
    prefix="/me", tags=["account"], responses={401: {"description": "Not signed in."}}
)


@router.get("", summary="Get the signed-in user's profile")
async def get_profile(user: CurrentUserDep) -> UserProfile:
    """In cloud mode, the first call for a new Supabase user creates the profile and its
    Personal workspace."""
    return UserProfile.of(user)


@router.patch("", summary="Update the signed-in user's profile")
async def update_profile(
    body: UpdateProfileRequest, user: CurrentUserDep, accounts: AccountServiceDep
) -> UserProfile:
    updated = await accounts.update_profile(user.id, display_name=body.display_name)
    return UserProfile.of(updated)
