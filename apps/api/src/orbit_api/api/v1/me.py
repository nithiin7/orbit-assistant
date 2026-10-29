"""The signed-in user's profile, profile photo, and dashboard layout."""

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status

from orbit_api.api.auth import CurrentUserDep
from orbit_api.api.dependencies import AccountServiceDep, AvatarServiceDep, DashboardServiceDep
from orbit_api.schemas.dashboard import DashboardLayoutRequest, DashboardLayoutResponse
from orbit_api.schemas.users import UpdateProfileRequest, UserProfile
from orbit_api.services.avatars.models import AvatarTooLargeError, UnsupportedImageError
from orbit_api.services.avatars.service import MAX_AVATAR_BYTES
from orbit_api.services.dashboard.models import DuplicateWidgetError

router = APIRouter(
    prefix="/me", tags=["account"], responses={401: {"description": "Not signed in."}}
)

_IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
_IMAGE_CONTENT: dict[str, Any] = {
    content_type: {"schema": {"type": "string", "format": "binary"}}
    for content_type in _IMAGE_TYPES
}


@router.get("", summary="Get the signed-in user's profile")
async def get_profile(user: CurrentUserDep) -> UserProfile:
    """In cloud mode, the first call for a new Supabase user creates the profile and its
    Personal workspace."""
    return UserProfile.of(user)


@router.patch("", summary="Update the signed-in user's profile")
async def update_profile(
    body: UpdateProfileRequest, user: CurrentUserDep, accounts: AccountServiceDep
) -> UserProfile:
    updated = await accounts.update_profile(
        user.id, display_name=body.display_name, timezone=body.timezone_change
    )
    return UserProfile.of(updated)


@router.get(
    "/avatar",
    summary="Get the signed-in user's profile photo",
    response_class=Response,
    responses={
        200: {"content": _IMAGE_CONTENT, "description": "The photo."},
        204: {"description": "No photo is set."},
    },
)
async def get_avatar(user: CurrentUserDep, avatars: AvatarServiceDep) -> Response:
    avatar = await avatars.get(user.id)
    if avatar is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return Response(
        content=avatar.data,
        media_type=avatar.content_type,
        headers={
            "Cache-Control": "private, no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )


@router.put(
    "/avatar",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set the signed-in user's profile photo",
    openapi_extra={"requestBody": {"required": True, "content": _IMAGE_CONTENT}},
    responses={
        413: {"description": f"The image is larger than {MAX_AVATAR_BYTES // 1024} KB."},
        415: {"description": "The image is not a PNG, JPEG, or WebP file."},
    },
)
async def put_avatar(request: Request, user: CurrentUserDep, avatars: AvatarServiceDep) -> Response:
    """The request body is the image itself. Its format is detected from the file, not from
    the declared content type."""
    data = await _read_body(request, limit=MAX_AVATAR_BYTES)
    try:
        await avatars.replace(user.id, data)
    except AvatarTooLargeError:
        raise _too_large() from None
    except UnsupportedImageError:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a PNG, JPEG, or WebP image."
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/avatar",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove the signed-in user's profile photo",
)
async def delete_avatar(user: CurrentUserDep, avatars: AvatarServiceDep) -> Response:
    await avatars.remove(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/dashboard",
    summary="Get the signed-in user's dashboard layout",
    response_model=DashboardLayoutResponse,
    responses={204: {"description": "No layout is saved; show the default dashboard."}},
)
async def get_dashboard(
    user: CurrentUserDep, dashboard: DashboardServiceDep
) -> DashboardLayoutResponse | Response:
    """Widgets a newer layout used but this version doesn't know are left out."""
    layout = await dashboard.get(user.id)
    if layout is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return DashboardLayoutResponse.of(layout)


@router.put("/dashboard", summary="Save the signed-in user's dashboard layout")
async def put_dashboard(
    body: DashboardLayoutRequest, user: CurrentUserDep, dashboard: DashboardServiceDep
) -> DashboardLayoutResponse:
    try:
        layout = await dashboard.replace(
            user.id, tuple(widget.to_widget() for widget in body.widgets)
        )
    except DuplicateWidgetError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Each widget can appear only once."
        ) from None
    return DashboardLayoutResponse.of(layout)


@router.delete(
    "/dashboard",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Reset the signed-in user's dashboard to the default layout",
)
async def delete_dashboard(user: CurrentUserDep, dashboard: DashboardServiceDep) -> Response:
    await dashboard.reset(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _read_body(request: Request, *, limit: int) -> bytes:
    """Read the body, stopping as soon as it exceeds `limit` rather than buffering it all."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise _too_large()
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise _too_large()
    return bytes(body)


def _too_large() -> HTTPException:
    return HTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE,
        f"The photo must be smaller than {MAX_AVATAR_BYTES // 1024} KB.",
    )
