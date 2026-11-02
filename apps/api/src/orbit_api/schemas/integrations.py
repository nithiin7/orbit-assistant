"""Request and response models for external integrations. Tokens and client secrets are never
part of any response."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from orbit_api.schemas.common import SearchText
from orbit_api.services.integrations.connectors import (
    MessageDetail,
    MessageSummary,
    RemoteFile,
)
from orbit_api.services.integrations.mail import LabelChoice
from orbit_api.services.integrations.models import (
    Capability,
    ConflictKind,
    ConflictResolution,
    Connection,
    ConnectionDetail,
    ConnectionStatus,
    EntityType,
    ExternalKind,
    Link,
    LinkOrigin,
    LinkStatus,
    ProviderId,
    ProviderInfo,
    Resource,
    ResourceKind,
    RunKind,
    RunStatus,
    RunTrigger,
    SyncDirection,
    SyncRun,
)
from orbit_api.services.integrations.service import LinkedOrigin

ExternalId = Annotated[str, StringConstraints(min_length=1, max_length=500, pattern=r"^[^\s/]+$")]
PageToken = Annotated[str, StringConstraints(min_length=1, max_length=4000)] | None

# What each capability reads and why, shown before connecting.
CAPABILITY_PURPOSES: dict[Capability, str] = {
    "calendar": "Read your calendars and their events, to show the ones you choose in Orbit.",
    "calendar_write": (
        "Change and create events, so edits you make in Orbit to synced events reach your calendar."
    ),
    "mail": (
        "Read messages in the labels or folders you choose, when you open them, so you can turn "
        "an email into a task, note, or reminder. Orbit never sends, deletes, or changes mail."
    ),
    "files": (
        "Browse and read files, so you can import the ones you pick into Documents. Orbit never "
        "changes or deletes them."
    ),
}


class IntegrationCapabilityResponse(BaseModel):
    capability: Capability
    purpose: str
    scopes: list[str] = Field(description="The provider permissions requested for it.")


class IntegrationProviderResponse(BaseModel):
    provider: ProviderId
    name: str
    configured: bool = Field(
        description="Whether this server has an OAuth client for the provider."
    )
    capabilities: list[IntegrationCapabilityResponse]

    @classmethod
    def of(cls, info: ProviderInfo) -> "IntegrationProviderResponse":
        return cls(
            provider=info.provider,
            name=info.name,
            configured=info.configured,
            capabilities=[
                IntegrationCapabilityResponse(
                    capability=c,
                    purpose=CAPABILITY_PURPOSES[c],
                    scopes=list(info.scopes.get(c, ())),
                )
                for c in info.capabilities
            ],
        )


class IntegrationProviderListResponse(BaseModel):
    providers: list[IntegrationProviderResponse]
    webhooks: bool = Field(description="Whether providers push changes (else Orbit polls).")


class AuthorizeIntegrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: ProviderId
    capabilities: list[Capability] = Field(min_length=1, max_length=4)
    connection_id: uuid.UUID | None = Field(
        default=None, description="Reconnect this connection (renew access or add capabilities)."
    )


class AuthorizeIntegrationResponse(BaseModel):
    authorization_url: str


class CompleteAuthorizationRequest(BaseModel):
    """What the provider sent back to the callback page."""

    model_config = ConfigDict(extra="forbid")

    state: Annotated[str, StringConstraints(min_length=16, max_length=200)]
    code: Annotated[str, StringConstraints(min_length=1, max_length=4000)] | None = None
    error: Annotated[str, StringConstraints(max_length=200)] | None = None


class IntegrationConnectionResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    provider: ProviderId
    account_email: str
    display_name: str
    capabilities: list[Capability]
    scopes: list[str] = Field(description="Permissions the account granted.")
    status: ConnectionStatus
    mail_days: int
    last_synced_at: datetime | None
    last_error: str | None
    created_at: datetime

    @classmethod
    def of(cls, connection: Connection) -> "IntegrationConnectionResponse":
        return cls(
            id=connection.id,
            workspace_id=connection.workspace_id,
            provider=connection.provider,
            account_email=connection.account_email,
            display_name=connection.display_name,
            capabilities=list(connection.capabilities),
            scopes=list(connection.scopes),
            status=connection.status,
            mail_days=connection.mail_days,
            last_synced_at=connection.last_synced_at,
            last_error=connection.last_error,
            created_at=connection.created_at,
        )


class IntegrationConnectionListResponse(BaseModel):
    connections: list[IntegrationConnectionResponse]


class IntegrationCalendarResponse(BaseModel):
    id: uuid.UUID
    kind: ResourceKind
    external_id: str
    name: str
    enabled: bool
    writable: bool
    direction: SyncDirection
    sync_interval_minutes: int
    category_id: uuid.UUID | None
    timezone: str | None
    last_synced_at: datetime | None
    next_sync_at: datetime | None
    last_error: str | None
    push: bool = Field(description="Whether the provider pushes changes for it.")

    @classmethod
    def of(cls, resource: Resource) -> "IntegrationCalendarResponse":
        return cls(
            id=resource.id,
            kind=resource.kind,
            external_id=resource.external_id,
            name=resource.name,
            enabled=resource.enabled,
            writable=resource.writable,
            direction=resource.direction,
            sync_interval_minutes=resource.sync_interval_minutes,
            category_id=resource.category_id,
            timezone=resource.timezone,
            last_synced_at=resource.last_synced_at,
            next_sync_at=resource.next_sync_at,
            last_error=resource.last_error,
            push=resource.channel_id is not None,
        )


class IntegrationCalendarListResponse(BaseModel):
    resources: list[IntegrationCalendarResponse]


class IntegrationSyncRunResponse(BaseModel):
    id: uuid.UUID
    resource_id: uuid.UUID | None
    kind: RunKind
    trigger: RunTrigger
    status: RunStatus
    full: bool
    imported: int
    updated: int
    deleted: int
    skipped: int
    conflicts: int
    exported: int
    failed: int
    error: str | None
    attempts: int
    next_attempt_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime

    @classmethod
    def of(cls, run: SyncRun) -> "IntegrationSyncRunResponse":
        c = run.counts
        return cls(
            id=run.id,
            resource_id=run.resource_id,
            kind=run.kind,
            trigger=run.trigger,
            status=run.status,
            full=run.full,
            imported=c.imported,
            updated=c.updated,
            deleted=c.deleted,
            skipped=c.skipped,
            conflicts=c.conflicts,
            exported=c.exported,
            failed=c.failed,
            error=run.error,
            attempts=run.attempts,
            next_attempt_at=run.next_attempt_at if run.status == "queued" else None,
            started_at=run.started_at,
            finished_at=run.finished_at,
            created_at=run.created_at,
        )


class IntegrationSyncRunListResponse(BaseModel):
    runs: list[IntegrationSyncRunResponse]


class IntegrationConnectionDetailResponse(BaseModel):
    connection: IntegrationConnectionResponse
    resources: list[IntegrationCalendarResponse]
    runs: list[IntegrationSyncRunResponse]
    conflicts: int
    imported_files: int

    @classmethod
    def of(cls, detail: ConnectionDetail) -> "IntegrationConnectionDetailResponse":
        return cls(
            connection=IntegrationConnectionResponse.of(detail.connection),
            resources=[
                IntegrationCalendarResponse.of(r) for r in detail.resources if r.kind == "calendar"
            ],
            runs=[IntegrationSyncRunResponse.of(r) for r in detail.runs],
            conflicts=detail.conflicts,
            imported_files=detail.imported_files,
        )


class UpdateIntegrationConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mail_days: Literal[7, 30, 90, 365] | None = None


class UpdateIntegrationCalendarRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    direction: SyncDirection | None = None
    sync_interval_minutes: Literal[0, 15, 30, 60, 360, 1440] | None = None
    category_id: uuid.UUID | None = None
    clear_category: bool = False


class IntegrationSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_id: uuid.UUID | None = None


class DisconnectIntegrationResponse(BaseModel):
    revoked: bool = Field(
        description="Whether the provider confirmed revoking access. When false, remove Orbit "
        "from the account's app permissions page; Orbit has deleted its tokens either way."
    )
    removed_events: int
    trashed_documents: int


class IntegrationLinkResponse(BaseModel):
    id: uuid.UUID
    connection_id: uuid.UUID
    external_kind: ExternalKind
    external_id: str
    entity_type: EntityType
    entity_id: uuid.UUID
    origin: LinkOrigin
    title: str
    external_url: str | None
    status: LinkStatus
    conflict_kind: ConflictKind | None
    conflict_detected_at: datetime | None
    last_synced_at: datetime | None

    @classmethod
    def of(cls, link: Link) -> "IntegrationLinkResponse":
        return cls(
            id=link.id,
            connection_id=link.connection_id,
            external_kind=link.external_kind,
            external_id=link.external_id,
            entity_type=link.entity_type,
            entity_id=link.entity_id,
            origin=link.origin,
            title=link.title,
            external_url=link.external_url,
            status=link.status,
            conflict_kind=link.conflict_kind,
            conflict_detected_at=link.conflict_detected_at,
            last_synced_at=link.last_synced_at,
        )


class IntegrationConflictVersion(BaseModel):
    title: str
    start: str
    end: str
    all_day: bool
    location: str


class IntegrationConflictResponse(BaseModel):
    link: IntegrationLinkResponse
    provider: ProviderId
    account_email: str
    external: IntegrationConflictVersion | None = Field(
        description="The provider's version; `null` when it was deleted there."
    )


class IntegrationConflictListResponse(BaseModel):
    conflicts: list[IntegrationConflictResponse]


class ResolveIntegrationConflictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolution: ConflictResolution


class ResolveIntegrationConflictResponse(BaseModel):
    link: IntegrationLinkResponse | None = Field(
        description="`null` when the link no longer exists (deleted, or kept only in Orbit)."
    )


class IntegrationOriginResponse(BaseModel):
    link: IntegrationLinkResponse
    provider: ProviderId
    account_email: str
    resource_name: str | None
    two_way: bool = Field(description="Whether Orbit changes to the record are sent back.")

    @classmethod
    def of(cls, origin: LinkedOrigin) -> "IntegrationOriginResponse":
        return cls(
            link=IntegrationLinkResponse.of(origin.link),
            provider=origin.provider,
            account_email=origin.account_email,
            resource_name=origin.resource_name,
            two_way=origin.two_way,
        )


class IntegrationOriginListResponse(BaseModel):
    origins: list[IntegrationOriginResponse]


class OriginParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: EntityType
    entity_id: uuid.UUID


class ExportEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID


# Mail


class MailLabelResponse(BaseModel):
    id: str
    name: str
    system: bool
    selected: bool

    @classmethod
    def of(cls, choice: LabelChoice) -> "MailLabelResponse":
        label = choice.label
        return cls(
            id=label.external_id, name=label.name, system=label.system, selected=choice.selected
        )


class MailLabelListResponse(BaseModel):
    labels: list[MailLabelResponse]


class SelectLabelsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label_ids: list[ExternalId] = Field(max_length=50)


class MessageParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label_id: ExternalId
    q: SearchText = None
    page: PageToken = None


class MessageSummaryResponse(BaseModel):
    id: str
    thread_id: str | None
    subject: str
    sender: str
    received_at: datetime
    snippet: str
    url: str | None

    @classmethod
    def of(cls, message: MessageSummary) -> "MessageSummaryResponse":
        return cls(
            id=message.external_id,
            thread_id=message.thread_id,
            subject=message.subject,
            sender=message.sender,
            received_at=message.received_at,
            snippet=message.snippet,
            url=message.url,
        )


class MessageListResponse(BaseModel):
    messages: list[MessageSummaryResponse]
    next_page: str | None


class MessageDetailResponse(BaseModel):
    message: MessageSummaryResponse
    recipients: list[str]
    body: str = Field(description="Plain text. HTML is reduced to its text, never rendered.")
    links: list[IntegrationLinkResponse]

    @classmethod
    def of(cls, detail: MessageDetail, links: list[Link]) -> "MessageDetailResponse":
        return cls(
            message=MessageSummaryResponse.of(detail.summary),
            recipients=list(detail.recipients),
            body=detail.body,
            links=[IntegrationLinkResponse.of(link) for link in links],
        )


# Files


class FileParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    folder_id: ExternalId | None = None
    q: SearchText = None
    page: PageToken = None


class RemoteFileResponse(BaseModel):
    id: str
    name: str
    folder: bool
    mime_type: str
    size: int | None
    modified_at: datetime | None
    url: str | None
    imported: IntegrationLinkResponse | None

    @classmethod
    def of(cls, file: RemoteFile, link: Link | None) -> "RemoteFileResponse":
        return cls(
            id=file.external_id,
            name=file.name,
            folder=file.folder,
            mime_type=file.mime_type,
            size=file.size,
            modified_at=file.modified_at,
            url=file.url,
            imported=IntegrationLinkResponse.of(link) if link else None,
        )


class RemoteFileListResponse(BaseModel):
    files: list[RemoteFileResponse]
    next_page: str | None


class IntegrationRecordResponse(BaseModel):
    """A record created from an email."""

    kind: Literal["task", "note", "reminder"]
    id: uuid.UUID
    title: str


class ImportFileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    folder_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None


class ImportedFileResponse(BaseModel):
    document_id: uuid.UUID
    title: str
    link: IntegrationLinkResponse
