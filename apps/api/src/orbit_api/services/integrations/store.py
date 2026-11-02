"""The repository protocol the integration services depend on, and the secret box that
encrypts tokens. Implemented with SQLAlchemy in `repositories/integrations.py`."""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Protocol

from orbit_api.services.calendar.models import EventException
from orbit_api.services.integrations.models import (
    Connection,
    EntityType,
    ExternalKind,
    Link,
    OAuthState,
    Resource,
    RunKind,
    SyncRun,
)


class SecretBox(Protocol):
    """Encrypts tokens at rest. Raises `TokenStorageUnavailableError` without a key."""

    def encrypt(self, plaintext: str) -> str: ...

    def decrypt(self, ciphertext: str) -> str: ...


class IntegrationStore(Protocol):
    # Connections. Every person-facing lookup is scoped to the workspace and its owner.

    async def add_connection(self, connection: Connection) -> None: ...

    async def get_connection(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, connection_id: uuid.UUID
    ) -> Connection | None: ...

    async def connection_by_id(self, connection_id: uuid.UUID) -> Connection | None:
        """For the worker, which acts on behalf of whoever owns the connection."""
        ...

    async def connections(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> list[Connection]: ...

    async def find_connection(
        self, workspace_id: uuid.UUID, provider: str, account_id: str
    ) -> Connection | None: ...

    async def save_connection(self, connection: Connection) -> None: ...

    async def update_tokens(
        self,
        connection_id: uuid.UUID,
        expected_version: int,
        access_ciphertext: str,
        refresh_ciphertext: str | None,
        expires_at: datetime | None,
        now: datetime,
    ) -> bool:
        """Store refreshed tokens only if nobody else did since `expected_version`."""
        ...

    async def delete_connection(self, connection_id: uuid.UUID) -> None: ...

    # Resources

    async def resources(self, connection_id: uuid.UUID) -> list[Resource]: ...

    async def get_resource(
        self, connection_id: uuid.UUID, resource_id: uuid.UUID
    ) -> Resource | None: ...

    async def resource_by_id(self, resource_id: uuid.UUID) -> Resource | None: ...

    async def resource_by_channel(self, channel_id: str) -> Resource | None: ...

    async def add_resource(self, resource: Resource) -> None: ...

    async def save_resource(self, resource: Resource) -> None: ...

    async def delete_resources(self, resource_ids: Sequence[uuid.UUID]) -> None: ...

    async def due_resources(self, now: datetime, limit: int) -> list[Resource]:
        """Enabled calendars of active connections whose automatic synchronization is due."""
        ...

    # OAuth states

    async def add_state(self, state: OAuthState) -> None: ...

    async def take_state(self, state_hash: str) -> OAuthState | None:
        """Delete and return the state, so it can be used once."""
        ...

    async def purge_states(self, now: datetime) -> int: ...

    # Links

    async def find_link(
        self, connection_id: uuid.UUID, external_kind: ExternalKind, external_id: str
    ) -> Link | None:
        """The link of an event or file (each is imported once per connection)."""
        ...

    async def links_for_external(
        self, connection_id: uuid.UUID, external_kind: ExternalKind, external_id: str
    ) -> list[Link]: ...

    async def links_for_entity(
        self, workspace_id: uuid.UUID, entity_type: EntityType, entity_id: uuid.UUID
    ) -> list[Link]: ...

    async def get_link(self, workspace_id: uuid.UUID, link_id: uuid.UUID) -> Link | None: ...

    async def add_link(self, link: Link) -> None: ...

    async def save_link(self, link: Link) -> None: ...

    async def delete_links(self, link_ids: Sequence[uuid.UUID]) -> None: ...

    async def resource_links(self, resource_id: uuid.UUID) -> list[Link]: ...

    async def child_links(self, resource_id: uuid.UUID, parent_id: str) -> list[Link]: ...

    async def connection_links(
        self, connection_id: uuid.UUID, external_kind: ExternalKind | None = None
    ) -> list[Link]: ...

    async def conflicts(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[Link]: ...

    async def count_links(
        self, connection_id: uuid.UUID, external_kind: ExternalKind, status: str | None = None
    ) -> int: ...

    # Runs

    async def add_run(self, run: SyncRun) -> None: ...

    async def get_run(self, connection_id: uuid.UUID, run_id: uuid.UUID) -> SyncRun | None: ...

    async def run_by_id(self, run_id: uuid.UUID) -> SyncRun | None: ...

    async def save_run(self, run: SyncRun) -> None: ...

    async def runs(self, connection_id: uuid.UUID, limit: int) -> list[SyncRun]: ...

    async def open_run(
        self, connection_id: uuid.UUID, resource_id: uuid.UUID | None, kind: RunKind
    ) -> SyncRun | None:
        """A queued or running run for the same work, so requests never duplicate it."""
        ...

    async def claim_runs(self, now: datetime, lease_until: datetime, limit: int) -> list[SyncRun]:
        """Atomically take queued runs that are due, and running ones whose lease expired."""
        ...

    async def connections_with_files(self) -> list[uuid.UUID]: ...

    # Read-only views of other modules

    async def event_exception(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, original_start: datetime
    ) -> EventException | None: ...
