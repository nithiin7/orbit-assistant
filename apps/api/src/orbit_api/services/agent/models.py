"""Agent and automation types: the personal agent's configuration, workflows and their
triggers, executions and their steps, approvals, memory, and monitoring. Plain dataclasses and
errors, free of SQLAlchemy, FastAPI, and any AI vendor.

Everything here is owned by one person in one workspace. Permissions are data the person sets;
nothing the model produces can change them.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Final, Literal, get_args

from orbit_api.services.ai.models import AI_MODULES, RecordRef

# What the agent may use: the AI layer's modules, plus connected mailboxes (read on demand).
AgentModule = Literal[
    "tasks", "notes", "calendar", "reminders", "habits", "documents", "finance", "health", "mail"
]
AGENT_MODULES: Final[tuple[AgentModule, ...]] = get_args(AgentModule)
# Sensitive modules start off, like the AI layer's defaults.
DEFAULT_AGENT_MODULES: Final[frozenset[AgentModule]] = frozenset(
    {"tasks", "notes", "calendar", "reminders", "habits"}
)
# The agent has no watchlist tools, so the AI layer's watchlist permission has no agent twin.
assert set(AI_MODULES) - {"watchlist"} <= set(AGENT_MODULES)

# 0 read only · 1 suggest · 2 approval required · 3 limited autonomy. There is no level above 3.
AutonomyLevel = Literal["read_only", "suggest", "approval", "limited"]
AUTONOMY_LEVELS: Final[tuple[AutonomyLevel, ...]] = get_args(AutonomyLevel)

# What a tool does. There are no delete, payment, sharing, sending, or permission tools.
ToolAccess = Literal["read", "create", "update"]
WRITE_ACCESS: Final[tuple[ToolAccess, ...]] = ("create", "update")
RiskLevel = Literal["low", "medium", "high"]
# Per-tool override: `off` hides the tool, `ask` always asks, `auto` lets limited autonomy run it
# (only if it is low risk and the trigger is allowed). No entry means `ask` for writes.
ToolMode = Literal["off", "ask", "auto"]

TriggerKind = Literal["manual", "schedule", "event", "condition", "agent"]
TRIGGER_KINDS: Final[tuple[TriggerKind, ...]] = get_args(TriggerKind)

EventKind = Literal[
    "task_created",
    "task_completed",
    "reminder_triggered",
    "event_approaching",
    "document_expiring",
    "budget_threshold",
    "habit_missed",
    "external_event_changed",
]
EVENT_KINDS: Final[tuple[EventKind, ...]] = get_args(EventKind)
# The module whose records an event is about: an event trigger needs its permission.
EVENT_MODULE: Final[dict[EventKind, AgentModule]] = {
    "task_created": "tasks",
    "task_completed": "tasks",
    "reminder_triggered": "reminders",
    "event_approaching": "calendar",
    "document_expiring": "documents",
    "budget_threshold": "finance",
    "habit_missed": "habits",
    "external_event_changed": "calendar",
}

ScheduleFrequency = Literal["daily", "weekly", "monthly", "once"]

ConditionMetric = Literal[
    "overdue_tasks",
    "tasks_due_soon",
    "upcoming_payments",
    "budget_used_percent",
    "documents_expiring",
    "unread_notifications",
]
CONDITION_METRICS: Final[tuple[ConditionMetric, ...]] = get_args(ConditionMetric)
METRIC_MODULE: Final[dict[ConditionMetric, AgentModule | None]] = {
    "overdue_tasks": "tasks",
    "tasks_due_soon": "tasks",
    "upcoming_payments": "finance",
    "budget_used_percent": "finance",
    "documents_expiring": "documents",
    "unread_notifications": None,
}

CompareOp = Literal["eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains", "exists"]
COMPARE_OPS: Final[tuple[CompareOp, ...]] = get_args(CompareOp)

StepKind = Literal["tool", "condition", "delay", "approval", "ai"]
STEP_KINDS: Final[tuple[StepKind, ...]] = get_args(StepKind)

ExecutionStatus = Literal[
    "queued", "running", "waiting", "waiting_approval", "succeeded", "failed", "cancelled"
]
EXECUTION_STATUSES: Final[tuple[ExecutionStatus, ...]] = get_args(ExecutionStatus)
FINISHED: Final[frozenset[ExecutionStatus]] = frozenset({"succeeded", "failed", "cancelled"})

# What a recorded step is: a workflow step's kind, or a planner turn (`plan`) and its answer.
RecordedStepKind = Literal["tool", "condition", "delay", "approval", "ai", "plan", "final"]
StepStatus = Literal[
    "running", "succeeded", "failed", "skipped", "waiting", "rejected", "suggested", "denied"
]

ApprovalStatus = Literal[
    "pending", "executing", "executed", "rejected", "expired", "cancelled", "failed"
]
APPROVAL_STATUSES: Final[tuple[ApprovalStatus, ...]] = get_args(ApprovalStatus)

MemoryCategory = Literal["preference", "workflow"]
MemorySource = Literal["user", "agent"]

MonitorCategory = Literal[
    "overdue_tasks",
    "upcoming_deadlines",
    "calendar_conflicts",
    "upcoming_events",
    "upcoming_bills",
    "budget_warnings",
    "unusual_spending",
    "expiring_documents",
    "missing_document_details",
    "missed_habits",
    "workout_consistency",
]
MONITOR_CATEGORIES: Final[tuple[MonitorCategory, ...]] = get_args(MonitorCategory)
MONITOR_MODULE: Final[dict[MonitorCategory, AgentModule]] = {
    "overdue_tasks": "tasks",
    "upcoming_deadlines": "tasks",
    "calendar_conflicts": "calendar",
    "upcoming_events": "calendar",
    "upcoming_bills": "finance",
    "budget_warnings": "finance",
    "unusual_spending": "finance",
    "expiring_documents": "documents",
    "missing_document_details": "documents",
    "missed_habits": "habits",
    "workout_consistency": "health",
}
MonitorFrequency = Literal["hourly", "every_6_hours", "daily"]


# The agent


@dataclass(frozen=True, slots=True)
class AgentLimits:
    """Hard bounds the engine enforces on every execution, whatever the model says."""

    max_steps: int = 8
    max_tool_calls: int = 12
    timeout_seconds: int = 300
    # Tokens per execution, where the provider reports them; the AI layer's monthly limit
    # still applies on top.
    max_tokens_per_run: int = 20_000
    max_runs_per_day: int = 50
    max_autonomous_actions_per_day: int = 10
    approval_ttl_hours: int = 24
    # Attempts of a failing step before the execution fails; reads and AI steps only.
    max_retries: int = 2


@dataclass(frozen=True, slots=True)
class MemorySettings:
    # Saved preferences (which the person reviews) are given to the planner.
    preferences: bool = True
    # Goals and outcomes of the agent's recent runs are given to the planner.
    conversation: bool = True
    # A workflow's last outcomes are available to its AI steps.
    workflow: bool = True
    # Execution history and workflow memory older than this are deleted.
    retention_days: int = 90


@dataclass(frozen=True, slots=True)
class NotificationSettings:
    approvals: bool = True
    completed: bool = False
    failed: bool = True
    insights: bool = True


@dataclass(frozen=True, slots=True)
class MonitorSettings:
    enabled: bool = False
    categories: frozenset[MonitorCategory] = frozenset(
        {"overdue_tasks", "upcoming_deadlines", "calendar_conflicts", "expiring_documents"}
    )
    frequency: MonitorFrequency = "daily"
    # Look-ahead for deadlines, events, and bills.
    days_ahead: int = 3
    document_days: int = 30
    budget_percent: int = 80


@dataclass(frozen=True, slots=True)
class Agent:
    """The person's agent in one workspace. One primary agent exists per person and workspace;
    the table allows more for later specialized agents."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: str
    enabled: bool
    # The owner's standing instructions (tone, priorities). Shown to the planner as the owner's
    # preferences, below Orbit's own rules, which it can't override.
    instructions: str
    # A different model on the AI layer's chat provider; `None` uses the chosen chat model.
    chat_model: str | None
    autonomy: AutonomyLevel
    modules: frozenset[AgentModule]
    tool_modes: dict[str, ToolMode]
    action_types: frozenset[ToolAccess]
    # Triggers whose executions may run `auto` tools without asking. Manual runs by default.
    autonomous_triggers: frozenset[TriggerKind]
    limits: AgentLimits
    memory: MemorySettings
    notifications: NotificationSettings
    monitoring: MonitorSettings
    monitored_at: datetime | None
    created_at: datetime
    updated_at: datetime


