"""Connections: authorizing accounts, their calendars and labels, synchronization requests and
history, conflicts, the origin of imported records, push notifications, and disconnecting.

Authorization (OAuth 2.0 Authorization Code with PKCE):

1. `start_authorization` stores a single-use state (its SHA-256) bound to the person, workspace,
   provider, and requested capabilities, with the PKCE verifier encrypted, and returns the
   provider's consent URL for the configured redirect URI.
2. The provider redirects the browser to Orbit's callback page, which posts the code and state
   to the API with the person's own session (`complete_authorization`). The state must exist,
   be unexpired, and belong to the same person, so a link crafted by someone else can't attach
   their account to this person's Orbit (login CSRF), and a replayed state fails.
3. The code is exchanged with the verifier; only capabilities whose scopes were all granted are
   recorded. Tokens are encrypted before they're stored and never leave the server.
"""

import contextlib
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from orbit_api.services.calendar.models import EventNotFoundError
from orbit_api.services.calendar.service import CalendarService
from orbit_api.services.documents.models import DocumentNotFoundError
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.integrations.calendar_sync import CalendarSync
from orbit_api.services.integrations.connectors import (
    ConnectorRegistry,
    ProviderConnector,
    ProviderError,
    RemoteCalendar,
)
from orbit_api.services.integrations.models import (
    CAPABILITIES,
    DEFAULT_MAIL_DAYS,
    DEFAULT_SYNC_INTERVAL,
    MAIL_DAY_OPTIONS,
    OAUTH_STATE_TTL_SECONDS,
    SYNC_INTERVALS,
    AuthorizationDeniedError,
    Capability,
    CapabilityNotGrantedError,
    ConflictResolution,
    Connection,
    ConnectionDetail,
    ConnectionNotFoundError,
    IntegrationError,
    IntegrationsDisabledError,
    InvalidOAuthStateError,
    Link,
    LinkNotFoundError,
    MissingScopesError,
    OAuthState,
    ProviderId,
    ProviderInfo,
    ProviderNotConfiguredError,
    Resource,
    ResourceNotFoundError,
    RunCounts,
    RunKind,
    RunNotCancellableError,
    RunNotFoundError,
    RunTrigger,
    SyncDirection,
    SyncRun,
)
from orbit_api.services.integrations.oauth import (
    code_challenge,
    digest,
    matches,
    new_code_verifier,
    new_state,
)
from orbit_api.services.integrations.store import IntegrationStore, SecretBox
from orbit_api.services.integrations.tokens import TokenManager
from orbit_api.services.transactions import Transaction
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.clock import utc_now

PROVIDER_NAMES: dict[ProviderId, str] = {"google": "Google", "microsoft": "Microsoft"}
RECENT_RUNS = 20


class InvalidSettingError(IntegrationError):
    message = "That setting isn't one of the allowed values."


@dataclass(frozen=True, slots=True)
class ResourceChanges:
    enabled: Change[bool] = UNSET
    direction: Change[SyncDirection] = UNSET
    sync_interval_minutes: Change[int] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET


@dataclass(frozen=True, slots=True)
class LinkedOrigin:
    link: Link
    provider: ProviderId
    account_email: str
    resource_name: str | None
    two_way: bool


@dataclass(frozen=True, slots=True)
class DisconnectResult:
    # Whether the provider confirmed revoking Orbit's access. Microsoft has no endpoint for it.
    revoked: bool
    removed_events: int
    trashed_documents: int


