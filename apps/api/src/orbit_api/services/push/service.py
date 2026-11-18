"""Push notifications: who receives them, on which devices, and what they say.

Push is a best-effort copy of what Orbit already recorded. A reminder's in-app notification is
committed before its push is attempted, so a device that can't be reached never delays or fails
the reminder. No database transaction is held open while talking to a push service.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Final, Protocol

from orbit_api.services.notifications.models import Notification
from orbit_api.services.push.models import (
    MAX_DEVICES,
    PushMessage,
    PushPreferences,
    PushSender,
    PushStatus,
    PushSubscription,
    PushUnavailableError,
    check_subscription,
)
from orbit_api.services.transactions import Transaction

_TITLE_LIMIT: Final = 100
_BODY_LIMIT: Final = 200
_REMINDER_TTL_SECONDS: Final = 24 * 60 * 60
_BRIEFING_TTL_SECONDS: Final = 6 * 60 * 60
_TEST_TTL_SECONDS: Final = 5 * 60


class PushRepository(Protocol):
    async def subscriptions(self, user_id: uuid.UUID) -> list[PushSubscription]: ...

    async def save_subscription(
        self, user_id: uuid.UUID, endpoint: str, p256dh: str, auth: str, keep: int
    ) -> None:
        """Add the device or move it to `user_id`, keeping that person's `keep` newest."""
        ...

    async def remove_subscription(self, user_id: uuid.UUID, endpoint: str) -> None: ...

    async def remove_subscriptions(self, ids: Sequence[uuid.UUID]) -> None: ...

    async def preferences(self, user_id: uuid.UUID) -> PushPreferences: ...

    async def save_preferences(self, preferences: PushPreferences, now: datetime) -> None: ...


def _in_app_path(link: str | None, fallback: str) -> str:
    if link is None or not link.startswith("/") or link.startswith(("//", "/\\")):
        return fallback
    return link


def reminder_message(notification: Notification, show_details: bool) -> PushMessage:
    """The push for a delivered reminder; its content only when the person asked for that."""
    return PushMessage(
        title=notification.title[:_TITLE_LIMIT] if show_details else "Orbit",
        body=notification.body[:_BODY_LIMIT] if show_details else "You have a reminder.",
        link=_in_app_path(notification.link, "/reminders"),
        tag=f"reminder-{notification.id}",
        ttl_seconds=_REMINDER_TTL_SECONDS,
        urgency="high",
    )


class PushService:
    def __init__(
        self,
        repository: PushRepository,
        sender: PushSender,
        transaction: Transaction,
    ) -> None:
        self._repository = repository
        self._sender = sender
        self._transaction = transaction

    async def status(self, user_id: uuid.UUID) -> PushStatus:
        return PushStatus(
            public_key=self._sender.public_key(),
            preferences=await self._repository.preferences(user_id),
            devices=len(await self._repository.subscriptions(user_id)),
        )

    async def update_preferences(self, preferences: PushPreferences, now: datetime) -> PushStatus:
        await self._repository.save_preferences(preferences, now)
        await self._transaction.commit()
        return await self.status(preferences.user_id)

    async def subscribe(
        self, user_id: uuid.UUID, endpoint: str, p256dh: str, auth: str
    ) -> PushStatus:
        if self._sender.public_key() is None:
            raise PushUnavailableError
        check_subscription(endpoint, p256dh, auth)
        await self._repository.save_subscription(user_id, endpoint, p256dh, auth, MAX_DEVICES)
        await self._transaction.commit()
        return await self.status(user_id)

    async def unsubscribe(self, user_id: uuid.UUID, endpoint: str) -> PushStatus:
        await self._repository.remove_subscription(user_id, endpoint)
        await self._transaction.commit()
        return await self.status(user_id)

    async def send_test(self, user_id: uuid.UUID) -> int:
        """Send a test notification to the person's devices; return how many accepted it."""
        if self._sender.public_key() is None:
            raise PushUnavailableError
        message = PushMessage(
            title="Orbit",
            body="Push notifications are working on this device.",
            link="/settings/notifications",
            tag="push-test",
            ttl_seconds=_TEST_TTL_SECONDS,
            urgency="high",
        )
        return await self._deliver(user_id, message)

    async def notify_reminder(self, notification: Notification) -> int:
        preferences = await self._repository.preferences(notification.user_id)
        if not preferences.reminders:
            return 0
        message = reminder_message(notification, preferences.show_details)
        return await self._deliver(notification.user_id, message)

    async def notify_briefing(self, user_id: uuid.UUID) -> int:
        preferences = await self._repository.preferences(user_id)
        if not preferences.briefing:
            return 0
        message = PushMessage(
            title="Orbit",
            body="Your daily briefing is ready.",
            link="/",
            tag="daily-briefing",
            ttl_seconds=_BRIEFING_TTL_SECONDS,
            urgency="normal",
        )
        return await self._deliver(user_id, message)

    async def _deliver(self, user_id: uuid.UUID, message: PushMessage) -> int:
        subscriptions = await self._repository.subscriptions(user_id)
        # End the read transaction: the network calls below can take seconds.
        await self._transaction.rollback()
        if not subscriptions:
            return 0
        outcomes = await self._sender.send(subscriptions, message)
        gone = [
            subscription.id
            for subscription, outcome in zip(subscriptions, outcomes, strict=True)
            if outcome == "gone"
        ]
        if gone:
            await self._repository.remove_subscriptions(gone)
            await self._transaction.commit()
        return outcomes.count("sent")
