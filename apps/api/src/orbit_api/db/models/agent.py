"""The personal agent and automation: agents, workflows, executions and their steps, approvals,
memory, and monitoring alerts. Every row belongs to one person in one workspace.

Executions keep only what their history needs: redacted step arguments, short outputs, and
safe error messages; never credentials. `trigger_key` is unique per agent, so a schedule slot,
an event, or a manual run's idempotency key creates at most one execution.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
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

AUTONOMY = "'read_only', 'suggest', 'approval', 'limited'"
TRIGGERS = "'manual', 'schedule', 'event', 'condition', 'agent'"
WORKFLOW_TRIGGERS = "'manual', 'schedule', 'event', 'condition'"
EXECUTION_STATUSES = (
    "'queued', 'running', 'waiting', 'waiting_approval', 'succeeded', 'failed', 'cancelled'"
)
STEP_KINDS = "'tool', 'condition', 'delay', 'approval', 'ai', 'plan', 'final'"
STEP_STATUSES = (
    "'running', 'succeeded', 'failed', 'skipped', 'waiting', 'rejected', 'suggested', 'denied'"
)
APPROVAL_STATUSES = (
    "'pending', 'executing', 'executed', 'rejected', 'expired', 'cancelled', 'failed'"
)
PRIMARY = "is_primary"


class AgentModel(Base):
    """An agent and its permissions. Only its owner changes these, through the API."""

    __tablename__ = "agents"
    __table_args__ = (
        CheckConstraint(f"autonomy IN ({AUTONOMY})", name="autonomy"),
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        Index(
            "uq_agents_primary",
            "workspace_id",
            "user_id",
            unique=True,
            sqlite_where=text(PRIMARY),
            postgresql_where=text(PRIMARY),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    is_primary: Mapped[bool] = mapped_column(Boolean)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500))
    enabled: Mapped[bool] = mapped_column(Boolean)
    instructions: Mapped[str] = mapped_column(Text)
    chat_model: Mapped[str | None] = mapped_column(String(200))
    autonomy: Mapped[str] = mapped_column(String(16))
    modules: Mapped[list[str]] = mapped_column(JSON)
    tool_modes: Mapped[dict[str, str]] = mapped_column(JSON)
    action_types: Mapped[list[str]] = mapped_column(JSON)
    autonomous_triggers: Mapped[list[str]] = mapped_column(JSON)
    limits: Mapped[dict[str, Any]] = mapped_column(JSON)
    memory: Mapped[dict[str, Any]] = mapped_column(JSON)
    notifications: Mapped[dict[str, Any]] = mapped_column(JSON)
    monitoring: Mapped[dict[str, Any]] = mapped_column(JSON)
    monitored_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AgentWorkflowModel(Base):
    """A workflow definition (trigger, conditions, steps as JSON) and its trigger state."""

    __tablename__ = "agent_workflows"
    __table_args__ = (
        CheckConstraint(f"trigger_kind IN ({WORKFLOW_TRIGGERS})", name="trigger_kind"),
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("max_runs_per_day BETWEEN 1 AND 1000", name="max_runs_per_day"),
        Index("ix_agent_workflows_owner", "workspace_id", "user_id"),
        Index("ix_agent_workflows_schedule", "enabled", "next_run_at"),
        Index("ix_agent_workflows_watch", "enabled", "trigger_kind", "checked_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500))
    enabled: Mapped[bool] = mapped_column(Boolean)
    trigger_kind: Mapped[str] = mapped_column(String(16))
    trigger: Mapped[dict[str, Any]] = mapped_column(JSON)
    conditions: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    max_runs_per_day: Mapped[int] = mapped_column(Integer)
    next_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    trigger_cursor: Mapped[datetime | None] = mapped_column(UTCDateTime)
    condition_state: Mapped[bool | None] = mapped_column(Boolean)
    checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AgentExecutionModel(Base):
    """One run of a workflow or the agent: its status, checkpoint, counters, and lease."""

    __tablename__ = "agent_executions"
    __table_args__ = (
        CheckConstraint(f"trigger_kind IN ({TRIGGERS})", name="trigger_kind"),
        CheckConstraint(f"status IN ({EXECUTION_STATUSES})", name="status"),
        CheckConstraint("attempts >= 0", name="attempts"),
        UniqueConstraint("agent_id", "trigger_key"),
        Index("ix_agent_executions_owner_created", "workspace_id", "user_id", "created_at"),
        Index("ix_agent_executions_agent_created", "agent_id", "created_at"),
        Index("ix_agent_executions_status_resume", "status", "resume_at"),
        Index("ix_agent_executions_workflow", "workflow_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    workflow_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_workflows.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(200))
    trigger_kind: Mapped[str] = mapped_column(String(16))
    trigger_key: Mapped[str] = mapped_column(String(300))
    trigger_data: Mapped[dict[str, Any]] = mapped_column(JSON)
    goal: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20))
    cursor: Mapped[int] = mapped_column(Integer)
    state: Mapped[dict[str, Any]] = mapped_column(JSON)
    attempts: Mapped[int] = mapped_column(Integer)
    steps_taken: Mapped[int] = mapped_column(Integer)
    tool_calls: Mapped[int] = mapped_column(Integer)
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    cost_micros: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(String(300))
    summary: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean)
    lease_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    resume_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AgentApprovalModel(Base):
    """One exact action waiting for its owner. `arguments_hash` ties a decision to it."""

    __tablename__ = "agent_approvals"
    __table_args__ = (
        CheckConstraint(f"status IN ({APPROVAL_STATUSES})", name="status"),
        CheckConstraint("risk IN ('low', 'medium', 'high')", name="risk"),
        Index("ix_agent_approvals_owner_status", "workspace_id", "user_id", "status"),
        Index("ix_agent_approvals_status_expires", "status", "expires_at"),
        Index("ix_agent_approvals_execution", "execution_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    execution_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_executions.id", ondelete="CASCADE")
    )
    step_position: Mapped[int] = mapped_column(Integer)
    tool: Mapped[str] = mapped_column(String(80))
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON)
    arguments_hash: Mapped[str] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(String(300))
    reason: Mapped[str] = mapped_column(String(500))
    context: Mapped[str] = mapped_column(String(200))
    target: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    effect: Mapped[str] = mapped_column(String(300))
    risk: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(16))
    from_untrusted_context: Mapped[bool] = mapped_column(Boolean)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(300))


class AgentExecutionStepModel(Base):
    """What one step did, for the person's history: redacted and size-limited."""

    __tablename__ = "agent_execution_steps"
    __table_args__ = (
        CheckConstraint(f"kind IN ({STEP_KINDS})", name="kind"),
        CheckConstraint(f"status IN ({STEP_STATUSES})", name="status"),
        UniqueConstraint("execution_id", "position"),
        Index("ix_agent_execution_steps_autonomous", "workspace_id", "autonomous", "started_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    execution_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_executions.id", ondelete="CASCADE")
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(200))
    tool: Mapped[str | None] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(500))
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16))
    output: Mapped[str] = mapped_column(Text)
    records: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(300))
    approval_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_approvals.id", ondelete="SET NULL")
    )
    autonomous: Mapped[bool] = mapped_column(Boolean)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AgentMemoryModel(Base):
    """A saved preference (written or approved by the person) or a workflow's past outcome."""

    __tablename__ = "agent_memories"
    __table_args__ = (
        CheckConstraint("category IN ('preference', 'workflow')", name="category"),
        CheckConstraint("source IN ('user', 'agent')", name="source"),
        CheckConstraint("length(content) BETWEEN 1 AND 500", name="content_length"),
        Index("ix_agent_memories_agent_category", "agent_id", "category", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(16))
    workflow_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_workflows.id", ondelete="CASCADE")
    )
    content: Mapped[str] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class AgentMonitorAlertModel(Base):
    """A monitoring finding already notified about, so it isn't notified again."""

    __tablename__ = "agent_monitor_alerts"
    __table_args__ = (UniqueConstraint("agent_id", "key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
