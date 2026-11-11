"""Access tokens for provider calls: decrypting, refreshing before expiry, and noticing revoked
consent.

Refreshing is serialized twice over: an in-process lock per connection (so the API's requests and
the embedded worker don't refresh together) and an optimistic `token_version` check in the
database (so separate processes can't overwrite each other's newer tokens). A process that loses
the race uses the winner's tokens.
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Final, Protocol

from orbit_api.services.integrations.connectors import ConnectorRegistry, ReauthRequiredError
from orbit_api.services.integrations.models import (
    Connection,
    ConnectionNotFoundError,
    ProviderNotConfiguredError,
)
from orbit_api.services.integrations.store import IntegrationStore, SecretBox
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

# Refresh a little early, so a token never expires mid-request.
EXPIRY_MARGIN: Final = timedelta(minutes=2)

_locks: dict[uuid.UUID, asyncio.Lock] = {}


def _lock(connection_id: uuid.UUID) -> asyncio.Lock:
    lock = _locks.get(connection_id)
    if lock is None:
        lock = _locks[connection_id] = asyncio.Lock()
    return lock


class Notifier(Protocol):
    async def notify(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        title: str,
        body: str,
        link: str | None = None,
    ) -> None: ...


class TokenManager:
    def __init__(
        self,
        store: IntegrationStore,
        secrets: SecretBox,
        registry: ConnectorRegistry,
        transaction: Transaction,
        notifier: Notifier,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._secrets = secrets
        self._registry = registry
        self._transaction = transaction
        self._notifier = notifier
        self._clock = clock

    async def call[T](self, connection: Connection, action: Callable[[str], Awaitable[T]]) -> T:
        """Run `action` with a valid access token. A refused token is refreshed once and retried
        (consent can be revoked before the token expires); refused again, the connection needs
        to be reconnected."""
        token = await self.access_token(connection)
        try:
            return await action(token)
        except ReauthRequiredError:
            pass
        token = await self.access_token(connection, force=True)
        try:
            return await action(token)
        except ReauthRequiredError:
            await self.mark_reauth_required(connection)
            raise

    async def access_token(self, connection: Connection, *, force: bool = False) -> str:
        if not force and self._fresh(connection):
            return self._secrets.decrypt(connection.access_token_ciphertext)
        async with _lock(connection.id):
            current = await self._store.connection_by_id(connection.id)
            if current is None:
                raise ConnectionNotFoundError
            if current.token_version != connection.token_version or (
                not force and self._fresh(current)
            ):
                # Someone else refreshed while we waited.
                return self._secrets.decrypt(current.access_token_ciphertext)
            if current.refresh_token_ciphertext is None:
                await self.mark_reauth_required(current)
                raise ReauthRequiredError
            connector = self._registry.get(current.provider)
            if connector is None:
                raise ProviderNotConfiguredError
            try:
                tokens = await connector.oauth.refresh(
                    self._secrets.decrypt(current.refresh_token_ciphertext)
                )
            except ReauthRequiredError:
                await self.mark_reauth_required(current)
                raise
            refresh = (
                self._secrets.encrypt(tokens.refresh_token)
                if tokens.refresh_token
                else current.refresh_token_ciphertext
            )
            stored = await self._store.update_tokens(
                current.id,
                current.token_version,
                self._secrets.encrypt(tokens.access_token),
                refresh,
                tokens.expires_at,
                self._clock(),
            )
            await self._transaction.commit()
            if stored:
                return tokens.access_token
            latest = await self._store.connection_by_id(current.id)
            if latest is None:
                raise ConnectionNotFoundError
            return self._secrets.decrypt(latest.access_token_ciphertext)

    async def mark_reauth_required(self, connection: Connection) -> None:
        current = await self._store.connection_by_id(connection.id)
        if current is None or current.status == "reauth_required":
            return
        now = self._clock()
        await self._store.save_connection(
            replace(
                current,
                status="reauth_required",
                last_error=ReauthRequiredError.message,
                updated_at=now,
            )
        )
        await self._notifier.notify(
            current.user_id,
            current.workspace_id,
            f"Reconnect {current.account_email}",
            "Orbit lost access to this account, so it stopped synchronizing. Your imported "
            "data is kept. Reconnect it in Settings → Integrations.",
            link="/integrations",
        )
        await self._transaction.commit()

    def _fresh(self, connection: Connection) -> bool:
        expires = connection.token_expires_at
        return expires is None or expires > self._clock() + EXPIRY_MARGIN