DEFAULT_ACTION_TYPES: Final[frozenset[ToolAccess]] = frozenset({"read", "create", "update"})
DEFAULT_AUTONOMOUS_TRIGGERS: Final[frozenset[TriggerKind]] = frozenset({"manual"})


# Workflows


@dataclass(frozen=True, slots=True)
class Schedule:
    frequency: ScheduleFrequency
    time: time
    timezone: str
    # Monday is 0. Weekly schedules only.
    weekdays: tuple[int, ...] = ()
    # Monthly schedules; a day past the month's end runs on its last day.
    day_of_month: int | None = None
    # `once` schedules.
    on_date: date | None = None


@dataclass(frozen=True, slots=True)
class EventTrigger:
    event: EventKind
    # `event_approaching`: how long before an event starts.
    lead_minutes: int = 60
    # `document_expiring`: how many days before a document expires.
    days_ahead: int = 30


@dataclass(frozen=True, slots=True)
class ConditionTrigger:
    """Fires when `metric op value` becomes true (not while it stays true)."""

    metric: ConditionMetric
    op: CompareOp
    value: float
    check_minutes: int = 60
    # Look-ahead for metrics that need one (tasks due soon, payments, documents).
    days_ahead: int = 7


@dataclass(frozen=True, slots=True)
class Trigger:
    kind: Literal["manual", "schedule", "event", "condition"]
    schedule: Schedule | None = None
    event: EventTrigger | None = None
    condition: ConditionTrigger | None = None


