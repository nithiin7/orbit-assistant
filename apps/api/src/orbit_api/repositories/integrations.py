"""SQL for the five integration tables, and the builder that assembles the integration services
on one session.

Module services (calendar, documents, tasks, notes, reminders) are built here on a
`FlushTransaction`: their "commit" only flushes, so the integration service commits a record
together with the link that says where it came from.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import Settings
from orbit_api.db.models.calendar import CalendarEventExceptionModel
from orbit_api.db.models.integrations import (
    IntegrationConnectionModel,
    IntegrationLinkModel,
    IntegrationOAuthStateModel,
    IntegrationResourceModel,
    IntegrationSyncRunModel,
)
from orbit_api.repositories.calendar import (  # One mapping of exceptions, the calendar's own.
    SqlCalendarRepository,
    _to_exception,  # pyright: ignore[reportPrivateUsage]
)
from orbit_api.repositories.documents import SqlDocumentStore
from orbit_api.repositories.notes import (
    SqlNoteFolderRepository,
    SqlNoteRepository,
    SqlNoteTagRepository,
)
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.calendar.models import EventException
from orbit_api.services.calendar.service import CalendarService
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.integrations.calendar_sync import CalendarSync
from orbit_api.services.integrations.connectors import ConnectorRegistry
from orbit_api.services.integrations.files import FileService
from orbit_api.services.integrations.mail import MailService
from orbit_api.services.integrations.models import (
    Capability,
    ConflictKind,
    Connection,
    ConnectionStatus,
    EntityType,
    ExternalKind,
    Link,
    LinkOrigin,
    LinkStatus,
    OAuthState,
    ProviderId,
    Resource,
    ResourceKind,
    RunCounts,
    RunKind,
    RunStatus,
    RunTrigger,
    SyncDirection,
    SyncRun,
)
from orbit_api.services.integrations.runner import SyncRunner
from orbit_api.services.integrations.service import IntegrationService
from orbit_api.services.integrations.tokens import TokenManager
from orbit_api.services.notes.service import NoteService
from orbit_api.services.notifications.models import Notification
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.tasks.service import TaskService
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.system.secrets import IntegrationSecretBox
from orbit_api.utils.clock import utc_now


def _rowcount(result: object) -> int:
    return cast(int, getattr(result, "rowcount", 0))


# Mapping


def _connection(model: IntegrationConnectionModel) -> Connection:
    return Connection(
        id=model.id,
        user_id=model.user_id,
        workspace_id=model.workspace_id,
        provider=cast(ProviderId, model.provider),
        account_id=model.account_id,
        account_email=model.account_email,
        display_name=model.display_name,
        scopes=tuple(model.scopes),
        capabilities=tuple(cast(list[Capability], model.capabilities)),
        status=cast(ConnectionStatus, model.status),
        access_token_ciphertext=model.access_token_ciphertext,
        refresh_token_ciphertext=model.refresh_token_ciphertext,
        token_expires_at=model.token_expires_at,
        token_version=model.token_version,
        mail_days=model.mail_days,
        last_synced_at=model.last_synced_at,
        last_error=model.last_error,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _connection_fields(connection: Connection) -> dict[str, object]:
    return {
        "user_id": connection.user_id,
        "workspace_id": connection.workspace_id,
        "provider": connection.provider,
        "account_id": connection.account_id,
        "account_email": connection.account_email[:320],
        "display_name": connection.display_name[:200],
        "scopes": list(connection.scopes),
        "capabilities": list(connection.capabilities),
        "status": connection.status,
        "access_token_ciphertext": connection.access_token_ciphertext,
        "refresh_token_ciphertext": connection.refresh_token_ciphertext,
        "token_expires_at": connection.token_expires_at,
        "token_version": connection.token_version,
        "mail_days": connection.mail_days,
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error[:300] if connection.last_error else None,
        "created_at": connection.created_at,
        "updated_at": connection.updated_at,
    }


def _resource(model: IntegrationResourceModel) -> Resource:
    return Resource(
        id=model.id,
        connection_id=model.connection_id,
        workspace_id=model.workspace_id,
        kind=cast(ResourceKind, model.kind),
        external_id=model.external_id,
        name=model.name,
        enabled=model.enabled,
        writable=model.writable,
        direction=cast(SyncDirection, model.direction),
        sync_interval_minutes=model.sync_interval_minutes,
        category_id=model.category_id,
        timezone=model.timezone,
        cursor=model.cursor,
        checkpoint=model.checkpoint,
        window_start=model.window_start,
        next_sync_at=model.next_sync_at,
        last_synced_at=model.last_synced_at,
        last_error=model.last_error,
        channel_id=model.channel_id,
        channel_token_hash=model.channel_token_hash,
        channel_resource_id=model.channel_resource_id,
        channel_expires_at=model.channel_expires_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _resource_fields(resource: Resource) -> dict[str, object]:
    return {
        "connection_id": resource.connection_id,
        "workspace_id": resource.workspace_id,
        "kind": resource.kind,
        "external_id": resource.external_id,
        "name": resource.name[:200],
        "enabled": resource.enabled,
        "writable": resource.writable,
        "direction": resource.direction,
        "sync_interval_minutes": resource.sync_interval_minutes,
        "category_id": resource.category_id,
        "timezone": resource.timezone,
        "cursor": resource.cursor,
        "checkpoint": resource.checkpoint,
        "window_start": resource.window_start,
        "next_sync_at": resource.next_sync_at,
        "last_synced_at": resource.last_synced_at,
        "last_error": resource.last_error[:300] if resource.last_error else None,
        "channel_id": resource.channel_id,
        "channel_token_hash": resource.channel_token_hash,
        "channel_resource_id": resource.channel_resource_id,
        "channel_expires_at": resource.channel_expires_at,
        "created_at": resource.created_at,
        "updated_at": resource.updated_at,
    }


def _link(model: IntegrationLinkModel) -> Link:
    return Link(
        id=model.id,
        workspace_id=model.workspace_id,
        connection_id=model.connection_id,
        resource_id=model.resource_id,
        external_kind=cast(ExternalKind, model.external_kind),
        external_id=model.external_id,
        external_parent_id=model.external_parent_id,
        entity_type=cast(EntityType, model.entity_type),
        entity_id=model.entity_id,
        original_start=model.original_start,
        origin=cast(LinkOrigin, model.origin),
        title=model.title,
        external_url=model.external_url,
        remote_version=model.remote_version,
        remote_snapshot=model.remote_snapshot,
        local_hash=model.local_hash,
        remote_start_at=model.remote_start_at,
        status=cast(LinkStatus, model.status),
        conflict_kind=cast(ConflictKind | None, model.conflict_kind),
        conflict_detected_at=model.conflict_detected_at,
        last_seen_run_id=model.last_seen_run_id,
        last_synced_at=model.last_synced_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _link_fields(link: Link) -> dict[str, object]:
    return {
        "workspace_id": link.workspace_id,
        "connection_id": link.connection_id,
        "resource_id": link.resource_id,
        "external_kind": link.external_kind,
        "external_id": link.external_id[:500],
        "external_parent_id": link.external_parent_id[:500] if link.external_parent_id else None,
        "entity_type": link.entity_type,
        "entity_id": link.entity_id,
        "original_start": link.original_start,
        "origin": link.origin,
        "title": link.title[:300],
        "external_url": link.external_url[:2000] if link.external_url else None,
        "remote_version": link.remote_version[:500] if link.remote_version else None,
        "remote_snapshot": link.remote_snapshot,
        "local_hash": link.local_hash,
        "remote_start_at": link.remote_start_at,
        "status": link.status,
        "conflict_kind": link.conflict_kind,
        "conflict_detected_at": link.conflict_detected_at,
        "last_seen_run_id": link.last_seen_run_id,
        "last_synced_at": link.last_synced_at,
        "created_at": link.created_at,
        "updated_at": link.updated_at,
    }


def _run(model: IntegrationSyncRunModel) -> SyncRun:
    return SyncRun(
        id=model.id,
        connection_id=model.connection_id,
        resource_id=model.resource_id,
        workspace_id=model.workspace_id,
        kind=cast(RunKind, model.kind),
        trigger=cast(RunTrigger, model.trigger),
        status=cast(RunStatus, model.status),
        full=model.full,
        counts=RunCounts(
            imported=model.imported,
            updated=model.updated,
            deleted=model.deleted,
            skipped=model.skipped,
            conflicts=model.conflicts,
            exported=model.exported,
            failed=model.failed,
        ),
        error=model.error,
        attempts=model.attempts,
        cancel_requested=model.cancel_requested,
        claim_token=model.claim_token,
        lease_until=model.lease_until,
        next_attempt_at=model.next_attempt_at,
        started_at=model.started_at,
        finished_at=model.finished_at,
        created_at=model.created_at,
    )


def _run_fields(run: SyncRun) -> dict[str, object]:
    counts = run.counts
    return {
        "connection_id": run.connection_id,
        "resource_id": run.resource_id,
        "workspace_id": run.workspace_id,
        "kind": run.kind,
        "trigger": run.trigger,
        "status": run.status,
        "full": run.full,
        "imported": counts.imported,
        "updated": counts.updated,
        "deleted": counts.deleted,
        "skipped": counts.skipped,
        "conflicts": counts.conflicts,
        "exported": counts.exported,
        "failed": counts.failed,
        "error": run.error[:300] if run.error else None,
        "attempts": run.attempts,
        "cancel_requested": run.cancel_requested,
        "claim_token": run.claim_token,
        "lease_until": run.lease_until,
        "next_attempt_at": run.next_attempt_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "created_at": run.created_at,
    }


def _state(model: IntegrationOAuthStateModel) -> OAuthState:
    return OAuthState(
        id=model.id,
        state_hash=model.state_hash,
        user_id=model.user_id,
        workspace_id=model.workspace_id,
        provider=cast(ProviderId, model.provider),
        capabilities=tuple(cast(list[Capability], model.capabilities)),
        code_verifier_ciphertext=model.code_verifier_ciphertext,
        connection_id=model.connection_id,
        redirect_uri=model.redirect_uri,
        expires_at=model.expires_at,
        created_at=model.created_at,
    )


_OPEN_RUN = IntegrationSyncRunModel.status.in_(("queued", "running"))


class SqlIntegrationStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # Connections

    async def add_connection(self, connection: Connection) -> None:
        self._session.add(
            IntegrationConnectionModel(id=connection.id, **_connection_fields(connection))
        )
        await flush(self._session)

    async def get_connection(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, connection_id: uuid.UUID
    ) -> Connection | None:
        model = await self._session.scalar(
            select(IntegrationConnectionModel).where(
                IntegrationConnectionModel.id == connection_id,
                IntegrationConnectionModel.workspace_id == workspace_id,
                IntegrationConnectionModel.user_id == user_id,
            )
        )
        return _connection(model) if model else None

    async def connection_by_id(self, connection_id: uuid.UUID) -> Connection | None:
        model = await self._session.get(
            IntegrationConnectionModel, connection_id, populate_existing=True
        )
        return _connection(model) if model else None

    async def connections(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[Connection]:
        models = await self._session.scalars(
            select(IntegrationConnectionModel)
            .where(
                IntegrationConnectionModel.workspace_id == workspace_id,
                IntegrationConnectionModel.user_id == user_id,
            )
            .order_by(IntegrationConnectionModel.created_at, IntegrationConnectionModel.id)
        )
        return [_connection(m) for m in models]

    async def find_connection(
        self, workspace_id: uuid.UUID, provider: str, account_id: str
    ) -> Connection | None:
        model = await self._session.scalar(
            select(IntegrationConnectionModel).where(
                IntegrationConnectionModel.workspace_id == workspace_id,
                IntegrationConnectionModel.provider == provider,
                IntegrationConnectionModel.account_id == account_id,
            )
        )
        return _connection(model) if model else None

    async def save_connection(self, connection: Connection) -> None:
        await self._session.execute(
            update(IntegrationConnectionModel)
            .where(IntegrationConnectionModel.id == connection.id)
            .values(**_connection_fields(connection))
        )

    async def update_tokens(
        self,
        connection_id: uuid.UUID,
        expected_version: int,
        access_ciphertext: str,
        refresh_ciphertext: str | None,
        expires_at: datetime | None,
        now: datetime,
    ) -> bool:
        result = await self._session.execute(
            update(IntegrationConnectionModel)
            .where(
                IntegrationConnectionModel.id == connection_id,
                IntegrationConnectionModel.token_version == expected_version,
            )
            .values(
                access_token_ciphertext=access_ciphertext,
                refresh_token_ciphertext=refresh_ciphertext,
                token_expires_at=expires_at,
                token_version=expected_version + 1,
                updated_at=now,
            )
        )
        return _rowcount(result) == 1

    async def delete_connection(self, connection_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(IntegrationConnectionModel).where(IntegrationConnectionModel.id == connection_id)
        )

    # Resources

    async def resources(self, connection_id: uuid.UUID) -> list[Resource]:
        models = await self._session.scalars(
            select(IntegrationResourceModel)
            .where(IntegrationResourceModel.connection_id == connection_id)
            .order_by(IntegrationResourceModel.kind, IntegrationResourceModel.name)
        )
        return [_resource(m) for m in models]

    async def get_resource(
        self, connection_id: uuid.UUID, resource_id: uuid.UUID
    ) -> Resource | None:
        model = await self._session.scalar(
            select(IntegrationResourceModel).where(
                IntegrationResourceModel.id == resource_id,
                IntegrationResourceModel.connection_id == connection_id,
            )
        )
        return _resource(model) if model else None

    async def resource_by_id(self, resource_id: uuid.UUID) -> Resource | None:
        model = await self._session.get(
            IntegrationResourceModel, resource_id, populate_existing=True
        )
        return _resource(model) if model else None

    async def resource_by_channel(self, channel_id: str) -> Resource | None:
        model = await self._session.scalar(
            select(IntegrationResourceModel).where(
                IntegrationResourceModel.channel_id == channel_id
            )
        )
        return _resource(model) if model else None

    async def add_resource(self, resource: Resource) -> None:
        self._session.add(IntegrationResourceModel(id=resource.id, **_resource_fields(resource)))
        await flush(self._session)

    async def save_resource(self, resource: Resource) -> None:
        await self._session.execute(
            update(IntegrationResourceModel)
            .where(IntegrationResourceModel.id == resource.id)
            .values(**_resource_fields(resource))
        )

    async def delete_resources(self, resource_ids: Sequence[uuid.UUID]) -> None:
        if resource_ids:
            await self._session.execute(
                delete(IntegrationResourceModel).where(
                    IntegrationResourceModel.id.in_(list(resource_ids))
                )
            )

    async def due_resources(self, now: datetime, limit: int) -> list[Resource]:
        models = await self._session.scalars(
            select(IntegrationResourceModel)
            .join(
                IntegrationConnectionModel,
                IntegrationConnectionModel.id == IntegrationResourceModel.connection_id,
            )
            .where(
                IntegrationResourceModel.kind == "calendar",
                IntegrationResourceModel.enabled.is_(True),
                IntegrationResourceModel.next_sync_at.is_not(None),
                IntegrationResourceModel.next_sync_at <= now,
                IntegrationConnectionModel.status != "reauth_required",
            )
            .order_by(IntegrationResourceModel.next_sync_at)
            .limit(limit)
        )
        return [_resource(m) for m in models]

    # OAuth states

    async def add_state(self, state: OAuthState) -> None:
        self._session.add(
            IntegrationOAuthStateModel(
                id=state.id,
                state_hash=state.state_hash,
                user_id=state.user_id,
                workspace_id=state.workspace_id,
                provider=state.provider,
                capabilities=list(state.capabilities),
                code_verifier_ciphertext=state.code_verifier_ciphertext,
                connection_id=state.connection_id,
                redirect_uri=state.redirect_uri,
                expires_at=state.expires_at,
                created_at=state.created_at,
            )
        )
        await flush(self._session)

    async def take_state(self, state_hash: str) -> OAuthState | None:
        model = await self._session.scalar(
            select(IntegrationOAuthStateModel).where(
                IntegrationOAuthStateModel.state_hash == state_hash
            )
        )
        if model is None:
            return None
        state = _state(model)
        # Conditional delete: of two concurrent completions, only one gets the state.
        result = await self._session.execute(
            delete(IntegrationOAuthStateModel).where(IntegrationOAuthStateModel.id == model.id)
        )
        return state if _rowcount(result) == 1 else None

    async def purge_states(self, now: datetime) -> int:
        result = await self._session.execute(
            delete(IntegrationOAuthStateModel).where(IntegrationOAuthStateModel.expires_at <= now)
        )
        return _rowcount(result)

    # Links

    async def find_link(
        self, connection_id: uuid.UUID, external_kind: ExternalKind, external_id: str
    ) -> Link | None:
        model = await self._session.scalar(
            select(IntegrationLinkModel)
            .where(
                IntegrationLinkModel.connection_id == connection_id,
                IntegrationLinkModel.external_kind == external_kind,
                IntegrationLinkModel.external_id == external_id,
            )
            .limit(1)
        )
        return _link(model) if model else None

    async def links_for_external(
        self, connection_id: uuid.UUID, external_kind: ExternalKind, external_id: str
    ) -> list[Link]:
        models = await self._session.scalars(
            select(IntegrationLinkModel)
            .where(
                IntegrationLinkModel.connection_id == connection_id,
                IntegrationLinkModel.external_kind == external_kind,
                IntegrationLinkModel.external_id == external_id,
            )
            .order_by(IntegrationLinkModel.created_at)
        )
        return [_link(m) for m in models]

    async def links_for_entity(
        self, workspace_id: uuid.UUID, entity_type: EntityType, entity_id: uuid.UUID
    ) -> list[Link]:
        models = await self._session.scalars(
            select(IntegrationLinkModel)
            .where(
                IntegrationLinkModel.workspace_id == workspace_id,
                IntegrationLinkModel.entity_type == entity_type,
                IntegrationLinkModel.entity_id == entity_id,
            )
            .order_by(IntegrationLinkModel.created_at)
        )
        return [_link(m) for m in models]

    async def get_link(self, workspace_id: uuid.UUID, link_id: uuid.UUID) -> Link | None:
        model = await self._session.scalar(
            select(IntegrationLinkModel)
            .where(
                IntegrationLinkModel.id == link_id,
                IntegrationLinkModel.workspace_id == workspace_id,
            )
            .execution_options(populate_existing=True)
        )
        return _link(model) if model else None

    async def add_link(self, link: Link) -> None:
        self._session.add(IntegrationLinkModel(id=link.id, **_link_fields(link)))
        await flush(self._session)

    async def save_link(self, link: Link) -> None:
        await self._session.execute(
            update(IntegrationLinkModel)
            .where(IntegrationLinkModel.id == link.id)
            .values(**_link_fields(link))
        )

    async def delete_links(self, link_ids: Sequence[uuid.UUID]) -> None:
        if link_ids:
            await self._session.execute(
                delete(IntegrationLinkModel).where(IntegrationLinkModel.id.in_(list(link_ids)))
            )

    async def resource_links(self, resource_id: uuid.UUID) -> list[Link]:
        models = await self._session.scalars(
            select(IntegrationLinkModel)
            .where(IntegrationLinkModel.resource_id == resource_id)
            .order_by(IntegrationLinkModel.created_at, IntegrationLinkModel.id)
            .execution_options(populate_existing=True)
        )
        return [_link(m) for m in models]

    async def child_links(self, resource_id: uuid.UUID, parent_id: str) -> list[Link]:
        models = await self._session.scalars(
            select(IntegrationLinkModel)
            .where(
                IntegrationLinkModel.resource_id == resource_id,
                IntegrationLinkModel.external_parent_id == parent_id,
            )
            .order_by(IntegrationLinkModel.created_at, IntegrationLinkModel.id)
            .execution_options(populate_existing=True)
        )
        return [_link(m) for m in models]

    async def connection_links(
        self, connection_id: uuid.UUID, external_kind: ExternalKind | None = None
    ) -> list[Link]:
        query = select(IntegrationLinkModel).where(
            IntegrationLinkModel.connection_id == connection_id
        )
        if external_kind is not None:
            query = query.where(IntegrationLinkModel.external_kind == external_kind)
        models = await self._session.scalars(
            query.order_by(IntegrationLinkModel.created_at, IntegrationLinkModel.id)
        )
        return [_link(m) for m in models]

    async def conflicts(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[Link]:
        models = await self._session.scalars(
            select(IntegrationLinkModel)
            .join(
                IntegrationConnectionModel,
                IntegrationConnectionModel.id == IntegrationLinkModel.connection_id,
            )
            .where(
                IntegrationLinkModel.workspace_id == workspace_id,
                IntegrationConnectionModel.user_id == user_id,
                IntegrationLinkModel.status == "conflict",
            )
            .order_by(IntegrationLinkModel.conflict_detected_at, IntegrationLinkModel.id)
        )
        return [_link(m) for m in models]

    async def count_links(
        self, connection_id: uuid.UUID, external_kind: ExternalKind, status: str | None = None
    ) -> int:
        query = select(func.count()).where(
            IntegrationLinkModel.connection_id == connection_id,
            IntegrationLinkModel.external_kind == external_kind,
        )
        if status is not None:
            query = query.where(IntegrationLinkModel.status == status)
        return int(await self._session.scalar(query) or 0)

    # Runs

    async def add_run(self, run: SyncRun) -> None:
        self._session.add(IntegrationSyncRunModel(id=run.id, **_run_fields(run)))
        await flush(self._session)

    async def get_run(self, connection_id: uuid.UUID, run_id: uuid.UUID) -> SyncRun | None:
        model = await self._session.scalar(
            select(IntegrationSyncRunModel).where(
                IntegrationSyncRunModel.id == run_id,
                IntegrationSyncRunModel.connection_id == connection_id,
            )
        )
        return _run(model) if model else None

    async def run_by_id(self, run_id: uuid.UUID) -> SyncRun | None:
        model = await self._session.get(IntegrationSyncRunModel, run_id, populate_existing=True)
        return _run(model) if model else None

    async def save_run(self, run: SyncRun) -> None:
        await self._session.execute(
            update(IntegrationSyncRunModel)
            .where(IntegrationSyncRunModel.id == run.id)
            .values(**_run_fields(run))
        )

    async def runs(self, connection_id: uuid.UUID, limit: int) -> list[SyncRun]:
        models = await self._session.scalars(
            select(IntegrationSyncRunModel)
            .where(IntegrationSyncRunModel.connection_id == connection_id)
            .order_by(IntegrationSyncRunModel.created_at.desc(), IntegrationSyncRunModel.id)
            .limit(limit)
        )
        return [_run(m) for m in models]

    async def open_run(
        self, connection_id: uuid.UUID, resource_id: uuid.UUID | None, kind: RunKind
    ) -> SyncRun | None:
        resource = (
            IntegrationSyncRunModel.resource_id.is_(None)
            if resource_id is None
            else IntegrationSyncRunModel.resource_id == resource_id
        )
        model = await self._session.scalar(
            select(IntegrationSyncRunModel)
            .where(
                IntegrationSyncRunModel.connection_id == connection_id,
                IntegrationSyncRunModel.kind == kind,
                resource,
                _OPEN_RUN,
                IntegrationSyncRunModel.cancel_requested.is_(False),
            )
            .limit(1)
        )
        return _run(model) if model else None

    async def claim_runs(self, now: datetime, lease_until: datetime, limit: int) -> list[SyncRun]:
        due = or_(
            and_(
                IntegrationSyncRunModel.status == "queued",
                or_(
                    IntegrationSyncRunModel.next_attempt_at.is_(None),
                    IntegrationSyncRunModel.next_attempt_at <= now,
                ),
            ),
            and_(
                IntegrationSyncRunModel.status == "running",
                or_(
                    IntegrationSyncRunModel.lease_until.is_(None),
                    IntegrationSyncRunModel.lease_until < now,
                ),
            ),
        )
        ids = list(
            await self._session.scalars(
                select(IntegrationSyncRunModel.id)
                .where(due)
                .order_by(IntegrationSyncRunModel.created_at, IntegrationSyncRunModel.id)
                .limit(limit)
            )
        )
        claimed: list[SyncRun] = []
        for run_id in ids:
            # Conditional update: of two workers, the first to update wins.
            result = await self._session.execute(
                update(IntegrationSyncRunModel)
                .where(IntegrationSyncRunModel.id == run_id, due)
                .values(status="running", claim_token=uuid.uuid4(), lease_until=lease_until)
            )
            if _rowcount(result) == 1:
                run = await self.run_by_id(run_id)
                if run is not None:
                    claimed.append(run)
        return claimed

    async def connections_with_files(self) -> list[uuid.UUID]:
        ids = await self._session.scalars(
            select(IntegrationLinkModel.connection_id)
            .where(IntegrationLinkModel.external_kind == "file")
            .distinct()
        )
        return list(ids)

    # Read-only views of other modules

    async def event_exception(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, original_start: datetime
    ) -> EventException | None:
        model = await self._session.scalar(
            select(CalendarEventExceptionModel)
            .where(
                CalendarEventExceptionModel.workspace_id == workspace_id,
                CalendarEventExceptionModel.event_id == event_id,
                CalendarEventExceptionModel.original_start == original_start,
            )
            .execution_options(populate_existing=True)
        )
        return _to_exception(model) if model else None


class FlushTransaction:
    """A module service's commit, deferred: it flushes (surfacing constraint violations), and
    the integration service commits the record together with its link."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def commit(self) -> None:
        await flush(self._session)

    async def rollback(self) -> None:
        await self._session.rollback()


