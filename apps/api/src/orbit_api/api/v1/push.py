"""The signed-in person's push notifications: their devices and what they receive."""

from fastapi import APIRouter, HTTPException, status

from orbit_api.api.auth import CurrentUserDep
from orbit_api.api.dependencies import PushServiceDep
from orbit_api.db.columns import utc_now
from orbit_api.schemas.push import (
    PushStatusResponse,
    PushSubscriptionRequest,
    PushTestResponse,
    RemovePushSubscriptionRequest,
    UpdatePushPreferencesRequest,
)
from orbit_api.services.push.models import (
    InvalidPushSubscriptionError,
    PushPreferences,
    PushUnavailableError,
)

router = APIRouter(
    prefix="/me/push",
    tags=["push"],
    responses={401: {"description": "Not signed in."}},
)

_UNAVAILABLE = "Push notifications aren't available on this server."
_UNAVAILABLE_RESPONSE: dict[int | str, dict[str, str]] = {503: {"description": _UNAVAILABLE}}


@router.get("", summary="Get push notification status and preferences")
async def get_push_status(user: CurrentUserDep, push: PushServiceDep) -> PushStatusResponse:
    return PushStatusResponse.of(await push.status(user.id))


@router.put("/preferences", summary="Choose what push notifications to receive")
async def update_push_preferences(
    body: UpdatePushPreferencesRequest, user: CurrentUserDep, push: PushServiceDep
) -> PushStatusResponse:
    preferences = PushPreferences(
        user_id=user.id,
        reminders=body.reminders,
        briefing=body.briefing,
        show_details=body.show_details,
    )
    return PushStatusResponse.of(await push.update_preferences(preferences, utc_now()))


@router.put(
    "/subscriptions",
    summary="Turn push notifications on for this device",
    responses={
        **_UNAVAILABLE_RESPONSE,
        422: {"description": "The subscription isn't from a known browser push service."},
    },
)
async def save_push_subscription(
    body: PushSubscriptionRequest, user: CurrentUserDep, push: PushServiceDep
) -> PushStatusResponse:
    try:
        result = await push.subscribe(user.id, body.endpoint, body.p256dh, body.auth)
    except PushUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, _UNAVAILABLE) from exc
    except InvalidPushSubscriptionError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "This browser's push service isn't supported.",
        ) from exc
    return PushStatusResponse.of(result)


@router.post("/subscriptions/remove", summary="Turn push notifications off for this device")
async def remove_push_subscription(
    body: RemovePushSubscriptionRequest, user: CurrentUserDep, push: PushServiceDep
) -> PushStatusResponse:
    return PushStatusResponse.of(await push.unsubscribe(user.id, body.endpoint))


@router.post(
    "/test", summary="Send a test notification to your devices", responses=_UNAVAILABLE_RESPONSE
)
async def send_push_test(user: CurrentUserDep, push: PushServiceDep) -> PushTestResponse:
    try:
        return PushTestResponse(sent=await push.send_test(user.id))
    except PushUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, _UNAVAILABLE) from exc