class IntegrationService:
    def __init__(
        self,
        store: IntegrationStore,
        secrets: SecretBox,
        connectors: ConnectorRegistry,
        tokens: TokenManager,
        calendar_sync: CalendarSync,
        calendar: CalendarService,
        documents: DocumentService,
        transaction: Transaction,
        *,
        enabled: bool,
        redirect_uri: str,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._secrets = secrets
        self._connectors = connectors
        self._tokens = tokens
        self._calendar_sync = calendar_sync
        self._calendar = calendar
        self._documents = documents
        self._transaction = transaction
        self._enabled = enabled
        self._redirect_uri = redirect_uri
        self._clock = clock

    # Providers

    def providers(self) -> list[ProviderInfo]:
        infos: list[ProviderInfo] = []
        for provider in self._connectors.known():
            connector = self._connectors.get(provider) if self._enabled else None
            infos.append(
                ProviderInfo(
                    provider=provider,
                    name=PROVIDER_NAMES[provider],
                    configured=connector is not None,
                    capabilities=connector.capabilities if connector else (),
                    scopes=dict(connector.scopes) if connector else {},
                )
            )
        return infos

    # Authorization

    async def start_authorization(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        provider: ProviderId,
        capabilities: Sequence[Capability],
        connection_id: uuid.UUID | None = None,
    ) -> str:
        connector = self._connector(provider)
        wanted: set[Capability] = set(capabilities)
        if "calendar_write" in wanted:
            wanted.add("calendar")
        hint: str | None = None
        if connection_id is not None:
            existing = await self._require_connection(workspace_id, user_id, connection_id)
            if existing.provider != provider:
                raise ConnectionNotFoundError
            wanted |= set(existing.capabilities)
            hint = existing.account_email
        ordered: tuple[Capability, ...] = tuple(
            c for c in CAPABILITIES if c in wanted and c in connector.scopes
        )
        if not ordered:
            raise MissingScopesError("Choose what Orbit may access.")
        verifier = new_code_verifier()
        state = new_state()
        now = self._clock()
        await self._store.purge_states(now)
        await self._store.add_state(
            OAuthState(
                id=uuid.uuid4(),
                state_hash=digest(state),
                user_id=user_id,
                workspace_id=workspace_id,
                provider=provider,
                capabilities=ordered,
                # Encrypting first also fails early when tokens couldn't be stored anyway.
                code_verifier_ciphertext=self._secrets.encrypt(verifier),
                connection_id=connection_id,
                redirect_uri=self._redirect_uri,
                expires_at=now + timedelta(seconds=OAUTH_STATE_TTL_SECONDS),
                created_at=now,
            )
        )
        await self._transaction.commit()
        return connector.oauth.authorization_url(
            state=state,
            code_challenge=code_challenge(verifier),
            scopes=connector.scopes_for(ordered),
            redirect_uri=self._redirect_uri,
            login_hint=hint,
        )

    async def complete_authorization(
        self, user_id: uuid.UUID, state: str, code: str | None, error: str | None
    ) -> Connection:
        stored = await self._store.take_state(digest(state))
        # Consumed whatever happens next: a state is good for one attempt.
        await self._transaction.commit()
        now = self._clock()
        if stored is None or stored.expires_at <= now or stored.user_id != user_id:
            raise InvalidOAuthStateError
        if error is not None or not code:
            raise AuthorizationDeniedError
        connector = self._connector(stored.provider)
        verifier = self._secrets.decrypt(stored.code_verifier_ciphertext)
        tokens = await connector.oauth.exchange_code(code, verifier, stored.redirect_uri)
        granted = connector.granted(tokens.scopes)
        if not set(granted) & set(stored.capabilities):
            raise MissingScopesError
        account = await connector.oauth.account(tokens.access_token)
        existing = await self._store.find_connection(
            stored.workspace_id, stored.provider, account.account_id
        )
        refresh = self._secrets.encrypt(tokens.refresh_token) if tokens.refresh_token else None
        if existing is not None and existing.user_id == user_id:
            connection = replace(
                existing,
                account_email=account.email,
                display_name=account.display_name,
                scopes=tokens.scopes,
                capabilities=granted,
                status="active",
                access_token_ciphertext=self._secrets.encrypt(tokens.access_token),
                # Providers send a refresh token only on first consent; keep the one we have.
                refresh_token_ciphertext=refresh or existing.refresh_token_ciphertext,
                token_expires_at=tokens.expires_at,
                token_version=existing.token_version + 1,
                last_error=None,
                updated_at=now,
            )
            await self._store.save_connection(connection)
        elif existing is not None:
            raise InvalidOAuthStateError
        else:
            connection = Connection(
                id=uuid.uuid4(),
                user_id=user_id,
                workspace_id=stored.workspace_id,
                provider=stored.provider,
                account_id=account.account_id,
                account_email=account.email,
                display_name=account.display_name,
                scopes=tokens.scopes,
                capabilities=granted,
                status="active",
                access_token_ciphertext=self._secrets.encrypt(tokens.access_token),
                refresh_token_ciphertext=refresh,
                token_expires_at=tokens.expires_at,
                token_version=1,
                mail_days=DEFAULT_MAIL_DAYS,
                last_synced_at=None,
                last_error=None,
                created_at=now,
                updated_at=now,
            )
            await self._store.add_connection(connection)
        await self._transaction.commit()
        if "calendar" in granted:
            # If listing fails now, the connection's page lists them again.
            with contextlib.suppress(ProviderError):
                await self.refresh_calendars(connection)
        return connection

    # Connections

    async def connections(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[Connection]:
        return await self._store.connections(workspace_id, user_id)

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, connection_id: uuid.UUID
    ) -> Connection:
        return await self._require_connection(workspace_id, user_id, connection_id)

    async def detail(self, connection: Connection) -> ConnectionDetail:
        return ConnectionDetail(
            connection=connection,
            resources=await self._store.resources(connection.id),
            runs=await self._store.runs(connection.id, RECENT_RUNS),
            conflicts=await self._store.count_links(connection.id, "event", "conflict"),
            imported_files=await self._store.count_links(connection.id, "file"),
        )

    async def update(self, connection: Connection, *, mail_days: int | None) -> Connection:
        if mail_days is None:
            return connection
        if mail_days not in MAIL_DAY_OPTIONS:
            raise InvalidSettingError
        updated = replace(connection, mail_days=mail_days, updated_at=self._clock())
        await self._store.save_connection(updated)
        await self._transaction.commit()
        return updated

    async def check(self, connection: Connection) -> Connection:
        """A health check: ask the provider who the token belongs to."""
        connector = self._connector(connection.provider)
        try:
            await self._tokens.call(connection, connector.oauth.account)
        except ProviderError as exc:
            current = await self._store.connection_by_id(connection.id) or connection
            if current.status != "reauth_required":
                current = replace(current, status="error", last_error=exc.message)
                await self._store.save_connection(current)
                await self._transaction.commit()
            return current
        current = await self._store.connection_by_id(connection.id) or connection
        if current.status != "active":
            current = replace(current, status="active", last_error=None, updated_at=self._clock())
            await self._store.save_connection(current)
            await self._transaction.commit()
        return current

    async def disconnect(
        self, connection: Connection, *, remove_imported: bool
    ) -> DisconnectResult:
        """Revoke Orbit's access where the provider allows it, delete the tokens, and either
        keep imported records as ordinary Orbit records or remove them (documents go to the
        trash, so they can still be restored)."""
        removed = trashed = 0
        if remove_imported:
            for link in await self._store.connection_links(connection.id):
                if link.origin != "external" or link.original_start is not None:
                    continue
                try:
                    if link.entity_type == "event":
                        await self._calendar.delete_event(link.workspace_id, link.entity_id)
                        removed += 1
                    elif link.entity_type == "document":
                        await self._documents.trash(link.workspace_id, link.entity_id)
                        trashed += 1
                except (EventNotFoundError, DocumentNotFoundError):
                    continue
        revoked = False
        connector = self._connectors.get(connection.provider)
        if connector is not None:
            try:
                ciphertext = connection.refresh_token_ciphertext or (
                    connection.access_token_ciphertext
                )
                revoked = await connector.oauth.revoke(self._secrets.decrypt(ciphertext))
            except (ProviderError, IntegrationError):
                revoked = False  # The tokens are deleted regardless.
            if connector.calendar is not None:
                calendar = connector.calendar
                for resource in await self._store.resources(connection.id):
                    channel = resource.channel_id
                    if channel:
                        with contextlib.suppress(ProviderError, IntegrationError):
                            await self._tokens.call(
                                connection,
                                lambda token, c=channel, r=resource.channel_resource_id: (
                                    calendar.unwatch(token, c, r)
                                ),
                            )
        await self._store.delete_connection(connection.id)
        await self._transaction.commit()
        return DisconnectResult(revoked, removed, trashed)

    # Calendars

    async def refresh_calendars(self, connection: Connection) -> list[Resource]:
        """List the account's calendars again: new ones are added (not selected), settings of
        known ones are kept, and calendars that disappeared are removed."""
        self._require_capability(connection, "calendar")
        connector = self._connector(connection.provider)
        if connector.calendar is None:
            raise CapabilityNotGrantedError
        calendar = connector.calendar
        remote: list[RemoteCalendar] = await self._tokens.call(connection, calendar.calendars)
        existing = {
            r.external_id: r
            for r in await self._store.resources(connection.id)
            if r.kind == "calendar"
        }
        now = self._clock()
        seen: set[str] = set()
        for item in remote:
            seen.add(item.external_id)
            known = existing.get(item.external_id)
            if known is None:
                await self._store.add_resource(
                    Resource(
                        id=uuid.uuid4(),
                        connection_id=connection.id,
                        workspace_id=connection.workspace_id,
                        kind="calendar",
                        external_id=item.external_id,
                        name=item.name[:200] or "Calendar",
                        enabled=False,
                        writable=item.writable,
                        direction="import",
                        sync_interval_minutes=DEFAULT_SYNC_INTERVAL,
                        category_id=None,
                        timezone=item.timezone,
                        cursor=None,
                        checkpoint=None,
                        window_start=None,
                        next_sync_at=None,
                        last_synced_at=None,
                        last_error=None,
                        channel_id=None,
                        channel_token_hash=None,
                        channel_resource_id=None,
                        channel_expires_at=None,
                        created_at=now,
                        updated_at=now,
                    )
                )
            else:
                direction = known.direction if item.writable else "import"
                await self._store.save_resource(
                    replace(
                        known,
                        name=item.name[:200] or known.name,
                        writable=item.writable,
                        timezone=item.timezone,
                        direction=direction,
                        updated_at=now,
                    )
                )
        await self._store.delete_resources(
            [r.id for external_id, r in existing.items() if external_id not in seen]
        )
        await self._transaction.commit()
        return await self._store.resources(connection.id)

    async def update_resource(
        self, connection: Connection, resource_id: uuid.UUID, changes: ResourceChanges
    ) -> Resource:
        resource = await self._require_resource(connection, resource_id)
        updated = resource
        if changes.sync_interval_minutes is not UNSET:
            if changes.sync_interval_minutes not in SYNC_INTERVALS:
                raise InvalidSettingError
            updated = replace(updated, sync_interval_minutes=changes.sync_interval_minutes)
        if changes.direction is not UNSET:
            if changes.direction == "two_way" and (
                not resource.writable or "calendar_write" not in connection.capabilities
            ):
                raise CapabilityNotGrantedError
            updated = replace(updated, direction=changes.direction)
        if changes.category_id is not UNSET:
            if changes.category_id is not None:
                categories = await self._calendar.categories(connection.workspace_id)
                if not any(c.id == changes.category_id for c in categories):
                    raise InvalidSettingError("That calendar category doesn't exist.")
            updated = replace(updated, category_id=changes.category_id)
        if changes.enabled is not UNSET:
            updated = replace(updated, enabled=changes.enabled)
        now = self._clock()
        starting = updated.enabled and not resource.enabled
        if updated.enabled and (
            starting or updated.sync_interval_minutes != resource.sync_interval_minutes
        ):
            minutes = updated.sync_interval_minutes
            updated = replace(
                updated, next_sync_at=now + timedelta(minutes=minutes) if minutes else None
            )
        if not updated.enabled:
            updated = replace(updated, next_sync_at=None)
            open_run = await self._store.open_run(connection.id, resource.id, "calendar")
            if open_run is not None:
                await self._store.save_run(replace(open_run, cancel_requested=True))
        updated = replace(updated, updated_at=now)
        await self._store.save_resource(updated)
        await self._transaction.commit()
        if starting:
            await self.request_sync(connection, resource.id, "initial")
        return updated

    async def export_event(
        self, connection: Connection, resource_id: uuid.UUID, event_id: uuid.UUID
    ) -> Link:
        resource = await self._require_resource(connection, resource_id)
        return await self._calendar_sync.export_event(connection, resource, event_id)

    # Synchronization

    async def request_sync(
        self,
        connection: Connection,
        resource_id: uuid.UUID | None,
        trigger: RunTrigger = "manual",
    ) -> list[SyncRun]:
        """Queue synchronization for one calendar, or for every selected calendar and the
        connection's imported files. Work already queued or running is returned, not repeated.
        The worker does the work; requests never wait for a provider sync."""
        if connection.status == "reauth_required":
            raise CapabilityNotGrantedError("Reconnect this account to synchronize it.")
        targets: list[tuple[uuid.UUID | None, RunKind]] = []
        if resource_id is not None:
            resource = await self._require_resource(connection, resource_id)
            targets.append((resource.id, "calendar"))
        else:
            for r in await self._store.resources(connection.id):
                if r.kind == "calendar" and r.enabled:
                    targets.append((r.id, "calendar"))
            if await self._store.count_links(connection.id, "file"):
                targets.append((None, "files"))
        runs: list[SyncRun] = []
        for target, kind in targets:
            runs.append(await self.queue(connection, target, kind, trigger))
        await self._transaction.commit()
        return runs

    async def queue(
        self,
        connection: Connection,
        resource_id: uuid.UUID | None,
        kind: RunKind,
        trigger: RunTrigger,
    ) -> SyncRun:
        existing = await self._store.open_run(connection.id, resource_id, kind)
        if existing is not None:
            return existing
        now = self._clock()
        run = SyncRun(
            id=uuid.uuid4(),
            connection_id=connection.id,
            resource_id=resource_id,
            workspace_id=connection.workspace_id,
            kind=kind,
            trigger=trigger,
            status="queued",
            full=False,
            counts=RunCounts(),
            error=None,
            attempts=0,
            cancel_requested=False,
            claim_token=None,
            lease_until=None,
            next_attempt_at=now,
            started_at=None,
            finished_at=None,
            created_at=now,
        )
        await self._store.add_run(run)
        return run

    async def runs(self, connection: Connection, limit: int = 50) -> list[SyncRun]:
        return await self._store.runs(connection.id, limit)

    async def cancel_run(self, connection: Connection, run_id: uuid.UUID) -> SyncRun:
        run = await self._store.get_run(connection.id, run_id)
        if run is None:
            raise RunNotFoundError
        if run.status not in ("queued", "running"):
            raise RunNotCancellableError
        now = self._clock()
        updated = (
            replace(run, status="cancelled", finished_at=now, cancel_requested=True)
            if run.status == "queued"
            else replace(run, cancel_requested=True)
        )
        await self._store.save_run(updated)
        await self._transaction.commit()
        return updated

    async def retry_run(self, connection: Connection, run_id: uuid.UUID) -> SyncRun:
        run = await self._store.get_run(connection.id, run_id)
        if run is None:
            raise RunNotFoundError
        queued = await self.queue(connection, run.resource_id, run.kind, "retry")
        await self._transaction.commit()
        return queued

    async def notify_channel(self, channel_id: str, secret: str) -> bool:
        """A provider push notification: verified by the secret Orbit gave the channel, then
        answered by queueing a synchronization. The payload itself is never trusted or read."""
        resource = await self._store.resource_by_channel(channel_id)
        if resource is None or not matches(secret, resource.channel_token_hash):
            return False
        connection = await self._store.connection_by_id(resource.connection_id)
        if connection is None or not resource.enabled or connection.status == "reauth_required":
            return True  # Authentic, but nothing to do.
        await self.queue(connection, resource.id, "calendar", "webhook")
        await self._transaction.commit()
        return True

    # Conflicts and origins

    async def conflicts(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> list[tuple[Link, Connection]]:
        connections = {c.id: c for c in await self._store.connections(workspace_id, user_id)}
        return [
            (link, connections[link.connection_id])
            for link in await self._store.conflicts(workspace_id, user_id)
            if link.connection_id in connections
        ]

    async def resolve(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        link_id: uuid.UUID,
        resolution: ConflictResolution,
    ) -> Link | None:
        link = await self._store.get_link(workspace_id, link_id)
        if link is None:
            raise LinkNotFoundError
        connection = await self._require_connection(workspace_id, user_id, link.connection_id)
        return await self._calendar_sync.resolve(connection, link, resolution)

    async def origins(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, entity_type: str, entity_id: uuid.UUID
    ) -> list[LinkedOrigin]:
        """Where an Orbit record came from or what it's linked to, and whether changes to it
        go back to the provider."""
        if entity_type not in ("event", "task", "note", "reminder", "document"):
            return []
        connections = {c.id: c for c in await self._store.connections(workspace_id, user_id)}
        origins: list[LinkedOrigin] = []
        links = await self._store.links_for_entity(
            workspace_id,
            entity_type,  # pyright: ignore[reportArgumentType] - checked above
            entity_id,
        )
        for link in links:
            connection = connections.get(link.connection_id)
            if connection is None:
                continue
            resource = (
                await self._store.resource_by_id(link.resource_id) if link.resource_id else None
            )
            origins.append(
                LinkedOrigin(
                    link=link,
                    provider=connection.provider,
                    account_email=connection.account_email,
                    resource_name=resource.name if resource else None,
                    two_way=resource is not None
                    and resource.direction == "two_way"
                    and "calendar_write" in connection.capabilities,
                )
            )
        return origins

    # Helpers

    def _connector(self, provider: ProviderId) -> ProviderConnector:
        if not self._enabled:
            raise IntegrationsDisabledError
        connector = self._connectors.get(provider)
        if connector is None:
            raise ProviderNotConfiguredError
        return connector

    async def _require_connection(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, connection_id: uuid.UUID
    ) -> Connection:
        connection = await self._store.get_connection(workspace_id, user_id, connection_id)
        if connection is None:
            raise ConnectionNotFoundError
        return connection

    async def _require_resource(self, connection: Connection, resource_id: uuid.UUID) -> Resource:
        resource = await self._store.get_resource(connection.id, resource_id)
        if resource is None or resource.kind != "calendar":
            raise ResourceNotFoundError
        return resource

    @staticmethod
    def _require_capability(connection: Connection, capability: Capability) -> None:
        if capability not in connection.capabilities:
            raise CapabilityNotGrantedError