class NotificationNotifier:
    """Integration problems as in-app notifications, through the notifications table."""

    def __init__(self, session: AsyncSession, clock: Callable[[], datetime]) -> None:
        self._notifications = SqlNotificationRepository(session)
        self._clock = clock

    async def notify(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, title: str, body: str
    ) -> None:
        now = self._clock()
        await self._notifications.add(
            Notification(
                id=uuid.uuid4(),
                user_id=user_id,
                workspace_id=workspace_id,
                reminder_id=None,
                occurrence_id=None,
                title=title[:200],
                body=body[:2000],
                scheduled_for=now,
                created_at=now,
                read_at=None,
            )
        )


@dataclass(frozen=True, slots=True)
class Integrations:
    service: IntegrationService
    mail: MailService
    files: FileService
    runner: SyncRunner
    calendar_sync: CalendarSync


def build_integrations(
    session: AsyncSession,
    settings: Settings,
    connectors: ConnectorRegistry,
    clock: Callable[[], datetime] = utc_now,
) -> Integrations:
    store = SqlIntegrationStore(session)
    transaction = SqlTransaction(session)
    deferred = FlushTransaction(session)
    secrets = IntegrationSecretBox.from_settings(settings)
    tokens = TokenManager(
        store, secrets, connectors, transaction, NotificationNotifier(session, clock), clock
    )
    calendar = CalendarService(
        SqlCalendarRepository(session),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        deferred,
        clock,
    )
    documents = DocumentService(
        SqlDocumentStore(session),
        FileAttachmentStore(settings.attachments_dir),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        deferred,
        clock,
    )
    webhook = str(settings.integrations_webhook_url) if settings.integrations_webhook_url else None
    calendar_sync = CalendarSync(
        store, calendar, tokens, connectors, transaction, webhook_url=webhook, clock=clock
    )
    service = IntegrationService(
        store,
        secrets,
        connectors,
        tokens,
        calendar_sync,
        calendar,
        documents,
        transaction,
        enabled=settings.integrations_enabled,
        redirect_uri=str(settings.integrations_redirect_url),
        clock=clock,
    )
    mail = MailService(
        store,
        tokens,
        connectors,
        TaskService(SqlTaskRepository(session), deferred, clock),
        NoteService(
            SqlNoteRepository(session),
            SqlNoteFolderRepository(session),
            SqlNoteTagRepository(session),
            SqlTaskRepository(session),
            deferred,
        ),
        ReminderService(
            SqlReminderRepository(session),
            SqlOccurrenceRepository(session),
            SqlTaskRepository(session),
            deferred,
        ),
        transaction,
        clock,
    )
    files = FileService(
        store,
        tokens,
        connectors,
        documents,
        transaction,
        max_bytes=settings.document_max_bytes,
        clock=clock,
    )
    runner = SyncRunner(store, service, calendar_sync, files, transaction, clock)
    return Integrations(service, mail, files, runner, calendar_sync)
