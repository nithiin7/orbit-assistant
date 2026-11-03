"""Backups and restores: the history of a workspace's backups, its automatic backup settings, and
uploaded archives waiting to be inspected and restored or imported.

Backup archives themselves are files in the backup store (`ORBIT_BACKUPS_PATH`), never in the
database; a row records what one contains, its checksum, and how its creation went.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

BACKUP_KINDS = "('manual', 'scheduled', 'pre_restore')"
BACKUP_STATUSES = "('running', 'succeeded', 'failed')"
FREQUENCIES = "('manual', 'daily', 'weekly', 'monthly')"
UPLOAD_KINDS = "('backup', 'export')"
UPLOAD_STATUSES = "('uploaded', 'restoring', 'completed', 'failed', 'expired', 'discarded')"


class BackupModel(Base):
    """One backup of a workspace, kept in the backup store until deleted or pruned."""

    __tablename__ = "backups"
    __table_args__ = (
        CheckConstraint(f"kind IN {BACKUP_KINDS}", name="kind"),
        CheckConstraint(f"status IN {BACKUP_STATUSES}", name="status"),
        Index("ix_backups_workspace_created_at", "workspace_id", "created_at"),
        # At most one backup runs per workspace at a time, across API processes and workers.
        Index(
            "uq_backups_one_running",
            "workspace_id",
            unique=True,
            sqlite_where=text("status = 'running'"),
            postgresql_where=text("status = 'running'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    include_files: Mapped[bool]
    encrypted: Mapped[bool]
    # The archive as stored: its size and SHA-256, checked before it's downloaded or restored.
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str | None] = mapped_column(String(64))
    record_count: Mapped[int] = mapped_column(Integer, default=0)
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    # Module names, records per module, and warnings (such as files missing from storage).
    modules: Mapped[list[str]] = mapped_column(JSON)
    record_counts: Mapped[dict[str, int]] = mapped_column(JSON)
    warnings: Mapped[list[str]] = mapped_column(JSON)
    # A safe, user-facing reason when the backup failed; never file contents or SQL.
    error: Mapped[str | None] = mapped_column(String(300))
    format_version: Mapped[int] = mapped_column(Integer)
    schema_revision: Mapped[str] = mapped_column(String(32))
    app_version: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class BackupSettingsModel(Base):
    """A workspace's automatic backups: how often, how many to keep, and whether to include
    files and encrypt them. Absent until changed; the defaults are manual only."""

    __tablename__ = "backup_settings"
    __table_args__ = (
        CheckConstraint(f"frequency IN {FREQUENCIES}", name="frequency"),
        CheckConstraint("retention_count BETWEEN 1 AND 50", name="retention_count"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    frequency: Mapped[str] = mapped_column(String(16))
    retention_count: Mapped[int] = mapped_column(Integer)
    include_files: Mapped[bool]
    encrypt: Mapped[bool]
    # The backup key: an X25519 public key, and its private key encrypted with a key derived
    # from the backup password (which is never stored). Automatic backups are encrypted to the
    # public key, so they need no password until they're restored.
    key_material: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    next_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class BackupUploadModel(Base):
    """An uploaded backup archive or Orbit export, staged in the backup store until it's
    restored or imported, discarded, or expires. The row stays as the restore's history."""

    __tablename__ = "backup_uploads"
    __table_args__ = (
        CheckConstraint(f"kind IN {UPLOAD_KINDS}", name="kind"),
        CheckConstraint(f"status IN {UPLOAD_STATUSES}", name="status"),
        CheckConstraint("length(filename) BETWEEN 1 AND 255", name="filename_length"),
        Index("ix_backup_uploads_workspace_created_at", "workspace_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    encrypted: Mapped[bool]
    filename: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    # The restore or import report, once one ran.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
