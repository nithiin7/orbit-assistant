"""Mail, on demand. Orbit never copies a mailbox: messages are read from the provider when the
person opens them, limited to the labels (Gmail) or folders (Outlook) they selected and to a
recent period they chose. Orbit stores only links from its own records (tasks, notes,
reminders created from a message) to the message's ID, with the subject as the link's title.
Nothing is ever sent.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from orbit_api.services.integrations.connectors import (
    ConnectorRegistry,
    MailConnector,
    MailQuery,
    MessageDetail,
    MessagePage,
    MessageSummary,
    RemoteLabel,
)
from orbit_api.services.integrations.models import (
    DEFAULT_SYNC_INTERVAL,
    CapabilityNotGrantedError,
    Connection,
    EntityType,
    Link,
    LinkNotFoundError,
    OutOfScopeError,
    ProviderNotConfiguredError,
    Resource,
)
from orbit_api.services.integrations.store import IntegrationStore
from orbit_api.services.integrations.tokens import TokenManager
from orbit_api.services.notes.models import NoteDetail, NoteDraft
from orbit_api.services.notes.service import NoteService
from orbit_api.services.reminders.models import ReminderDraft, ReminderView
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.tasks.models import Task, TaskDraft
from orbit_api.services.tasks.service import TaskService
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now


@dataclass(frozen=True, slots=True)
class LabelChoice:
    label: RemoteLabel
    selected: bool


class MailService:
    def __init__(
        self,
        store: IntegrationStore,
        tokens: TokenManager,
        connectors: ConnectorRegistry,
        tasks: TaskService,
        notes: NoteService,
        reminders: ReminderService,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._tokens = tokens
        self._connectors = connectors
        self._tasks = tasks
        self._notes = notes
        self._reminders = reminders
        self._transaction = transaction
        self._clock = clock

    async def labels(self, connection: Connection) -> list[LabelChoice]:
        mail = self._mail(connection)
        remote = await self._tokens.call(connection, mail.labels)
        selected = {r.external_id for r in await self._selected(connection)}
        return [LabelChoice(label, label.external_id in selected) for label in remote]

    async def select_labels(
        self, connection: Connection, label_ids: list[str]
    ) -> list[LabelChoice]:
        """Choose which labels Orbit may list. Only labels the account really has are kept."""
        mail = self._mail(connection)
        remote = {
            label.external_id: label for label in await self._tokens.call(connection, mail.labels)
        }
        wanted = {label_id for label_id in label_ids if label_id in remote}
        existing = {
            r.external_id: r
            for r in await self._store.resources(connection.id)
            if r.kind == "mail_label"
        }
        now = self._clock()
        for label_id in wanted - existing.keys():
            label = remote[label_id]
            await self._store.add_resource(
                Resource(
                    id=uuid.uuid4(),
                    connection_id=connection.id,
                    workspace_id=connection.workspace_id,
                    kind="mail_label",
                    external_id=label_id,
                    name=label.name[:200] or "Mail",
                    enabled=True,
                    writable=False,
                    direction="import",
                    sync_interval_minutes=DEFAULT_SYNC_INTERVAL,
                    category_id=None,
                    timezone=None,
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
        await self._store.delete_resources(
            [r.id for label_id, r in existing.items() if label_id not in wanted]
        )
        await self._transaction.commit()
        return await self.labels(connection)

    async def messages(
        self, connection: Connection, label_id: str, search: str | None, page: str | None
    ) -> MessagePage:
        mail = self._mail(connection)
        if label_id not in {r.external_id for r in await self._selected(connection)}:
            raise OutOfScopeError
        query = MailQuery(
            label_id=label_id, since=self._since(connection), search=search, page=page
        )
        result = await self._tokens.call(connection, lambda token: mail.messages(token, query))
        # Providers filter by date already; this guards against one that doesn't.
        return MessagePage(
            [m for m in result.messages if self._in_range(connection, m)], result.next_page
        )

    async def message(
        self, connection: Connection, message_id: str
    ) -> tuple[MessageDetail, list[Link]]:
        """One message's content, read from the provider when the person opens it."""
        detail = await self._message(connection, message_id)
        links = await self._store.links_for_external(connection.id, "message", message_id)
        return detail, links

    async def create_task(self, connection: Connection, message_id: str, draft: TaskDraft) -> Task:
        summary = (await self._message(connection, message_id)).summary
        task = await self._tasks.create(connection.workspace_id, draft)
        await self._link(connection, summary, "task", task.id)
        return task

    async def create_note(
        self, connection: Connection, message_id: str, draft: NoteDraft
    ) -> NoteDetail:
        summary = (await self._message(connection, message_id)).summary
        note = await self._notes.create(connection.workspace_id, draft)
        await self._link(connection, summary, "note", note.note.id)
        return note

    async def create_reminder(
        self,
        connection: Connection,
        message_id: str,
        draft: ReminderDraft,
        default_timezone: str | None,
    ) -> ReminderView:
        summary = (await self._message(connection, message_id)).summary
        view = await self._reminders.create(
            connection.workspace_id, draft, default_timezone=default_timezone
        )
        await self._link(connection, summary, "reminder", view.reminder.id)
        return view

    async def unlink(self, connection: Connection, link_id: uuid.UUID) -> None:
        link = await self._store.get_link(connection.workspace_id, link_id)
        if link is None or link.connection_id != connection.id or link.external_kind != "message":
            raise LinkNotFoundError
        await self._store.delete_links([link.id])
        await self._transaction.commit()

    # Helpers

    async def _message(self, connection: Connection, message_id: str) -> MessageDetail:
        mail = self._mail(connection)
        detail = await self._tokens.call(connection, lambda token: mail.message(token, message_id))
        selected = {r.external_id for r in await self._selected(connection)}
        if not selected & set(detail.summary.label_ids) or not self._in_range(
            connection, detail.summary
        ):
            raise OutOfScopeError
        return detail

    async def _link(
        self,
        connection: Connection,
        message: MessageSummary,
        entity_type: EntityType,
        entity_id: uuid.UUID,
    ) -> None:
        now = self._clock()
        await self._store.add_link(
            Link(
                id=uuid.uuid4(),
                workspace_id=connection.workspace_id,
                connection_id=connection.id,
                resource_id=None,
                external_kind="message",
                external_id=message.external_id,
                external_parent_id=message.thread_id,
                entity_type=entity_type,
                entity_id=entity_id,
                original_start=None,
                origin="linked",
                title=(message.subject or "(No subject)")[:300],
                external_url=message.url,
                remote_version=None,
                remote_snapshot=None,
                local_hash=None,
                remote_start_at=message.received_at,
                status="synced",
                conflict_kind=None,
                conflict_detected_at=None,
                last_seen_run_id=None,
                last_synced_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        # The record and its link commit together.
        await self._transaction.commit()

    async def _selected(self, connection: Connection) -> list[Resource]:
        return [
            r
            for r in await self._store.resources(connection.id)
            if r.kind == "mail_label" and r.enabled
        ]

    def _since(self, connection: Connection) -> date:
        return (self._clock() - timedelta(days=connection.mail_days)).date()

    def _in_range(self, connection: Connection, message: MessageSummary) -> bool:
        return message.received_at.date() >= self._since(connection)

    def _mail(self, connection: Connection) -> MailConnector:
        if "mail" not in connection.capabilities:
            raise CapabilityNotGrantedError
        provider = self._connectors.get(connection.provider)
        if provider is None or provider.mail is None:
            raise ProviderNotConfiguredError
        return provider.mail
