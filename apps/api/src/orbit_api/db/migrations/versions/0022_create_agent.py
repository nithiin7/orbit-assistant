"""Create the personal agent and automation tables.

- `agents`: each person's agent per workspace (one primary), with its autonomy level,
  module and tool permissions, limits, memory, notification, and monitoring settings.
- `agent_workflows`: workflow definitions (trigger, conditions, steps) and trigger state
  (next scheduled run, event cursor, last condition result).
- `agent_executions`: runs with their status, checkpoint, counters, and lease; `trigger_key`
  is unique per agent so a trigger starts at most one run.
- `agent_execution_steps`: what each step did (redacted, size-limited).
- `agent_approvals`: exact actions waiting for their owner, bound by an arguments hash.
- `agent_memories`: saved preferences and workflow outcomes.
- `agent_monitor_alerts`: monitoring findings already notified about.

On PostgreSQL every table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "agents",
    "agent_workflows",
    "agent_executions",
    "agent_approvals",
    "agent_execution_steps",
    "agent_memories",
    "agent_monitor_alerts",
)


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("chat_model", sa.String(length=200), nullable=True),
        sa.Column("autonomy", sa.String(length=16), nullable=False),
        sa.Column("modules", sa.JSON(), nullable=False),
        sa.Column("tool_modes", sa.JSON(), nullable=False),
        sa.Column("action_types", sa.JSON(), nullable=False),
        sa.Column("autonomous_triggers", sa.JSON(), nullable=False),
        sa.Column("limits", sa.JSON(), nullable=False),
        sa.Column("memory", sa.JSON(), nullable=False),
        sa.Column("notifications", sa.JSON(), nullable=False),
        sa.Column("monitoring", sa.JSON(), nullable=False),
        sa.Column("monitored_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "autonomy IN ('read_only', 'suggest', 'approval', 'limited')",
            name=op.f("ck_agents_autonomy"),
        ),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 100", name=op.f("ck_agents_name_length")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_agents_user_id_users"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_agents_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agents")),
    )
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.create_index(
            "uq_agents_primary",
            ["workspace_id", "user_id"],
            unique=True,
            sqlite_where=sa.text("is_primary"),
            postgresql_where=sa.text("is_primary"),
        )

    op.create_table(
        "agent_monitor_alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=300), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_agent_monitor_alerts_agent_id_agents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_agent_monitor_alerts_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_monitor_alerts")),
        sa.UniqueConstraint("agent_id", "key", name=op.f("uq_agent_monitor_alerts_agent_id")),
    )
    op.create_table(
        "agent_workflows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("trigger_kind", sa.String(length=16), nullable=False),
        sa.Column("trigger", sa.JSON(), nullable=False),
        sa.Column("conditions", sa.JSON(), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("max_runs_per_day", sa.Integer(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trigger_cursor", sa.DateTime(timezone=True), nullable=True),
        sa.Column("condition_state", sa.Boolean(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "trigger_kind IN ('manual', 'schedule', 'event', 'condition')",
            name=op.f("ck_agent_workflows_trigger_kind"),
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_agent_workflows_name_length")
        ),
        sa.CheckConstraint(
            "max_runs_per_day BETWEEN 1 AND 1000", name=op.f("ck_agent_workflows_max_runs_per_day")
        ),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_agent_workflows_agent_id_agents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_agent_workflows_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_agent_workflows_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_workflows")),
    )
    with op.batch_alter_table("agent_workflows", schema=None) as batch_op:
        batch_op.create_index("ix_agent_workflows_owner", ["workspace_id", "user_id"], unique=False)
        batch_op.create_index(
            "ix_agent_workflows_schedule", ["enabled", "next_run_at"], unique=False
        )
        batch_op.create_index(
            "ix_agent_workflows_watch", ["enabled", "trigger_kind", "checked_at"], unique=False
        )

    op.create_table(
        "agent_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("workflow_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("trigger_kind", sa.String(length=16), nullable=False),
        sa.Column("trigger_key", sa.String(length=300), nullable=False),
        sa.Column("trigger_data", sa.JSON(), nullable=False),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("cursor", sa.Integer(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("steps_taken", sa.Integer(), nullable=False),
        sa.Column("tool_calls", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_micros", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resume_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'waiting', 'waiting_approval', 'succeeded', "
            "'failed', 'cancelled')",
            name=op.f("ck_agent_executions_status"),
        ),
        sa.CheckConstraint(
            "trigger_kind IN ('manual', 'schedule', 'event', 'condition', 'agent')",
            name=op.f("ck_agent_executions_trigger_kind"),
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_agent_executions_attempts")),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_agent_executions_agent_id_agents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_agent_executions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workflow_id"],
            ["agent_workflows.id"],
            name=op.f("fk_agent_executions_workflow_id_agent_workflows"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_agent_executions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_executions")),
        sa.UniqueConstraint("agent_id", "trigger_key", name=op.f("uq_agent_executions_agent_id")),
    )
    with op.batch_alter_table("agent_executions", schema=None) as batch_op:
        batch_op.create_index(
            "ix_agent_executions_agent_created", ["agent_id", "created_at"], unique=False
        )
        batch_op.create_index(
            "ix_agent_executions_owner_created",
            ["workspace_id", "user_id", "created_at"],
            unique=False,
        )
        batch_op.create_index(
            "ix_agent_executions_status_resume", ["status", "resume_at"], unique=False
        )
        batch_op.create_index("ix_agent_executions_workflow", ["workflow_id"], unique=False)

    op.create_table(
        "agent_memories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("workflow_id", sa.Uuid(), nullable=True),
        sa.Column("content", sa.String(length=500), nullable=False),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "category IN ('preference', 'workflow')", name=op.f("ck_agent_memories_category")
        ),
        sa.CheckConstraint("source IN ('user', 'agent')", name=op.f("ck_agent_memories_source")),
        sa.CheckConstraint(
            "length(content) BETWEEN 1 AND 500", name=op.f("ck_agent_memories_content_length")
        ),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_agent_memories_agent_id_agents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_agent_memories_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workflow_id"],
            ["agent_workflows.id"],
            name=op.f("fk_agent_memories_workflow_id_agent_workflows"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_agent_memories_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_memories")),
    )
    with op.batch_alter_table("agent_memories", schema=None) as batch_op:
        batch_op.create_index(
            "ix_agent_memories_agent_category", ["agent_id", "category", "created_at"], unique=False
        )

    op.create_table(
        "agent_approvals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("step_position", sa.Integer(), nullable=False),
        sa.Column("tool", sa.String(length=80), nullable=False),
        sa.Column("arguments", sa.JSON(), nullable=False),
        sa.Column("arguments_hash", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.String(length=300), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("context", sa.String(length=200), nullable=False),
        sa.Column("target", sa.JSON(), nullable=True),
        sa.Column("effect", sa.String(length=300), nullable=False),
        sa.Column("risk", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("from_untrusted_context", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.CheckConstraint(
            "risk IN ('low', 'medium', 'high')", name=op.f("ck_agent_approvals_risk")
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'executing', 'executed', 'rejected', 'expired', 'cancelled', "
            "'failed')",
            name=op.f("ck_agent_approvals_status"),
        ),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_agent_approvals_agent_id_agents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["execution_id"],
            ["agent_executions.id"],
            name=op.f("fk_agent_approvals_execution_id_agent_executions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_agent_approvals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_agent_approvals_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_approvals")),
    )
    with op.batch_alter_table("agent_approvals", schema=None) as batch_op:
        batch_op.create_index("ix_agent_approvals_execution", ["execution_id"], unique=False)
        batch_op.create_index(
            "ix_agent_approvals_owner_status", ["workspace_id", "user_id", "status"], unique=False
        )
        batch_op.create_index(
            "ix_agent_approvals_status_expires", ["status", "expires_at"], unique=False
        )

    op.create_table(
        "agent_execution_steps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("tool", sa.String(length=80), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("arguments", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("output", sa.Text(), nullable=False),
        sa.Column("records", sa.JSON(), nullable=False),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("approval_id", sa.Uuid(), nullable=True),
        sa.Column("autonomous", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('tool', 'condition', 'delay', 'approval', 'ai', 'plan', 'final')",
            name=op.f("ck_agent_execution_steps_kind"),
        ),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed', 'skipped', 'waiting', 'rejected', "
            "'suggested', 'denied')",
            name=op.f("ck_agent_execution_steps_status"),
        ),
        sa.ForeignKeyConstraint(
            ["approval_id"],
            ["agent_approvals.id"],
            name=op.f("fk_agent_execution_steps_approval_id_agent_approvals"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["execution_id"],
            ["agent_executions.id"],
            name=op.f("fk_agent_execution_steps_execution_id_agent_executions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_agent_execution_steps_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_execution_steps")),
        sa.UniqueConstraint(
            "execution_id", "position", name=op.f("uq_agent_execution_steps_execution_id")
        ),
    )
    with op.batch_alter_table("agent_execution_steps", schema=None) as batch_op:
        batch_op.create_index(
            "ix_agent_execution_steps_autonomous",
            ["workspace_id", "autonomous", "started_at"],
            unique=False,
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("agent_execution_steps", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_execution_steps_autonomous")

    op.drop_table("agent_execution_steps")
    with op.batch_alter_table("agent_approvals", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_approvals_status_expires")
        batch_op.drop_index("ix_agent_approvals_owner_status")
        batch_op.drop_index("ix_agent_approvals_execution")

    op.drop_table("agent_approvals")
    with op.batch_alter_table("agent_memories", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_memories_agent_category")

    op.drop_table("agent_memories")
    with op.batch_alter_table("agent_executions", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_executions_workflow")
        batch_op.drop_index("ix_agent_executions_status_resume")
        batch_op.drop_index("ix_agent_executions_owner_created")
        batch_op.drop_index("ix_agent_executions_agent_created")

    op.drop_table("agent_executions")
    with op.batch_alter_table("agent_workflows", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_workflows_watch")
        batch_op.drop_index("ix_agent_workflows_schedule")
        batch_op.drop_index("ix_agent_workflows_owner")

    op.drop_table("agent_workflows")
    op.drop_table("agent_monitor_alerts")
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_agents_primary",
            sqlite_where=sa.text("is_primary"),
            postgresql_where=sa.text("is_primary"),
        )

    op.drop_table("agents")
