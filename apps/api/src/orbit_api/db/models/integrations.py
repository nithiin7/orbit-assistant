"""External integrations: connected accounts, their calendars and labels, single-use OAuth
states, links between external records and Orbit records, and synchronization runs.

Orbit's own tables gain no provider columns: an imported event is an ordinary calendar event,
and its origin lives in `integration_links`. Tokens are stored only encrypted (Fernet, with a key
kept outside the database), and only on `integration_connections`.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

PROVIDERS = "'google', 'microsoft'"
CONNECTION_STATUSES = "'active', 'reauth_required', 'error'"
RESOURCE_KINDS = "'calendar', 'mail_label'"
DIRECTIONS = "'import', 'two_way'"
SYNC_INTERVALS = "0, 15, 30, 60, 360, 1440"
MAIL_DAYS = "7, 30, 90, 365"
EXTERNAL_KINDS = "'event', 'message', 'file'"
ENTITY_TYPES = "'event', 'task', 'note', 'reminder', 'document'"
ORIGINS = "'external', 'orbit', 'linked'"
LINK_STATUSES = (
    "'synced', 'conflict', 'local_changes', 'update_available', 'missing', 'deleted_locally'"
)
CONFLICT_KINDS = "'both_changed', 'deleted_remotely'"
RUN_KINDS = "'calendar', 'files'"
RUN_TRIGGERS = "'manual', 'scheduled', 'webhook', 'initial', 'retry'"
RUN_STATUSES = "'queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'"
# Events and files are imported at most once per connection.
SINGLE_IMPORT = "external_kind IN ('event', 'file')"


class IntegrationConnectionModel(Base):
    __tablename__ = "integration_connections"
    __table_args__ = (
        CheckConstraint(f"provider IN ({PROVIDERS})", name="provider"),
        CheckConstraint(f"status IN ({CONNECTION_STATUSES})", name="status"),
        CheckConstraint(f"mail_days IN ({MAIL_DAYS})", name="mail_days"),
        CheckConstraint("token_version >= 1", name="token_version"),
        UniqueConstraint("workspace_id", "provider", "account_id"),
        Index("ix_integration_connections_owner", "workspace_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(16))
    account_id: Mapped[str] = mapped_column(String(255))
    account_email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(200))
    scopes: Mapped[list[str]] = mapped_column(JSON)
    capabilities: Mapped[list[str]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24))
    access_token_ciphertext: Mapped[str] = mapped_column(Text)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    token_version: Mapped[int] = mapped_column(Integer, default=1)
    mail_days: Mapped[int] = mapped_column(Integer)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class IntegrationResourceModel(Base):
    __tablename__ = "integration_resources"
    __table_args__ = (
        CheckConstraint(f"kind IN ({RESOURCE_KINDS})", name="kind"),
        CheckConstraint(f"direction IN ({DIRECTIONS})", name="direction"),
        CheckConstraint(f"sync_interval_minutes IN ({SYNC_INTERVALS})", name="sync_interval"),
        UniqueConstraint("connection_id", "kind", "external_id"),
        Index("ix_integration_resources_next_sync_at", "next_sync_at"),
        Index("ix_integration_resources_channel_id", "channel_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("integration_connections.id", ondelete="CASCADE")
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    external_id: Mapped[str] = mapped_column(String(500))
    name: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(Boolean)
    writable: Mapped[bool] = mapped_column(Boolean)
    direction: Mapped[str] = mapped_column(String(16))
    sync_interval_minutes: Mapped[int] = mapped_column(Integer)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("calendar_categories.id", ondelete="SET NULL")
    )
    timezone: Mapped[str | None] = mapped_column(String(64))
    cursor: Mapped[str | None] = mapped_column(Text)
    checkpoint: Mapped[str | None] = mapped_column(Text)
    window_start: Mapped[datetime | None] = mapped_column(UTCDateTime)
    next_sync_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_error: Mapped[str | None] = mapped_column(String(300))
    channel_id: Mapped[str | None] = mapped_column(String(200))
    channel_token_hash: Mapped[str | None] = mapped_column(String(64))
    channel_resource_id: Mapped[str | None] = mapped_column(String(300))
    channel_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class IntegrationOAuthStateModel(Base):
    """A started authorization: the state's SHA-256 and the encrypted PKCE verifier."""

    __tablename__ = "integration_oauth_states"
    __table_args__ = (
        CheckConstraint(f"provider IN ({PROVIDERS})", name="provider"),
        Index("ix_integration_oauth_states_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(16))
    capabilities: Mapped[list[str]] = mapped_column(JSON)
    code_verifier_ciphertext: Mapped[str] = mapped_column(Text)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("integration_connections.id", ondelete="CASCADE")
    )
    redirect_uri: Mapped[str] = mapped_column(String(500))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class IntegrationLinkModel(Base):
    """An external record and the Orbit record it maps to. `entity_id` refers to a row of the
    table `entity_type` names; a deleted record is noticed when the link is next used."""

    __tablename__ = "integration_links"
    __table_args__ = (
        CheckConstraint(f"external_kind IN ({EXTERNAL_KINDS})", name="external_kind"),
        CheckConstraint(f"entity_type IN ({ENTITY_TYPES})", name="entity_type"),
        CheckConstraint(f"origin IN ({ORIGINS})", name="origin"),
        CheckConstraint(f"status IN ({LINK_STATUSES})", name="status"),
        CheckConstraint(
            f"conflict_kind IS NULL OR conflict_kind IN ({CONFLICT_KINDS})", name="conflict_kind"
        ),
        UniqueConstraint(
            "connection_id", "external_kind", "external_id", "entity_type", "entity_id"
        ),
        Index(
            "uq_integration_links_single_import",
            "connection_id",
            "external_kind",
            "external_id",
            unique=True,
            sqlite_where=text(SINGLE_IMPORT),
            postgresql_where=text(SINGLE_IMPORT),
        ),
        Index("ix_integration_links_entity", "workspace_id", "entity_type", "entity_id"),
        Index("ix_integration_links_parent", "resource_id", "external_parent_id"),
        Index("ix_integration_links_status", "connection_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("integration_connections.id", ondelete="CASCADE")
    )
    resource_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("integration_resources.id", ondelete="SET NULL")
    )
    external_kind: Mapped[str] = mapped_column(String(16))
    external_id: Mapped[str] = mapped_column(String(500))
    external_parent_id: Mapped[str | None] = mapped_column(String(500))
    entity_type: Mapped[str] = mapped_column(String(16))
    entity_id: Mapped[uuid.UUID] = mapped_column()
    # A naive local time in the series' time zone, like calendar exceptions' original starts.
    original_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    origin: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(300))
    external_url: Mapped[str | None] = mapped_column(String(2000))
    remote_version: Mapped[str | None] = mapped_column(String(500))
    remote_snapshot: Mapped[dict[str, object] | None] = mapped_column(JSON)
    local_hash: Mapped[str | None] = mapped_column(String(64))
    remote_start_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(24))
    conflict_kind: Mapped[str | None] = mapped_column(String(24))
    conflict_detected_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_seen_run_id: Mapped[uuid.UUID | None] = mapped_column()
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class IntegrationSyncRunModel(Base):
    """One synchronization, its counts, and its lease. Holds no record content."""

    __tablename__ = "integration_sync_runs"
    __table_args__ = (
        CheckConstraint(f"kind IN ({RUN_KINDS})", name="kind"),
        CheckConstraint(f"trigger IN ({RUN_TRIGGERS})", name="trigger"),
        CheckConstraint(f"status IN ({RUN_STATUSES})", name="status"),
        CheckConstraint("attempts >= 0", name="attempts"),
        Index("ix_integration_sync_runs_due", "status", "next_attempt_at"),
        Index("ix_integration_sync_runs_connection", "connection_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("integration_connections.id", ondelete="CASCADE")
    )
    resource_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("integration_resources.id", ondelete="CASCADE")
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    trigger: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    full: Mapped[bool] = mapped_column(Boolean, default=False)
    imported: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    deleted: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    conflicts: Mapped[int] = mapped_column(Integer, default=0)
    exported: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(300))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    claim_token: Mapped[uuid.UUID | None] = mapped_column()
    lease_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    next_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
