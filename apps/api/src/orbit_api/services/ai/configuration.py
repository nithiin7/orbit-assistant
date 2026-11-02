"""AI settings and provider connections, and choosing a provider for each request.

Policy is enforced here, in code, before any data leaves Orbit:

- AI does nothing unless the server allows it and the person turned it on.
- A provider in the cloud is used only if the person allowed cloud processing; otherwise the
  request is refused, never silently redirected.
- There is no automatic fallback. A fallback provider is used only if the person chose one,
  and it passes the same checks.
- API keys are encrypted on the way in and decrypted only to build an adapter. They are never
  returned, logged, or included in errors.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol

from orbit_api.services.ai.endpoints import Resolver, check_endpoint
from orbit_api.services.ai.models import (
    AiDisabledError,
    AiModule,
    AiNotConfiguredError,
    AiSettings,
    CloudProcessingNotAllowedError,
    ModelInfo,
    Processing,
    ProviderConnection,
    ProviderKind,
    ProviderNameTakenError,
    ProviderNotFoundError,
    ResponseStyle,
    UsageOperation,
)
from orbit_api.services.ai.providers import (
    DEFAULT_BASE_URLS,
    KEY_REQUIRED,
    AiProvider,
    ProviderError,
    ProviderFactory,
    ProviderRequestError,
    base_url_of,
    processing_of,
)
from orbit_api.services.ai.usage import Meter, MeteredProvider, UsageService
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.clock import utc_now


class SettingsRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> AiSettings | None: ...

    async def put(self, settings: AiSettings) -> None: ...


class ProviderRepository(Protocol):
    async def list(self, user_id: uuid.UUID) -> list[ProviderConnection]: ...

    async def get(
        self, user_id: uuid.UUID, provider_id: uuid.UUID
    ) -> ProviderConnection | None: ...

    async def add(self, connection: ProviderConnection) -> None: ...

    async def save(self, connection: ProviderConnection) -> None: ...

    async def delete(self, user_id: uuid.UUID, provider_id: uuid.UUID) -> bool: ...


class SecretBox(Protocol):
    def encrypt(self, plaintext: str) -> str: ...

    def decrypt(self, token: str) -> str: ...


@dataclass(frozen=True, slots=True)
class ProviderDraft:
    name: str
    kind: ProviderKind
    base_url: str | None = None
    api_key: str | None = None
    input_price: int | None = None
    output_price: int | None = None


@dataclass(frozen=True, slots=True)
class ProviderChanges:
    name: Change[str] = UNSET
    base_url: Change[str | None] = UNSET
    # `None` removes the stored key.
    api_key: Change[str | None] = UNSET
    input_price: Change[int | None] = UNSET
    output_price: Change[int | None] = UNSET


@dataclass(frozen=True, slots=True)
class SettingsChanges:
    enabled: Change[bool] = UNSET
    chat_provider_id: Change[uuid.UUID | None] = UNSET
    chat_model: Change[str | None] = UNSET
    embedding_provider_id: Change[uuid.UUID | None] = UNSET
    embedding_model: Change[str | None] = UNSET
    fallback_provider_id: Change[uuid.UUID | None] = UNSET
    fallback_model: Change[str | None] = UNSET
    allow_cloud: Change[bool] = UNSET
    modules: Change[frozenset[AiModule]] = UNSET
    response_style: Change[ResponseStyle] = UNSET
    monthly_token_limit: Change[int | None] = UNSET
    indexing_enabled: Change[bool] = UNSET


@dataclass(frozen=True, slots=True)
class ConnectionTest:
    ok: bool
    processing: Processing
    model_count: int
    message: str


@dataclass(frozen=True, slots=True)
class ResolvedProvider:
    connection: ProviderConnection
    provider: AiProvider
    model: str
    processing: Processing

    @property
    def embedding_key(self) -> str:
        """Identifies the embedding space: chunks embedded by another key aren't comparable."""
        return f"{self.connection.id}:{self.model}"


