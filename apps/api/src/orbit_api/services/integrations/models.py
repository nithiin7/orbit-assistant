"""Integration types: connections, selected resources, links between external and Orbit
records, synchronization runs, and the errors the framework raises.

Tokens never appear in these types in plain text: a connection carries only their ciphertexts,
and decrypted tokens exist only inside `TokenManager` and the provider adapters it calls.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final, Literal, get_args

ProviderId = Literal["google", "microsoft"]
PROVIDER_IDS: Final[tuple[ProviderId, ...]] = get_args(ProviderId)

# What a connection may do. Each maps to the provider's narrowest scopes for it.
Capability = Literal["calendar", "calendar_write", "mail", "files"]
CAPABILITIES: Final[tuple[Capability, ...]] = get_args(Capability)

# `active`: working. `reauth_required`: the provider refused the tokens (expired, revoked, or a
# changed password); reconnecting fixes it. `error`: the last check failed for another reason.
ConnectionStatus = Literal["active", "reauth_required", "error"]

ResourceKind = Literal["calendar", "mail_label"]
# `import`: provider → Orbit only. `two_way`: Orbit changes to linked events are sent back.
SyncDirection = Literal["import", "two_way"]
# Minutes between automatic synchronizations; 0 is manual only.
SYNC_INTERVALS: Final[tuple[int, ...]] = (0, 15, 30, 60, 360, 1440)
DEFAULT_SYNC_INTERVAL: Final = 60

RunKind = Literal["calendar", "files"]
RunTrigger = Literal["manual", "scheduled", "webhook", "initial", "retry"]
RunStatus = Literal["queued", "running", "succeeded", "partial", "failed", "cancelled"]
FINISHED_RUN_STATUSES: Final[frozenset[RunStatus]] = frozenset(
    {"succeeded", "partial", "failed", "cancelled"}
)

ExternalKind = Literal["event", "message", "file"]
EntityType = Literal["event", "task", "note", "reminder", "document"]
# `external`: imported from the provider. `orbit`: created in Orbit and sent to the provider.
# `linked`: an Orbit record that only refers to an external one (an email).
LinkOrigin = Literal["external", "orbit", "linked"]
LinkStatus = Literal[
    "synced",
    # Both sides changed since the last synchronization; nothing was overwritten.
    "conflict",
    # Changed in Orbit on an import-only calendar (or a repeating event): not sent back.
    "local_changes",
    # The external file changed after it was imported.
    "update_available",
    # The external file was deleted, or Orbit can no longer access it.
    "missing",
    # The Orbit record was deleted; external changes to it are ignored.
    "deleted_locally",
]
ConflictKind = Literal["both_changed", "deleted_remotely"]
ConflictResolution = Literal["keep_orbit", "keep_external"]

MAIL_DAY_OPTIONS: Final[tuple[int, ...]] = (7, 30, 90, 365)
DEFAULT_MAIL_DAYS: Final = 30
# How long a started authorization stays valid.
OAUTH_STATE_TTL_SECONDS: Final = 600


@dataclass(frozen=True, slots=True)
class Connection:
    """A connected external account. It belongs to one person and one workspace: imported
    records go to that workspace."""

    id: uuid.UUID
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    provider: ProviderId
    # The provider's stable account ID (Google `sub`, Microsoft object ID).
    account_id: str
    account_email: str
    display_name: str
    scopes: tuple[str, ...]
    capabilities: tuple[Capability, ...]
    status: ConnectionStatus
    access_token_ciphertext: str
    refresh_token_ciphertext: str | None
    token_expires_at: datetime | None
    # Incremented on every token change, so concurrent refreshes can't overwrite each other.
    token_version: int
    mail_days: int
    last_synced_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Resource:
    """A calendar or mail label of a connection, and how Orbit synchronizes it."""

    id: uuid.UUID
    connection_id: uuid.UUID
    workspace_id: uuid.UUID
    kind: ResourceKind
    external_id: str
    name: str
    # Selected by the person. Nothing is synchronized or listed until it is.
    enabled: bool
    # The provider's own permission: a calendar shared read-only can't be written to.
    writable: bool
    direction: SyncDirection
    sync_interval_minutes: int
    # Imported events get this calendar category.
    category_id: uuid.UUID | None
    # The calendar's IANA time zone, used for all-day events and floating times.
    timezone: str | None
    # Incremental synchronization state: the provider's sync token or delta link.
    cursor: str | None
    # The next page of a synchronization in progress, so an interrupted run resumes.
    checkpoint: str | None
    # Start of a windowed synchronization (Microsoft calendar views).
    window_start: datetime | None
    next_sync_at: datetime | None
    last_synced_at: datetime | None
    last_error: str | None
    # Push notification channel, when webhooks are configured.
    channel_id: str | None
    channel_token_hash: str | None
    channel_resource_id: str | None
    channel_expires_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Link:
    """An external record and the Orbit record it maps to. Orbit records carry no provider
    columns of their own; this is where their origin lives."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    connection_id: uuid.UUID
    resource_id: uuid.UUID | None
    external_kind: ExternalKind
    external_id: str
    # A series' master (for occurrences), an email's thread, or a file's folder.
    external_parent_id: str | None
    entity_type: EntityType
    entity_id: uuid.UUID
    # For an occurrence of an imported series: its original local start (RECURRENCE-ID).
    original_start: datetime | None
    origin: LinkOrigin
    title: str
    external_url: str | None
    # The provider's version of what was last applied (ETag, change key, checksum).
    remote_version: str | None
    # The provider's record as last seen, normalized; applied when "keep external" is chosen.
    remote_snapshot: dict[str, object] | None
    # A fingerprint of the Orbit record as last synchronized, to detect Orbit-side changes.
    local_hash: str | None
    # UTC start of the external event, for windowed reconciliation.
    remote_start_at: datetime | None
    status: LinkStatus
    conflict_kind: ConflictKind | None
    conflict_detected_at: datetime | None
    last_seen_run_id: uuid.UUID | None
    last_synced_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class RunCounts:
    imported: int = 0
    updated: int = 0
    deleted: int = 0
    skipped: int = 0
    conflicts: int = 0
    exported: int = 0
    failed: int = 0

    def __add__(self, other: "RunCounts") -> "RunCounts":
        return RunCounts(
            imported=self.imported + other.imported,
            updated=self.updated + other.updated,
            deleted=self.deleted + other.deleted,
            skipped=self.skipped + other.skipped,
            conflicts=self.conflicts + other.conflicts,
            exported=self.exported + other.exported,
            failed=self.failed + other.failed,
        )


