"""Create the backup tables.

- `backups`: each workspace's backup history (the archives live in the backup store), with a
  partial unique index so at most one backup runs per workspace at a time.
- `backup_settings`: automatic backup frequency, retention, files, and encryption per workspace.
- `backup_uploads`: uploaded archives and exports staged for inspection, restore, or import.

On PostgreSQL every table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("backups", "backup_settings", "backup_uploads")


def _owner_keys(table: str) -> list[sa.ForeignKeyConstraint]:
    return [
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f(f"fk_{table}_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f(f"fk_{table}_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "backups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("include_files", sa.Boolean(), nullable=False),
        sa.Column("encrypted", sa.Boolean(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("record_count", sa.Integer(), nullable=False),
        sa.Column("file_count", sa.Integer(), nullable=False),
        sa.Column("modules", sa.JSON(), nullable=False),
        sa.Column("record_counts", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("format_version", sa.Integer(), nullable=False),
        sa.Column("schema_revision", sa.String(length=32), nullable=False),
        sa.Column("app_version", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('manual', 'scheduled', 'pre_restore')", name=op.f("ck_backups_kind")
        ),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed')", name=op.f("ck_backups_status")
        ),
        *_owner_keys("backups"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_backups")),
    )
    with op.batch_alter_table("backups", schema=None) as batch_op:
        batch_op.create_index(
            "ix_backups_workspace_created_at", ["workspace_id", "created_at"], unique=False
        )
        batch_op.create_index(
            "uq_backups_one_running",
            ["workspace_id"],
            unique=True,
            sqlite_where=sa.text("status = 'running'"),
            postgresql_where=sa.text("status = 'running'"),
        )

    op.create_table(
        "backup_settings",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("frequency", sa.String(length=16), nullable=False),
        sa.Column("retention_count", sa.Integer(), nullable=False),
        sa.Column("include_files", sa.Boolean(), nullable=False),
        sa.Column("encrypt", sa.Boolean(), nullable=False),
        sa.Column("key_material", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "frequency IN ('manual', 'daily', 'weekly', 'monthly')",
            name=op.f("ck_backup_settings_frequency"),
        ),
        sa.CheckConstraint(
            "retention_count BETWEEN 1 AND 50", name=op.f("ck_backup_settings_retention_count")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_backup_settings_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", name=op.f("pk_backup_settings")),
    )

    op.create_table(
        "backup_uploads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("encrypted", sa.Boolean(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("result", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('backup', 'export')", name=op.f("ck_backup_uploads_kind")),
        sa.CheckConstraint(
            "status IN ('uploaded', 'restoring', 'completed', 'failed', 'expired', 'discarded')",
            name=op.f("ck_backup_uploads_status"),
        ),
        sa.CheckConstraint(
            "length(filename) BETWEEN 1 AND 255", name=op.f("ck_backup_uploads_filename_length")
        ),
        *_owner_keys("backup_uploads"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_backup_uploads")),
    )
    with op.batch_alter_table("backup_uploads", schema=None) as batch_op:
        batch_op.create_index(
            "ix_backup_uploads_workspace_created_at",
            ["workspace_id", "created_at"],
            unique=False,
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("backup_uploads", schema=None) as batch_op:
        batch_op.drop_index("ix_backup_uploads_workspace_created_at")
    op.drop_table("backup_uploads")
    op.drop_table("backup_settings")
    with op.batch_alter_table("backups", schema=None) as batch_op:
        batch_op.drop_index("uq_backups_one_running")
        batch_op.drop_index("ix_backups_workspace_created_at")
    op.drop_table("backups")
