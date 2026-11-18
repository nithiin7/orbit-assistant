"""Push subscriptions and preferences. Every query is filtered by person, except removing
subscriptions a push service reported as gone, which the service looks up for that person first."""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.columns import utc_now
from orbit_api.db.models import PushPreferencesModel, PushSubscriptionModel
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.push.models import PushPreferences, PushSender, PushSubscription
from orbit_api.services.push.service import PushService


class SqlPushRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def subscriptions(self, user_id: uuid.UUID) -> list[PushSubscription]:
        models = await self._session.scalars(
            select(PushSubscriptionModel).where(PushSubscriptionModel.user_id == user_id)
        )
        return [
            PushSubscription(
                id=model.id,
                user_id=model.user_id,
                endpoint=model.endpoint,
                p256dh=model.p256dh,
                auth=model.auth,
            )
            for model in models
        ]

    async def save_subscription(
        self, user_id: uuid.UUID, endpoint: str, p256dh: str, auth: str, keep: int
    ) -> None:
        now = utc_now()
        model = await self._session.scalar(
            select(PushSubscriptionModel).where(PushSubscriptionModel.endpoint == endpoint)
        )
        if model is None:
            self._session.add(
                PushSubscriptionModel(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    endpoint=endpoint,
                    p256dh=p256dh,
                    auth=auth,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            model.user_id = user_id
            model.p256dh = p256dh
            model.auth = auth
            model.updated_at = now
        await flush(self._session)

        extra = await self._session.scalars(
            select(PushSubscriptionModel.id)
            .where(PushSubscriptionModel.user_id == user_id)
            .order_by(PushSubscriptionModel.updated_at.desc(), PushSubscriptionModel.id)
            .offset(keep)
        )
        await self.remove_subscriptions(list(extra))

    async def remove_subscription(self, user_id: uuid.UUID, endpoint: str) -> None:
        await self._session.execute(
            delete(PushSubscriptionModel).where(
                PushSubscriptionModel.user_id == user_id,
                PushSubscriptionModel.endpoint == endpoint,
            )
        )

    async def remove_subscriptions(self, ids: Sequence[uuid.UUID]) -> None:
        if ids:
            await self._session.execute(
                delete(PushSubscriptionModel).where(PushSubscriptionModel.id.in_(ids))
            )

    async def preferences(self, user_id: uuid.UUID) -> PushPreferences:
        model = await self._session.get(PushPreferencesModel, user_id)
        if model is None:
            return PushPreferences(user_id=user_id)
        return PushPreferences(
            user_id=model.user_id,
            reminders=model.reminders,
            briefing=model.briefing,
            show_details=model.show_details,
        )

    async def save_preferences(self, preferences: PushPreferences, now: datetime) -> None:
        model = await self._session.get(PushPreferencesModel, preferences.user_id)
        if model is None:
            model = PushPreferencesModel(user_id=preferences.user_id)
            self._session.add(model)
        model.reminders = preferences.reminders
        model.briefing = preferences.briefing
        model.show_details = preferences.show_details
        model.updated_at = now
        await flush(self._session)


def build_push_service(session: AsyncSession, sender: PushSender) -> PushService:
    return PushService(SqlPushRepository(session), sender, SqlTransaction(session))