@dataclass(frozen=True, slots=True)
class SyncRun:
    """One synchronization of a resource (calendar) or of a connection's imported files."""

    id: uuid.UUID
    connection_id: uuid.UUID
    resource_id: uuid.UUID | None
    workspace_id: uuid.UUID
    kind: RunKind
    trigger: RunTrigger
    status: RunStatus
    # A full synchronization reconciles deletions once it has seen everything.
    full: bool
    counts: RunCounts
    # A safe, content-free message.
    error: str | None
    attempts: int
    cancel_requested: bool
    claim_token: uuid.UUID | None
    lease_until: datetime | None
    next_attempt_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class OAuthState:
    """A started authorization. Only the state's SHA-256 is stored; the PKCE verifier is
    encrypted. Used once, within `OAUTH_STATE_TTL_SECONDS`."""

    id: uuid.UUID
    state_hash: str
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    provider: ProviderId
    capabilities: tuple[Capability, ...]
    code_verifier_ciphertext: str
    # Reconnecting an existing connection (to renew access or add capabilities).
    connection_id: uuid.UUID | None
    redirect_uri: str
    expires_at: datetime
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ConnectionDetail:
    connection: Connection
    resources: list[Resource]
    runs: list[SyncRun]
    conflicts: int
    imported_files: int


@dataclass(frozen=True, slots=True)
class ProviderInfo:
    """What the settings page shows before connecting: who, what, and why."""

    provider: ProviderId
    name: str
    configured: bool
    capabilities: tuple[Capability, ...]
    scopes: dict[Capability, tuple[str, ...]] = field(
        default_factory=dict[Capability, tuple[str, ...]]
    )


# Errors


class IntegrationError(Exception):
    """Base class. `message` is safe to show: it never contains tokens or record content."""

    message: str = "The integration failed."

    def __init__(self, message: str | None = None) -> None:
        if message is not None:
            self.message = message
        super().__init__(self.message)


class IntegrationsDisabledError(IntegrationError):
    message = "Integrations are turned off on this server."


class ProviderNotConfiguredError(IntegrationError):
    message = "This provider isn't set up on this server."


class TokenStorageUnavailableError(IntegrationError):
    message = (
        "This server can't store account tokens securely. "
        "Set ORBIT_INTEGRATIONS_SECRET_KEY to connect accounts."
    )


class InvalidOAuthStateError(IntegrationError):
    message = "This sign-in link expired or was already used. Start connecting again."


class AuthorizationDeniedError(IntegrationError):
    message = "Access wasn't granted, so nothing was connected."


class MissingScopesError(IntegrationError):
    message = "The account didn't grant the permissions Orbit asked for."


class ConnectionNotFoundError(IntegrationError):
    message = "Connection not found."


class ResourceNotFoundError(IntegrationError):
    message = "Calendar or label not found."


class LinkNotFoundError(IntegrationError):
    message = "Link not found."


class RunNotFoundError(IntegrationError):
    message = "Synchronization not found."


class CapabilityNotGrantedError(IntegrationError):
    message = "This connection doesn't have permission for that. Reconnect to grant it."


class NotConflictedError(IntegrationError):
    message = "There is no conflict to resolve."


class AlreadyImportedError(IntegrationError):
    message = "This file is already in Documents."

    def __init__(self, entity_id: uuid.UUID) -> None:
        super().__init__()
        self.entity_id = entity_id


class AlreadyLinkedError(IntegrationError):
    message = "This event is already linked to an external calendar."


class NotExportableError(IntegrationError):
    message = "Only single events can be added to an external calendar."


class OutOfScopeError(IntegrationError):
    """Mail outside the labels and dates the person chose to make available."""

    message = "That message is outside the mail Orbit is allowed to show."


class RunNotCancellableError(IntegrationError):
    message = "This synchronization has already finished."
