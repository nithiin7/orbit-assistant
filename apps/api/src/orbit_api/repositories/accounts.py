"""User profiles, local credentials, and local sessions."""

import uuid
from datetime import datetime
from typing import cast

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import LocalCredentialModel, LocalSessionModel, UserModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.accounts.models import AuthProvider, User
from orbit_api.services.local_auth.models import LocalCredential
from orbit_api.utils.changes import UNSET, Change


def _to_user(model: UserModel) -> User:
    return User(
        id=model.id,
        # Guaranteed by the `ck_users_auth_provider` constraint.
        auth_provider=cast(AuthProvider, model.auth_provider),
        email=model.email,
        display_name=model.display_name,
        created_at=model.created_at,
        timezone=model.timezone,
    )


class SqlAccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: uuid.UUID) -> User | None:
        model = await self._session.get(UserModel, user_id)
        return _to_user(model) if model else None

    async def find_by_identity(self, provider: AuthProvider, subject: str) -> User | None:
        model = await self._session.scalar(
            select(UserModel).where(
                UserModel.auth_provider == provider, UserModel.auth_subject == subject
            )
        )
        return _to_user(model) if model else None

    async def add(self, user: User, *, auth_subject: str) -> None:
        self._session.add(
            UserModel(
                id=user.id,
                auth_provider=user.auth_provider,
                auth_subject=auth_subject,
                email=user.email,
                display_name=user.display_name,
                created_at=user.created_at,
                updated_at=user.created_at,
            )
        )
        # Flush now so dependent rows (workspace, credential) insert after the user.
        await flush(self._session)

    async def update(
        self,
        user_id: uuid.UUID,
        *,
        email: str | None = None,
        display_name: str | None = None,
        timezone: Change[str | None] = UNSET,
    ) -> User:
        model = await self._session.get_one(UserModel, user_id)
        if email is not None:
            model.email = email
        if display_name is not None:
            model.display_name = display_name
        if timezone is not UNSET:
            model.timezone = timezone
        await flush(self._session)
        return _to_user(model)

    async def count(self, provider: AuthProvider) -> int:
        count = await self._session.scalar(
            select(func.count()).select_from(UserModel).where(UserModel.auth_provider == provider)
        )
        return count or 0


class SqlLocalAuthRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def find_credential(self, email: str) -> LocalCredential | None:
        model = await self._session.scalar(
            select(LocalCredentialModel).where(LocalCredentialModel.email == email)
        )
        if model is None:
            return None
        return LocalCredential(user_id=model.user_id, password_hash=model.password_hash)

    async def add_credential(self, user_id: uuid.UUID, email: str, password_hash: str) -> None:
        self._session.add(
            LocalCredentialModel(user_id=user_id, email=email, password_hash=password_hash)
        )
        await flush(self._session)

    async def update_password_hash(self, user_id: uuid.UUID, password_hash: str) -> None:
        model = await self._session.get_one(LocalCredentialModel, user_id)
        model.password_hash = password_hash
        await flush(self._session)

    async def add_session(
        self, user_id: uuid.UUID, token_hash: str, created_at: datetime, expires_at: datetime
    ) -> None:
        self._session.add(
            LocalSessionModel(
                id=uuid.uuid4(),
                user_id=user_id,
                token_hash=token_hash,
                created_at=created_at,
                expires_at=expires_at,
            )
        )
        await flush(self._session)

    async def find_session_user(self, token_hash: str, now: datetime) -> User | None:
        model = await self._session.scalar(
            select(UserModel)
            .join(LocalSessionModel, LocalSessionModel.user_id == UserModel.id)
            .where(
                LocalSessionModel.token_hash == token_hash,
                LocalSessionModel.expires_at > now,
                UserModel.auth_provider == "local",
            )
        )
        return _to_user(model) if model else None

    async def delete_session(self, token_hash: str) -> None:
        await self._session.execute(
            delete(LocalSessionModel).where(LocalSessionModel.token_hash == token_hash)
        )

    async def delete_expired_sessions(self, user_id: uuid.UUID, now: datetime) -> None:
        await self._session.execute(
            delete(LocalSessionModel).where(
                LocalSessionModel.user_id == user_id, LocalSessionModel.expires_at <= now
            )
        )
