"""The signed-in user's notifications. Every route is scoped to `CurrentUserDep`."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status

from orbit_api.api.auth import CurrentUserDep
from orbit_api.api.dependencies import NotificationServiceDep
from orbit_api.schemas.notifications import (
    MarkAllReadResponse,
    NotificationListParams,
    NotificationListResponse,
    NotificationResponse,
    UnreadCountResponse,
    UpdateNotificationRequest,
)
from orbit_api.services.notifications.models import NotificationNotFoundError

router = APIRouter(
    prefix="/me/notifications",
    tags=["notifications"],
    responses={401: {"description": "Not signed in."}},
)

NotificationId = Annotated[uuid.UUID, Path(description="The notification's ID.")]


@router.get("", summary="List the signed-in user's notifications")
async def list_notifications(
    params: Annotated[NotificationListParams, Query()],
    user: CurrentUserDep,
    notifications: NotificationServiceDep,
) -> NotificationListResponse:
    """Newest first, from every workspace the user owns."""
    page = await notifications.find(user.id, params.to_query())
    return NotificationListResponse(
        notifications=[NotificationResponse.of(item) for item in page.notifications],
        total=page.total,
        unread=page.unread,
    )


@router.get("/unread-count", summary="Count the signed-in user's unread notifications")
async def count_unread(
    user: CurrentUserDep, notifications: NotificationServiceDep
) -> UnreadCountResponse:
    """Cheap enough to poll."""
    return UnreadCountResponse(unread=await notifications.unread_count(user.id))


@router.post("/read-all", summary="Mark every notification read")
async def mark_all_read(
    user: CurrentUserDep, notifications: NotificationServiceDep
) -> MarkAllReadResponse:
    return MarkAllReadResponse(count=await notifications.mark_all_read(user.id))


@router.patch(
    "/{notification_id}",
    summary="Mark a notification read or unread",
    responses={404: {"description": "The notification does not exist or is someone else's."}},
)
async def update_notification(
    notification_id: NotificationId,
    body: UpdateNotificationRequest,
    user: CurrentUserDep,
    notifications: NotificationServiceDep,
) -> NotificationResponse:
    try:
        notification = await notifications.set_read(user.id, notification_id, read=body.read)
    except NotificationNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.") from None
    return NotificationResponse.of(notification)
