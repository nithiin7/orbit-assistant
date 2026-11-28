"""App lock settings, device keys, and session lock state. Every query is filtered by person,
except looking up a session by its key, which the service checks belongs to the caller."""

import uuid
from datetime import datetime
from typing import Any, cast

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import AppLockCredentialModel, AppLockSessionModel, AppLockSettingsModel
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.app_lock.models import (
    DeviceAuthenticator,
    LockCredential,
    LockSession,
    LockSettings,
    RegisteredKey,
)
from orbit_api.services.app_lock.service import AppLockService
from orbit_api.services.local_auth.service import PasswordHasher


class SqlAppLockRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def settings(self, user_id: uuid.UUID) -> LockSettings | None:
        model = await self._session.get(AppLockSettingsModel, user_id)
        if model is None:
            return None
        return LockSettings(
            user_id=model.user_id,
            pin_hash=model.pin_hash,
            pin_length=model.pin_length,
            lock_after_minutes=model.lock_after_minutes,
            sign_out_after_minutes=model.sign_out_after_minutes,
        )

    async def save_settings(self, settings: LockSettings) -> None:
        model = await self._session.get(AppLockSettingsModel, settings.user_id)
        if model is None:
            model = AppLockSettingsModel(user_id=settings.user_id)
            self._session.add(model)
        model.pin_hash = settings.pin_hash
        model.pin_length = settings.pin_length
        model.lock_after_minutes = settings.lock_after_minutes
        model.sign_out_after_minutes = settings.sign_out_after_minutes
        await flush(self._session)

    async def delete_all(self, user_id: uuid.UUID) -> None:
        for model in (AppLockSessionModel, AppLockCredentialModel, AppLockSettingsModel):
            await self._session.execute(delete(model).where(model.user_id == user_id))

    async def session(self, session_key: str) -> LockSession | None:
        model = await self._session.get(AppLockSessionModel, session_key)
        if model is None:
            return None
        return LockSession(
            session_key=model.session_key,
            user_id=model.user_id,
            created_at=model.created_at,
            last_active_at=model.last_active_at,
            locked_at=model.locked_at,
            ended_at=model.ended_at,
            failed_attempts=model.failed_attempts,
            challenge=model.challenge,
            challenge_expires_at=model.challenge_expires_at,
        )

    async def add_session(self, session: LockSession) -> None:
        self._session.add(
            AppLockSessionModel(
                session_key=session.session_key,
                user_id=session.user_id,
                created_at=session.created_at,
                last_active_at=session.last_active_at,
                failed_attempts=0,
            )
        )
        await flush(self._session)

    async def save_session(self, session: LockSession) -> None:
        model = await self._session.get(AppLockSessionModel, session.session_key)
        if model is None or model.user_id != session.user_id:
            return
        model.last_active_at = session.last_active_at
        model.locked_at = session.locked_at
        model.ended_at = session.ended_at
        model.failed_attempts = session.failed_attempts
        model.challenge = session.challenge
        model.challenge_expires_at = session.challenge_expires_at
        await flush(self._session)

    async def delete_stale_sessions(self, user_id: uuid.UUID, before: datetime) -> None:
        await self._session.execute(
            delete(AppLockSessionModel).where(
                AppLockSessionModel.user_id == user_id,
                AppLockSessionModel.last_active_at < before,
            )
        )

    async def credentials(self, user_id: uuid.UUID) -> list[LockCredential]:
        models = await self._session.scalars(
            select(AppLockCredentialModel)
            .where(AppLockCredentialModel.user_id == user_id)
            .order_by(AppLockCredentialModel.created_at, AppLockCredentialModel.id)
        )
        return [_to_credential(model) for model in models]

    async def add_credential(
        self, user_id: uuid.UUID, key: RegisteredKey, rp_id: str, label: str, now: datetime
    ) -> None:
        self._session.add(
            AppLockCredentialModel(
                id=uuid.uuid4(),
                user_id=user_id,
                credential_id=key.credential_id,
                public_key=key.public_key,
                sign_count=key.sign_count,
                rp_id=rp_id,
                label=label,
                created_at=now,
            )
        )
        await flush(self._session)

    async def find_credential(
        self, user_id: uuid.UUID, credential_id: bytes
    ) -> LockCredential | None:
        model = await self._session.scalar(
            select(AppLockCredentialModel).where(
                AppLockCredentialModel.user_id == user_id,
                AppLockCredentialModel.credential_id == credential_id,
            )
        )
        return _to_credential(model) if model else None

    async def credential_used(self, id: uuid.UUID, sign_count: int, now: datetime) -> None:
        model = await self._session.get(AppLockCredentialModel, id)
        if model is not None:
            model.sign_count = sign_count
            model.last_used_at = now
            await flush(self._session)

    async def delete_credential(self, user_id: uuid.UUID, id: uuid.UUID) -> bool:
        result = await self._session.execute(
            delete(AppLockCredentialModel).where(
                AppLockCredentialModel.user_id == user_id, AppLockCredentialModel.id == id
            )
        )
        return cast(CursorResult[Any], result).rowcount > 0


def _to_credential(model: AppLockCredentialModel) -> LockCredential:
    return LockCredential(
        id=model.id,
        user_id=model.user_id,
        credential_id=model.credential_id,
        public_key=model.public_key,
        sign_count=model.sign_count,
        rp_id=model.rp_id,
        label=model.label,
        created_at=model.created_at,
        last_used_at=model.last_used_at,
    )


def build_app_lock_service(
    session: AsyncSession, hasher: PasswordHasher, devices: DeviceAuthenticator
) -> AppLockService:
    return AppLockService(SqlAppLockRepository(session), SqlTransaction(session), hasher, devices)