type Scalar = str | int | float | bool | None


@dataclass(frozen=True, slots=True)
class Condition:
    """`left op right`, where `left` names a value (`trigger.title`, `steps.overdue.count`).
    Evaluated by Orbit's code; never by a model."""

    left: str
    op: CompareOp
    right: Scalar = None


@dataclass(frozen=True, slots=True)
class WorkflowStep:
    id: str
    kind: StepKind
    title: str = ""
    # `tool`
    tool: str | None = None
    arguments: dict[str, Scalar] = field(default_factory=dict[str, Scalar])
    continue_on_error: bool = False
    # `condition`: when false, jump to a later step's `id`, or `end` to finish.
    condition: Condition | None = None
    on_false: str = "end"
    # `delay`
    minutes: int = 0
    # `approval` (a message for the person) and `ai` (the instruction).
    prompt: str = ""


@dataclass(frozen=True, slots=True)
class Workflow:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    agent_id: uuid.UUID
    name: str
    description: str
    enabled: bool
    trigger: Trigger
    # Checked against the trigger's data before an execution is created.
    conditions: tuple[Condition, ...]
    steps: tuple[WorkflowStep, ...]
    max_runs_per_day: int
    next_run_at: datetime | None
    # Event triggers: changes up to this instant have been looked at.
    trigger_cursor: datetime | None
    # Condition triggers: the last evaluation's result, and when it was made.
    condition_state: bool | None
    checked_at: datetime | None
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class WorkflowDraft:
    name: str
    description: str
    enabled: bool
    trigger: Trigger
    conditions: tuple[Condition, ...]
    steps: tuple[WorkflowStep, ...]
    max_runs_per_day: int = 24


# Executions