class AiConfigService:
    def __init__(
        self,
        settings: SettingsRepository,
        providers: ProviderRepository,
        secrets: SecretBox,
        factory: ProviderFactory,
        usage: UsageService,
        transaction: Transaction,
        *,
        server_enabled: bool,
        allow_private: bool,
        resolve: Resolver,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._settings = settings
        self._providers = providers
        self._secrets = secrets
        self._factory = factory
        self._usage = usage
        self._transaction = transaction
        self._server_enabled = server_enabled
        self._allow_private = allow_private
        self._resolve = resolve
        self._clock = clock

    @property
    def server_enabled(self) -> bool:
        return self._server_enabled

    @property
    def usage(self) -> UsageService:
        return self._usage

    # Settings

    async def settings(self, user_id: uuid.UUID) -> AiSettings:
        return await self._settings.get(user_id) or AiSettings(user_id=user_id)

    async def update_settings(self, user_id: uuid.UUID, changes: SettingsChanges) -> AiSettings:
        current = await self.settings(user_id)
        for provider_id in (
            changes.chat_provider_id,
            changes.embedding_provider_id,
            changes.fallback_provider_id,
        ):
            if isinstance(provider_id, uuid.UUID):
                await self._get(user_id, provider_id)
        updated = AiSettings(
            user_id=user_id,
            enabled=_pick(changes.enabled, current.enabled),
            chat_provider_id=_pick(changes.chat_provider_id, current.chat_provider_id),
            chat_model=_pick(changes.chat_model, current.chat_model),
            embedding_provider_id=_pick(
                changes.embedding_provider_id, current.embedding_provider_id
            ),
            embedding_model=_pick(changes.embedding_model, current.embedding_model),
            fallback_provider_id=_pick(changes.fallback_provider_id, current.fallback_provider_id),
            fallback_model=_pick(changes.fallback_model, current.fallback_model),
            allow_cloud=_pick(changes.allow_cloud, current.allow_cloud),
            modules=_pick(changes.modules, current.modules),
            response_style=_pick(changes.response_style, current.response_style),
            monthly_token_limit=_pick(changes.monthly_token_limit, current.monthly_token_limit),
            indexing_enabled=_pick(changes.indexing_enabled, current.indexing_enabled),
            updated_at=self._clock(),
        )
        await self._settings.put(updated)
        await self._transaction.commit()
        return updated

    # Providers

    async def providers(self, user_id: uuid.UUID) -> list[ProviderConnection]:
        return await self._providers.list(user_id)

    async def create_provider(self, user_id: uuid.UUID, draft: ProviderDraft) -> ProviderConnection:
        base_url = await self._endpoint(draft.kind, draft.base_url)
        _check_key(draft.kind, draft.api_key)
        now = self._clock()
        connection = ProviderConnection(
            id=uuid.uuid4(),
            user_id=user_id,
            name=draft.name,
            kind=draft.kind,
            base_url=base_url,
            api_key_ciphertext=self._secrets.encrypt(draft.api_key) if draft.api_key else None,
            input_price=draft.input_price,
            output_price=draft.output_price,
            created_at=now,
            updated_at=now,
        )
        try:
            await self._providers.add(connection)
            await self._transaction.commit()
        except ConflictError:
            raise ProviderNameTakenError from None
        return connection

    async def update_provider(
        self, user_id: uuid.UUID, provider_id: uuid.UUID, changes: ProviderChanges
    ) -> ProviderConnection:
        connection = await self._get(user_id, provider_id)
        base_url = connection.base_url
        if changes.base_url is not UNSET:
            base_url = await self._endpoint(connection.kind, changes.base_url)
        ciphertext = connection.api_key_ciphertext
        if changes.api_key is not UNSET:
            ciphertext = self._secrets.encrypt(changes.api_key) if changes.api_key else None
        updated = replace(
            connection,
            name=_pick(changes.name, connection.name),
            base_url=base_url,
            api_key_ciphertext=ciphertext,
            input_price=_pick(changes.input_price, connection.input_price),
            output_price=_pick(changes.output_price, connection.output_price),
        )
        if updated == connection:
            return connection
        updated = replace(updated, updated_at=self._clock())
        try:
            await self._providers.save(updated)
            await self._transaction.commit()
        except ConflictError:
            raise ProviderNameTakenError from None
        return updated

    async def delete_provider(self, user_id: uuid.UUID, provider_id: uuid.UUID) -> None:
        """Deletes the connection; settings that selected it are cleared by the database (the
        foreign keys set them to null), along with their model names here."""
        await self._get(user_id, provider_id)
        current = await self.settings(user_id)
        cleared = replace(
            current,
            chat_model=None if current.chat_provider_id == provider_id else current.chat_model,
            embedding_model=None
            if current.embedding_provider_id == provider_id
            else current.embedding_model,
            fallback_model=None
            if current.fallback_provider_id == provider_id
            else current.fallback_model,
        )
        if cleared != current:
            await self._settings.put(cleared)
        if not await self._providers.delete(user_id, provider_id):
            raise ProviderNotFoundError
        await self._transaction.commit()

    async def test_connection(
        self,
        user_id: uuid.UUID,
        *,
        draft: ProviderDraft | None = None,
        provider_id: uuid.UUID | None = None,
    ) -> ConnectionTest:
        """Lists the provider's models: cheap, and spends no tokens. Nothing is saved. A draft
        with no key may borrow the key of `provider_id` (editing a saved connection)."""
        if draft is None and provider_id is None:
            raise ValueError("draft or provider_id is required")
        saved = await self._get(user_id, provider_id) if provider_id is not None else None
        if draft is not None:
            base_url = await self._endpoint(draft.kind, draft.base_url)
            key = draft.api_key
            if key is None and saved is not None and saved.api_key_ciphertext is not None:
                key = self._secrets.decrypt(saved.api_key_ciphertext)
            now = self._clock()
            connection = ProviderConnection(
                id=uuid.uuid4(),
                user_id=user_id,
                name=draft.name,
                kind=draft.kind,
                base_url=base_url,
                api_key_ciphertext=None,
                input_price=None,
                output_price=None,
                created_at=now,
                updated_at=now,
            )
        else:
            assert saved is not None
            connection, key = saved, self._key_of(saved)
        processing = processing_of(connection.kind, base_url_of(connection))
        try:
            _check_key(connection.kind, key)
            models = await self._factory.build(connection, key).list_models()
        except ProviderError as exc:
            return ConnectionTest(
                ok=False, processing=processing, model_count=0, message=exc.message
            )
        return ConnectionTest(
            ok=True,
            processing=processing,
            model_count=len(models),
            message=f"Connected. {len(models)} model(s) available.",
        )

    async def models(self, user_id: uuid.UUID, provider_id: uuid.UUID) -> list[ModelInfo]:
        connection = await self._get(user_id, provider_id)
        return await self._factory.build(connection, self._key_of(connection)).list_models()

    # Choosing providers for requests

    async def require_enabled(self, user_id: uuid.UUID) -> AiSettings:
        settings = await self.settings(user_id)
        if not self._server_enabled or not settings.enabled:
            raise AiDisabledError
        return settings

    async def chat_provider(
        self,
        settings: AiSettings,
        workspace_id: uuid.UUID | None,
        operation: UsageOperation,
    ) -> ResolvedProvider:
        if settings.chat_provider_id is None or not settings.chat_model:
            raise AiNotConfiguredError("Choose a provider and model in Settings → AI.")
        return await self._resolve_provider(
            settings, settings.chat_provider_id, settings.chat_model, workspace_id, operation
        )

    async def fallback_provider(
        self, settings: AiSettings, workspace_id: uuid.UUID | None, operation: UsageOperation
    ) -> ResolvedProvider | None:
        if settings.fallback_provider_id is None or not settings.fallback_model:
            return None
        try:
            return await self._resolve_provider(
                settings,
                settings.fallback_provider_id,
                settings.fallback_model,
                workspace_id,
                operation,
            )
        except (CloudProcessingNotAllowedError, ProviderNotFoundError):
            return None

    async def embedding_provider(
        self, settings: AiSettings, workspace_id: uuid.UUID | None
    ) -> ResolvedProvider | None:
        """The embedding provider, or `None` when semantic search isn't available: AI off, none
        chosen, or a cloud provider without consent."""
        if not self._server_enabled or not settings.enabled:
            return None
        if settings.embedding_provider_id is None or not settings.embedding_model:
            return None
        try:
            resolved = await self._resolve_provider(
                settings,
                settings.embedding_provider_id,
                settings.embedding_model,
                workspace_id,
                "embedding",
            )
        except (CloudProcessingNotAllowedError, ProviderNotFoundError):
            return None
        return resolved if resolved.provider.capabilities.embeddings else None

    async def _resolve_provider(
        self,
        settings: AiSettings,
        provider_id: uuid.UUID,
        model: str,
        workspace_id: uuid.UUID | None,
        operation: UsageOperation,
    ) -> ResolvedProvider:
        connection = await self._get(settings.user_id, provider_id)
        processing = processing_of(connection.kind, base_url_of(connection))
        if processing == "cloud" and not settings.allow_cloud:
            raise CloudProcessingNotAllowedError
        provider = MeteredProvider(
            self._factory.build(connection, self._key_of(connection)),
            connection,
            processing,
            Meter(
                usage=self._usage,
                user_id=settings.user_id,
                workspace_id=workspace_id,
                operation=operation,
                limit=settings.monthly_token_limit,
            ),
            self._clock,
        )
        return ResolvedProvider(
            connection=connection, provider=provider, model=model, processing=processing
        )

    async def _get(self, user_id: uuid.UUID, provider_id: uuid.UUID) -> ProviderConnection:
        connection = await self._providers.get(user_id, provider_id)
        if connection is None:
            raise ProviderNotFoundError
        return connection

    def _key_of(self, connection: ProviderConnection) -> str | None:
        if connection.api_key_ciphertext is None:
            return None
        return self._secrets.decrypt(connection.api_key_ciphertext)

    async def _endpoint(self, kind: ProviderKind, base_url: str | None) -> str | None:
        """The checked custom endpoint, or `None` for the provider's default one."""
        if not base_url:
            if DEFAULT_BASE_URLS[kind] is None:
                raise ProviderRequestError("Enter the server's address.")
            default = DEFAULT_BASE_URLS[kind]
            assert default is not None
            if kind == "ollama":
                # The default is local; it still has to be allowed on this server.
                await check_endpoint(
                    default, allow_private=self._allow_private, resolve=self._resolve
                )
            return None
        return await check_endpoint(
            base_url, allow_private=self._allow_private, resolve=self._resolve
        )


def _check_key(kind: ProviderKind, key: str | None) -> None:
    if kind in KEY_REQUIRED and not key:
        raise ProviderRequestError("This provider needs an API key.")


def _pick[T](change: Change[T], current: T) -> T:
    return current if change is UNSET else change
