"""External integrations.

- `integration_connections`: connected Google and Microsoft accounts, per person and workspace,
  with granted scopes and capabilities, status, and access and refresh tokens encrypted with the
  server's integrations secret key (never returned by the API).
- `integration_resources`: each connection's calendars and mail labels: whether selected,
  direction, interval, category, and incremental sync state (cursor, checkpoint, window, push
  channel).
- `integration_oauth_states`: started authorizations: the state's SHA-256 and the encrypted
  PKCE verifier, single use, short lived.
- `integration_links`: external records and the Orbit records they map to (events, documents,
  and the tasks, notes, and reminders made from emails), with versions, fingerprints, and
  conflict state. Events and files are imported at most once per connection.
- `integration_sync_runs`: synchronization runs with counts, errors, and leases.

On PostgreSQL every new table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "integration_connections",
    "integration_oauth_states",
    "integration_resources",
    "integration_links",
    "integration_sync_runs",
)


def upgrade() -> None:
    op.create_table(
        "integration_connections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("account_id", sa.String(length=255), nullable=False),
        sa.Column("account_email", sa.String(length=320), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("access_token_ciphertext", sa.Text(), nullable=False),
        sa.Column("refresh_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("mail_days", sa.Integer(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "provider IN ('google', 'microsoft')", name=op.f("ck_integration_connections_provider")
        ),
        sa.CheckConstraint(
            "status IN ('active', 'reauth_required', 'error')",
            name=op.f("ck_integration_connections_status"),
        ),
        sa.CheckConstraint(
            "mail_days IN (7, 30, 90, 365)", name=op.f("ck_integration_connections_mail_days")
        ),
        sa.CheckConstraint(
            "token_version >= 1", name=op.f("ck_integration_connections_token_version")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_integration_connections_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_integration_connections_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_integration_connections")),
        sa.UniqueConstraint(
            "workspace_id",
            "provider",
            "account_id",
            name=op.f("uq_integration_connections_workspace_id"),
        ),
    )
    with op.batch_alter_table("integration_connections", schema=None) as batch_op:
        batch_op.create_index(
            "ix_integration_connections_owner", ["workspace_id", "user_id"], unique=False
        )

    op.create_table(
        "integration_oauth_states",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column("code_verifier_ciphertext", sa.Text(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=True),
        sa.Column("redirect_uri", sa.String(length=500), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "provider IN ('google', 'microsoft')", name=op.f("ck_integration_oauth_states_provider")
        ),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["integration_connections.id"],
            name=op.f("fk_integration_oauth_states_connection_id_integration_connections"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_integration_oauth_states_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_integration_oauth_states_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_integration_oauth_states")),
        sa.UniqueConstraint("state_hash", name=op.f("uq_integration_oauth_states_state_hash")),
    )
    with op.batch_alter_table("integration_oauth_states", schema=None) as batch_op:
        batch_op.create_index(
            "ix_integration_oauth_states_expires_at", ["expires_at"], unique=False
        )

    op.create_table(
        "integration_resources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("external_id", sa.String(length=500), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("writable", sa.Boolean(), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("sync_interval_minutes", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("cursor", sa.Text(), nullable=True),
        sa.Column("checkpoint", sa.Text(), nullable=True),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        sa.Column("channel_id", sa.String(length=200), nullable=True),
        sa.Column("channel_token_hash", sa.String(length=64), nullable=True),
        sa.Column("channel_resource_id", sa.String(length=300), nullable=True),
        sa.Column("channel_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "direction IN ('import', 'two_way')", name=op.f("ck_integration_resources_direction")
        ),
        sa.CheckConstraint(
            "kind IN ('calendar', 'mail_label')", name=op.f("ck_integration_resources_kind")
        ),
        sa.CheckConstraint(
            "sync_interval_minutes IN (0, 15, 30, 60, 360, 1440)",
            name=op.f("ck_integration_resources_sync_interval"),
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["calendar_categories.id"],
            name=op.f("fk_integration_resources_category_id_calendar_categories"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["integration_connections.id"],
            name=op.f("fk_integration_resources_connection_id_integration_connections"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_integration_resources_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_integration_resources")),
        sa.UniqueConstraint(
            "connection_id",
            "kind",
            "external_id",
            name=op.f("uq_integration_resources_connection_id"),
        ),
    )
    with op.batch_alter_table("integration_resources", schema=None) as batch_op:
        batch_op.create_index("ix_integration_resources_channel_id", ["channel_id"], unique=False)
        batch_op.create_index(
            "ix_integration_resources_next_sync_at", ["next_sync_at"], unique=False
        )

    op.create_table(
        "integration_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=True),
        sa.Column("external_kind", sa.String(length=16), nullable=False),
        sa.Column("external_id", sa.String(length=500), nullable=False),
        sa.Column("external_parent_id", sa.String(length=500), nullable=True),
        sa.Column("entity_type", sa.String(length=16), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("original_start", sa.DateTime(), nullable=True),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("external_url", sa.String(length=2000), nullable=True),
        sa.Column("remote_version", sa.String(length=500), nullable=True),
        sa.Column("remote_snapshot", sa.JSON(), nullable=True),
        sa.Column("local_hash", sa.String(length=64), nullable=True),
        sa.Column("remote_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("conflict_kind", sa.String(length=24), nullable=True),
        sa.Column("conflict_detected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_run_id", sa.Uuid(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "conflict_kind IS NULL OR conflict_kind IN ('both_changed', 'deleted_remotely')",
            name=op.f("ck_integration_links_conflict_kind"),
        ),
        sa.CheckConstraint(
            "entity_type IN ('event', 'task', 'note', 'reminder', 'document')",
            name=op.f("ck_integration_links_entity_type"),
        ),
        sa.CheckConstraint(
            "external_kind IN ('event', 'message', 'file')",
            name=op.f("ck_integration_links_external_kind"),
        ),
        sa.CheckConstraint(
            "origin IN ('external', 'orbit', 'linked')", name=op.f("ck_integration_links_origin")
        ),
        sa.CheckConstraint(
            "status IN ('synced', 'conflict', 'local_changes', 'update_available', 'missing', "
            "'deleted_locally')",
            name=op.f("ck_integration_links_status"),
        ),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["integration_connections.id"],
            name=op.f("fk_integration_links_connection_id_integration_connections"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["resource_id"],
            ["integration_resources.id"],
            name=op.f("fk_integration_links_resource_id_integration_resources"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_integration_links_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_integration_links")),
        sa.UniqueConstraint(
            "connection_id",
            "external_kind",
            "external_id",
            "entity_type",
            "entity_id",
            name=op.f("uq_integration_links_connection_id"),
        ),
    )
    with op.batch_alter_table("integration_links", schema=None) as batch_op:
        batch_op.create_index(
            "ix_integration_links_entity",
            ["workspace_id", "entity_type", "entity_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_integration_links_parent", ["resource_id", "external_parent_id"], unique=False
        )
        batch_op.create_index(
            "ix_integration_links_status", ["connection_id", "status"], unique=False
        )
        batch_op.create_index(
            "uq_integration_links_single_import",
            ["connection_id", "external_kind", "external_id"],
            unique=True,
            sqlite_where=sa.text("external_kind IN ('event', 'file')"),
            postgresql_where=sa.text("external_kind IN ('event', 'file')"),
        )

    op.create_table(
        "integration_sync_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("trigger", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("full", sa.Boolean(), nullable=False),
        sa.Column("imported", sa.Integer(), nullable=False),
        sa.Column("updated", sa.Integer(), nullable=False),
        sa.Column("deleted", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("conflicts", sa.Integer(), nullable=False),
        sa.Column("exported", sa.Integer(), nullable=False),
        sa.Column("failed", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("claim_token", sa.Uuid(), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('calendar', 'files')", name=op.f("ck_integration_sync_runs_kind")
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')",
            name=op.f("ck_integration_sync_runs_status"),
        ),
        sa.CheckConstraint(
            "trigger IN ('manual', 'scheduled', 'webhook', 'initial', 'retry')",
            name=op.f("ck_integration_sync_runs_trigger"),
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_integration_sync_runs_attempts")),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["integration_connections.id"],
            name=op.f("fk_integration_sync_runs_connection_id_integration_connections"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["resource_id"],
            ["integration_resources.id"],
            name=op.f("fk_integration_sync_runs_resource_id_integration_resources"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_integration_sync_runs_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_integration_sync_runs")),
    )
    with op.batch_alter_table("integration_sync_runs", schema=None) as batch_op:
        batch_op.create_index(
            "ix_integration_sync_runs_connection", ["connection_id", "created_at"], unique=False
        )
        batch_op.create_index(
            "ix_integration_sync_runs_due", ["status", "next_attempt_at"], unique=False
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("integration_sync_runs", schema=None) as batch_op:
        batch_op.drop_index("ix_integration_sync_runs_due")
        batch_op.drop_index("ix_integration_sync_runs_connection")

    op.drop_table("integration_sync_runs")
    with op.batch_alter_table("integration_links", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_integration_links_single_import",
            sqlite_where=sa.text("external_kind IN ('event', 'file')"),
            postgresql_where=sa.text("external_kind IN ('event', 'file')"),
        )
        batch_op.drop_index("ix_integration_links_status")
        batch_op.drop_index("ix_integration_links_parent")
        batch_op.drop_index("ix_integration_links_entity")

    op.drop_table("integration_links")
    with op.batch_alter_table("integration_resources", schema=None) as batch_op:
        batch_op.drop_index("ix_integration_resources_next_sync_at")
        batch_op.drop_index("ix_integration_resources_channel_id")

    op.drop_table("integration_resources")
    with op.batch_alter_table("integration_oauth_states", schema=None) as batch_op:
        batch_op.drop_index("ix_integration_oauth_states_expires_at")

    op.drop_table("integration_oauth_states")
    with op.batch_alter_table("integration_connections", schema=None) as batch_op:
        batch_op.drop_index("ix_integration_connections_owner")

    op.drop_table("integration_connections")