@dataclass(frozen=True, slots=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_micros: int | None = None


@dataclass(frozen=True, slots=True)
class Execution:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    agent_id: uuid.UUID
    workflow_id: uuid.UUID | None
    # The workflow's name when it started, kept if it is renamed or deleted.
    title: str
    trigger_kind: TriggerKind
    # Unique per agent: a trigger fires at most one execution, on any number of workers.
    trigger_key: str
    # Values from the trigger (a task's title, an event's start). Untrusted data.
    trigger_data: dict[str, Scalar]
    # The person's request, for agent runs.
    goal: str | None
    status: ExecutionStatus
    # The next workflow step, or the planner's turn count.
    cursor: int
    # Working memory and checkpoint: step outputs, the planner's transcript, the awaited
    # approval, and retry counts. Deleted with the execution.
    state: dict[str, object]
    attempts: int
    steps_taken: int
    tool_calls: int
    usage: Usage
    error: str | None
    summary: str | None
    cancel_requested: bool
    lease_until: datetime | None
    resume_at: datetime | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ExecutionStep:
    id: uuid.UUID
    execution_id: uuid.UUID
    workspace_id: uuid.UUID
    position: int
    kind: RecordedStepKind
    title: str
    tool: str | None
    # Why: the planner's stated reason, or the workflow step's title.
    reason: str
    # Redacted and size-limited.
    arguments: dict[str, object]
    status: StepStatus
    output: str
    records: tuple[RecordRef, ...]
    error: str | None
    approval_id: uuid.UUID | None
    # A write that ran without asking (limited autonomy): counted against the daily quota.
    autonomous: bool
    started_at: datetime
    finished_at: datetime | None


@dataclass(frozen=True, slots=True)
class ExecutionQuery:
    statuses: frozenset[ExecutionStatus] = frozenset()
    workflow_id: uuid.UUID | None = None
    limit: int = 50


# Approvals


@dataclass(frozen=True, slots=True)
class Approval:
    """One exact action waiting for the person. `arguments_hash` binds the decision to these
    arguments: if anything differs at approval time, it has to be approved again."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    agent_id: uuid.UUID
    execution_id: uuid.UUID
    step_position: int
    tool: str
    arguments: dict[str, object]
    arguments_hash: str
    summary: str
    reason: str
    context: str
    target: RecordRef | None
    effect: str
    risk: RiskLevel
    status: ApprovalStatus
    from_untrusted_context: bool
    expires_at: datetime
    created_at: datetime
    decided_at: datetime | None
    result: RecordRef | None
    error: str | None


# Memory


@dataclass(frozen=True, slots=True)
class Memory:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    agent_id: uuid.UUID
    category: MemoryCategory
    workflow_id: uuid.UUID | None
    content: str
    source: MemorySource
    created_at: datetime
    updated_at: datetime


# Monitoring


@dataclass(frozen=True, slots=True)
class FindingItem:
    """One thing found. `key` names it with its date or period (a task and its due date), so
    it notifies once, however often monitoring runs."""

    key: str
    label: str
    ref: RecordRef | None = None


@dataclass(frozen=True, slots=True)
class Finding:
    """What a monitoring category found, by Orbit's code (no model involved)."""

    category: MonitorCategory
    title: str
    items: tuple[FindingItem, ...]


# Errors


class AgentDisabledError(Exception):
    """The agent is turned off, or automation is off on this server."""


class WorkflowNotFoundError(Exception):
    """The workflow doesn't exist for this person in this workspace."""


class ExecutionNotFoundError(Exception):
    """The execution doesn't exist for this person in this workspace."""


class ApprovalNotFoundError(Exception):
    """The approval doesn't exist for this person in this workspace."""


class MemoryNotFoundError(Exception):
    """The memory doesn't exist for this person in this workspace."""


class ApprovalNotPendingError(Exception):
    """The approval was already decided, expired, or cancelled."""


class ApprovalChangedError(Exception):
    """The action differs from the one the person reviewed: it needs a fresh review."""


class ApprovalExpiredError(Exception):
    """The approval's time ran out."""


class ExecutionNotRetryableError(Exception):
    """Only failed executions can be retried."""


class ExecutionFinishedError(Exception):
    """The execution already finished."""


class RunLimitReachedError(Exception):
    """Today's limit of executions has been reached."""


class InvalidWorkflowError(ValueError):
    """A workflow definition is invalid. The message is safe to show."""


class InvalidToolCallError(ValueError):
    """A tool call was refused before it ran: unknown tool or invalid arguments. The message is
    safe to show and to give back to the planner."""


class ToolFailedError(Exception):
    """A tool ran and its module refused or failed. The message is safe to show."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable
