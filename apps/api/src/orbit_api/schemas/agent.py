"""The personal agent and automation API contract. Permissions are only ever set here, by the
signed-in person; nothing a model produces reaches these models."""

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.ai import AiRecordRef
from orbit_api.schemas.common import Name, TimeZoneName, multi_line, single_line
from orbit_api.services.agent.models import (
    Agent,
    AgentLimits,
    AgentModule,
    Approval,
    ApprovalStatus,
    AutonomyLevel,
    CompareOp,
    Condition,
    ConditionMetric,
    ConditionTrigger,
    EventKind,
    EventTrigger,
    Execution,
    ExecutionStatus,
    ExecutionStep,
    Memory,
    MemoryCategory,
    MemorySettings,
    MonitorCategory,
    MonitorFrequency,
    MonitorSettings,
    NotificationSettings,
    RecordedStepKind,
    RiskLevel,
    Schedule,
    ScheduleFrequency,
    StepKind,
    StepStatus,
    ToolAccess,
    ToolMode,
    Trigger,
    TriggerKind,
    Workflow,
    WorkflowDraft,
    WorkflowStep,
)
from orbit_api.services.agent.policy import Outcome
from orbit_api.services.agent.service import AgentChanges, Overview, ToolView
from orbit_api.utils.changes import UNSET

Description = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=500), AfterValidator(single_line)
]
Instructions = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(multi_line)
]
ModelName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(single_line),
]
ClockTime = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
StepId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
ArgumentValue = str | int | float | bool | None


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


# Settings


class AgentLimitsSchema(_Request):
    max_steps: int = Field(default=8, ge=1, le=20)
    max_tool_calls: int = Field(default=12, ge=1, le=40)
    timeout_seconds: int = Field(default=300, ge=30, le=3600)
    max_tokens_per_run: int = Field(default=20_000, ge=1000, le=500_000)
    max_runs_per_day: int = Field(default=50, ge=1, le=1000)
    max_autonomous_actions_per_day: int = Field(default=10, ge=0, le=200)
    approval_ttl_hours: int = Field(default=24, ge=1, le=24 * 14)
    max_retries: int = Field(default=2, ge=0, le=5)

    @classmethod
    def of(cls, limits: AgentLimits) -> "AgentLimitsSchema":
        return cls(**{name: getattr(limits, name) for name in cls.model_fields})

    def to_limits(self) -> AgentLimits:
        return AgentLimits(**self.model_dump())


class AgentMemorySettingsSchema(_Request):
    preferences: bool = True
    conversation: bool = True
    workflow: bool = True
    retention_days: int = Field(default=90, ge=1, le=3650)

    @classmethod
    def of(cls, memory: MemorySettings) -> "AgentMemorySettingsSchema":
        return cls(**{name: getattr(memory, name) for name in cls.model_fields})

    def to_settings(self) -> MemorySettings:
        return MemorySettings(**self.model_dump())


class AgentNotificationSettingsSchema(_Request):
    approvals: bool = True
    completed: bool = False
    failed: bool = True
    insights: bool = True

    @classmethod
    def of(cls, settings: NotificationSettings) -> "AgentNotificationSettingsSchema":
        return cls(**{name: getattr(settings, name) for name in cls.model_fields})

    def to_settings(self) -> NotificationSettings:
        return NotificationSettings(**self.model_dump())


class AgentMonitorSettingsSchema(_Request):
    enabled: bool = False
    categories: list[MonitorCategory] = Field(
        default_factory=lambda: sorted(MonitorSettings().categories), max_length=20
    )
    frequency: MonitorFrequency = "daily"
    days_ahead: int = Field(default=3, ge=1, le=30)
    document_days: int = Field(default=30, ge=1, le=365)
    budget_percent: int = Field(default=80, ge=10, le=200)

    @classmethod
    def of(cls, settings: MonitorSettings) -> "AgentMonitorSettingsSchema":
        return cls(
            enabled=settings.enabled,
            categories=sorted(settings.categories),
            frequency=settings.frequency,
            days_ahead=settings.days_ahead,
            document_days=settings.document_days,
            budget_percent=settings.budget_percent,
        )

    def to_settings(self) -> MonitorSettings:
        return MonitorSettings(
            enabled=self.enabled,
            categories=frozenset(self.categories),
            frequency=self.frequency,
            days_ahead=self.days_ahead,
            document_days=self.document_days,
            budget_percent=self.budget_percent,
        )


class AgentResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    enabled: bool
    instructions: str
    chat_model: str | None = Field(description="Null uses the AI layer's chosen chat model.")
    autonomy: AutonomyLevel
    modules: list[AgentModule]
    tool_modes: dict[str, ToolMode]
    action_types: list[ToolAccess]
    autonomous_triggers: list[TriggerKind]
    limits: AgentLimitsSchema
    memory: AgentMemorySettingsSchema
    notifications: AgentNotificationSettingsSchema
    monitoring: AgentMonitorSettingsSchema
    monitored_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, agent: Agent) -> "AgentResponse":
        return cls(
            id=agent.id,
            name=agent.name,
            description=agent.description,
            enabled=agent.enabled,
            instructions=agent.instructions,
            chat_model=agent.chat_model,
            autonomy=agent.autonomy,
            modules=sorted(agent.modules),
            tool_modes=dict(sorted(agent.tool_modes.items())),
            action_types=sorted(agent.action_types),
            autonomous_triggers=sorted(agent.autonomous_triggers),
            limits=AgentLimitsSchema.of(agent.limits),
            memory=AgentMemorySettingsSchema.of(agent.memory),
            notifications=AgentNotificationSettingsSchema.of(agent.notifications),
            monitoring=AgentMonitorSettingsSchema.of(agent.monitoring),
            monitored_at=agent.monitored_at,
            created_at=agent.created_at,
            updated_at=agent.updated_at,
        )


class UpdateAgentRequest(_Request):
    """Fields left out stay as they are; `chat_model: null` returns to the default model."""

    name: Name | None = None
    description: Description | None = None
    enabled: bool | None = None
    instructions: Instructions | None = None
    chat_model: ModelName | None = None
    autonomy: AutonomyLevel | None = None
    modules: list[AgentModule] | None = Field(default=None, max_length=20)
    tool_modes: dict[str, ToolMode] | None = None
    action_types: list[ToolAccess] | None = Field(default=None, max_length=3)
    autonomous_triggers: list[TriggerKind] | None = Field(default=None, max_length=5)
    limits: AgentLimitsSchema | None = None
    memory: AgentMemorySettingsSchema | None = None
    notifications: AgentNotificationSettingsSchema | None = None
    monitoring: AgentMonitorSettingsSchema | None = None

    @model_validator(mode="after")
    def _limits(self) -> Self:
        if self.tool_modes is not None and len(self.tool_modes) > 100:
            raise ValueError("too many tool settings")
        return self

    def to_changes(self) -> AgentChanges:
        given = self.model_fields_set

        def set_(name: str) -> bool:
            return name in given and (name == "chat_model" or getattr(self, name) is not None)

        return AgentChanges(
            name=self.name if set_("name") and self.name is not None else UNSET,
            description=self.description
            if set_("description") and self.description is not None
            else UNSET,
            enabled=self.enabled if set_("enabled") and self.enabled is not None else UNSET,
            instructions=self.instructions
            if set_("instructions") and self.instructions is not None
            else UNSET,
            chat_model=self.chat_model if set_("chat_model") else UNSET,
            autonomy=self.autonomy if set_("autonomy") and self.autonomy is not None else UNSET,
            modules=frozenset(self.modules) if self.modules is not None else UNSET,
            tool_modes=dict(self.tool_modes) if self.tool_modes is not None else UNSET,
            action_types=frozenset(self.action_types) if self.action_types is not None else UNSET,
            autonomous_triggers=frozenset(self.autonomous_triggers)
            if self.autonomous_triggers is not None
            else UNSET,
            limits=self.limits.to_limits() if self.limits is not None else UNSET,
            memory=self.memory.to_settings() if self.memory is not None else UNSET,
            notifications=self.notifications.to_settings()
            if self.notifications is not None
            else UNSET,
            monitoring=self.monitoring.to_settings() if self.monitoring is not None else UNSET,
        )


class AgentRuntimeResponse(BaseModel):
    """Where automations run, so the person knows what has to be running for them."""

    server_enabled: bool = Field(description="Whether automation is allowed on this server.")
    storage_mode: Literal["local", "cloud"]
    worker_embedded: bool = Field(
        description="Whether this API process runs the worker. When false, a separate "
        "`orbit-worker` must be running for workflows and runs to progress."
    )
    poll_seconds: float


class AgentToolResponse(BaseModel):
    name: str
    title: str
    description: str
    module: AgentModule | None
    access: ToolAccess
    risk: RiskLevel
    idempotent: bool
    approval: Literal["never", "configurable", "always"]
    uses_ai: bool
    in_workflows: bool
    input_schema: dict[str, object]
    output_schema: dict[str, object]
    mode: ToolMode | None = Field(description="The person's setting for this tool, if any.")
    outcome: Outcome = Field(description="What a manual run would do with it now.")
    reason: str

    @classmethod
    def of(cls, view: ToolView, agent: Agent) -> "AgentToolResponse":
        spec = view.spec
        approval: Literal["never", "configurable", "always"] = (
            "never"
            if spec.access == "read"
            else "always"
            if spec.always_confirm or spec.risk == "high"
            else "configurable"
        )
        return cls(
            name=spec.name,
            title=spec.title,
            description=spec.description,
            module=spec.module,
            access=spec.access,
            risk=spec.risk,
            idempotent=spec.idempotent,
            approval=approval,
            uses_ai=spec.uses_ai,
            in_workflows=spec.in_workflows,
            input_schema=spec.input_schema,
            output_schema=spec.output_schema,
            mode=agent.tool_modes.get(spec.name),
            outcome=view.decision.outcome,
            reason=view.decision.reason,
        )


class AgentToolListResponse(BaseModel):
    tools: list[AgentToolResponse]


# Workflows


class AgentScheduleSchema(_Request):
    frequency: ScheduleFrequency
    time: ClockTime = Field(description="HH:MM in `timezone`.")
    timezone: TimeZoneName
    weekdays: list[Annotated[int, Field(ge=0, le=6)]] = Field(
        default_factory=list[int], max_length=7, description="Monday is 0. Weekly only."
    )
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    on_date: date | None = None

    def to_schedule(self) -> Schedule:
        hour, minute = self.time.split(":")
        return Schedule(
            frequency=self.frequency,
            time=time(int(hour), int(minute)),
            timezone=self.timezone,
            weekdays=tuple(sorted(set(self.weekdays))),
            day_of_month=self.day_of_month,
            on_date=self.on_date,
        )

    @classmethod
    def of(cls, schedule: Schedule) -> "AgentScheduleSchema":
        return cls(
            frequency=schedule.frequency,
            time=schedule.time.strftime("%H:%M"),
            timezone=schedule.timezone,
            weekdays=list(schedule.weekdays),
            day_of_month=schedule.day_of_month,
            on_date=schedule.on_date,
        )


class AgentEventTriggerSchema(_Request):
    event: EventKind
    lead_minutes: int = Field(default=60, ge=5, le=7 * 24 * 60)
    days_ahead: int = Field(default=30, ge=1, le=365)


class AgentConditionTriggerSchema(_Request):
    metric: ConditionMetric
    op: Literal["gt", "gte", "lt", "lte", "eq", "ne"]
    value: float = Field(ge=-1e9, le=1e9)
    check_minutes: int = Field(default=60, ge=15, le=24 * 60)
    days_ahead: int = Field(default=7, ge=1, le=90)


class AgentTriggerSchema(_Request):
    kind: Literal["manual", "schedule", "event", "condition"]
    schedule: AgentScheduleSchema | None = None
    event: AgentEventTriggerSchema | None = None
    condition: AgentConditionTriggerSchema | None = None

    @model_validator(mode="after")
    def _matching(self) -> Self:
        needed = {"schedule": self.schedule, "event": self.event, "condition": self.condition}
        if self.kind in needed and needed[self.kind] is None:
            raise ValueError(f"a {self.kind} trigger needs its `{self.kind}` settings")
        return self

    def to_trigger(self) -> Trigger:
        return Trigger(
            kind=self.kind,
            schedule=self.schedule.to_schedule()
            if self.kind == "schedule" and self.schedule
            else None,
            event=EventTrigger(**self.event.model_dump())
            if self.kind == "event" and self.event
            else None,
            condition=ConditionTrigger(**self.condition.model_dump())
            if self.kind == "condition" and self.condition
            else None,
        )

    @classmethod
    def of(cls, trigger: Trigger) -> "AgentTriggerSchema":
        return cls(
            kind=trigger.kind,
            schedule=AgentScheduleSchema.of(trigger.schedule) if trigger.schedule else None,
            event=AgentEventTriggerSchema(
                event=trigger.event.event,
                lead_minutes=trigger.event.lead_minutes,
                days_ahead=trigger.event.days_ahead,
            )
            if trigger.event
            else None,
            condition=AgentConditionTriggerSchema(
                metric=trigger.condition.metric,
                op=_numeric_op(trigger.condition.op),
                value=trigger.condition.value,
                check_minutes=trigger.condition.check_minutes,
                days_ahead=trigger.condition.days_ahead,
            )
            if trigger.condition
            else None,
        )


def _numeric_op(op: CompareOp) -> Literal["gt", "gte", "lt", "lte", "eq", "ne"]:
    match op:
        case "gt" | "gte" | "lt" | "lte" | "eq" | "ne":
            return op
        case _:
            return "gte"


class AgentConditionSchema(_Request):
    left: str = Field(
        min_length=1, max_length=100, description="trigger.<field> or steps.<id>.<field>"
    )
    op: CompareOp
    right: ArgumentValue = None

    def to_condition(self) -> Condition:
        return Condition(left=self.left, op=self.op, right=self.right)

    @classmethod
    def of(cls, condition: Condition) -> "AgentConditionSchema":
        return cls(left=condition.left, op=condition.op, right=condition.right)


class AgentWorkflowStepSchema(_Request):
    id: StepId
    kind: StepKind
    title: str = Field(default="", max_length=200)
    tool: str | None = Field(default=None, max_length=80)
    arguments: dict[str, ArgumentValue] = Field(default_factory=dict[str, ArgumentValue])
    continue_on_error: bool = False
    condition: AgentConditionSchema | None = None
    on_false: str = Field(default="end", max_length=32)
    minutes: int = Field(default=0, ge=0, le=7 * 24 * 60)
    prompt: str = Field(default="", max_length=4000)

    def to_step(self) -> WorkflowStep:
        return WorkflowStep(
            id=self.id,
            kind=self.kind,
            title=self.title.strip(),
            tool=self.tool,
            arguments=dict(self.arguments),
            continue_on_error=self.continue_on_error,
            condition=self.condition.to_condition() if self.condition else None,
            on_false=self.on_false,
            minutes=self.minutes,
            prompt=self.prompt.strip(),
        )

    @classmethod
    def of(cls, step: WorkflowStep) -> "AgentWorkflowStepSchema":
        return cls(
            id=step.id,
            kind=step.kind,
            title=step.title,
            tool=step.tool,
            arguments=dict(step.arguments),
            continue_on_error=step.continue_on_error,
            condition=AgentConditionSchema.of(step.condition) if step.condition else None,
            on_false=step.on_false,
            minutes=step.minutes,
            prompt=step.prompt,
        )


class AgentWorkflowRequest(_Request):
    name: Name
    description: Description = ""
    enabled: bool = True
    trigger: AgentTriggerSchema
    conditions: list[AgentConditionSchema] = Field(
        default_factory=list[AgentConditionSchema], max_length=10
    )
    steps: list[AgentWorkflowStepSchema] = Field(min_length=1, max_length=20)
    max_runs_per_day: int = Field(default=24, ge=1, le=1000)

    def to_draft(self) -> WorkflowDraft:
        return WorkflowDraft(
            name=self.name,
            description=self.description,
            enabled=self.enabled,
            trigger=self.trigger.to_trigger(),
            conditions=tuple(c.to_condition() for c in self.conditions),
            steps=tuple(s.to_step() for s in self.steps),
            max_runs_per_day=self.max_runs_per_day,
        )


class SetAgentWorkflowEnabledRequest(_Request):
    enabled: bool


class AgentWorkflowResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    enabled: bool
    trigger: AgentTriggerSchema
    conditions: list[AgentConditionSchema]
    steps: list[AgentWorkflowStepSchema]
    max_runs_per_day: int
    next_run_at: datetime | None
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, workflow: Workflow) -> "AgentWorkflowResponse":
        return cls(
            id=workflow.id,
            name=workflow.name,
            description=workflow.description,
            enabled=workflow.enabled,
            trigger=AgentTriggerSchema.of(workflow.trigger),
            conditions=[AgentConditionSchema.of(c) for c in workflow.conditions],
            steps=[AgentWorkflowStepSchema.of(s) for s in workflow.steps],
            max_runs_per_day=workflow.max_runs_per_day,
            next_run_at=workflow.next_run_at,
            last_run_at=workflow.last_run_at,
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
        )


class AgentWorkflowListResponse(BaseModel):
    workflows: list[AgentWorkflowResponse]


class RunAgentWorkflowRequest(_Request):
    idempotency_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
        description="Retrying with the same key returns the same run instead of a second one.",
    )


# Runs and history


class StartAgentRunRequest(_Request):
    goal: str = Field(min_length=1, max_length=2000, description="What the agent should do.")
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=100)


class AgentExecutionResponse(BaseModel):
    id: uuid.UUID
    workflow_id: uuid.UUID | None
    title: str
    trigger_kind: TriggerKind
    trigger_data: dict[str, ArgumentValue]
    goal: str | None
    status: ExecutionStatus
    summary: str | None
    error: str | None
    steps_taken: int
    tool_calls: int
    attempts: int
    input_tokens: int
    output_tokens: int
    cancel_requested: bool
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    resume_at: datetime | None

    @classmethod
    def of(cls, execution: Execution) -> "AgentExecutionResponse":
        return cls(
            id=execution.id,
            workflow_id=execution.workflow_id,
            title=execution.title,
            trigger_kind=execution.trigger_kind,
            trigger_data=dict(execution.trigger_data),
            goal=execution.goal,
            status=execution.status,
            summary=execution.summary,
            error=execution.error,
            steps_taken=execution.steps_taken,
            tool_calls=execution.tool_calls,
            attempts=execution.attempts,
            input_tokens=execution.usage.input_tokens,
            output_tokens=execution.usage.output_tokens,
            cancel_requested=execution.cancel_requested,
            created_at=execution.created_at,
            started_at=execution.started_at,
            finished_at=execution.finished_at,
            resume_at=execution.resume_at,
        )


class AgentExecutionListResponse(BaseModel):
    executions: list[AgentExecutionResponse]


class AgentExecutionQueryParams(_Request):
    status: list[ExecutionStatus] = Field(default_factory=list[ExecutionStatus], max_length=7)
    workflow_id: uuid.UUID | None = None
    limit: int = Field(default=50, ge=1, le=200)


class AgentExecutionStepResponse(BaseModel):
    id: uuid.UUID
    position: int
    kind: RecordedStepKind
    title: str
    tool: str | None
    reason: str
    arguments: dict[str, object]
    status: StepStatus
    output: str
    records: list[AiRecordRef]
    error: str | None
    approval_id: uuid.UUID | None
    autonomous: bool
    started_at: datetime
    finished_at: datetime | None

    @classmethod
    def of(cls, step: ExecutionStep) -> "AgentExecutionStepResponse":
        return cls(
            id=step.id,
            position=step.position,
            kind=step.kind,
            title=step.title,
            tool=step.tool,
            reason=step.reason,
            arguments=step.arguments,
            status=step.status,
            output=step.output,
            records=[AiRecordRef.of(r) for r in step.records],
            error=step.error,
            approval_id=step.approval_id,
            autonomous=step.autonomous,
            started_at=step.started_at,
            finished_at=step.finished_at,
        )


# Approvals


class AgentApprovalResponse(BaseModel):
    id: uuid.UUID
    execution_id: uuid.UUID
    context: str = Field(description="The run it belongs to.")
    tool: str
    arguments: dict[str, object] = Field(description="Exactly what will run if approved.")
    arguments_hash: str = Field(description="Send it back to approve this exact action.")
    summary: str
    reason: str
    target: AiRecordRef | None
    effect: str
    risk: RiskLevel
    status: ApprovalStatus
    from_untrusted_context: bool = Field(
        description="Proposed after reading records or imported content, which may contain "
        "injected instructions."
    )
    expires_at: datetime
    created_at: datetime
    decided_at: datetime | None
    result: AiRecordRef | None
    error: str | None

    @classmethod
    def of(cls, approval: Approval) -> "AgentApprovalResponse":
        return cls(
            id=approval.id,
            execution_id=approval.execution_id,
            context=approval.context,
            tool=approval.tool,
            arguments=approval.arguments,
            arguments_hash=approval.arguments_hash,
            summary=approval.summary,
            reason=approval.reason,
            target=AiRecordRef.of(approval.target) if approval.target else None,
            effect=approval.effect,
            risk=approval.risk,
            status=approval.status,
            from_untrusted_context=approval.from_untrusted_context,
            expires_at=approval.expires_at,
            created_at=approval.created_at,
            decided_at=approval.decided_at,
            result=AiRecordRef.of(approval.result) if approval.result else None,
            error=approval.error,
        )


class AgentApprovalListResponse(BaseModel):
    approvals: list[AgentApprovalResponse]


class AgentApprovalQueryParams(_Request):
    status: list[ApprovalStatus] = Field(default_factory=list[ApprovalStatus], max_length=7)
    limit: int = Field(default=100, ge=1, le=200)


class ApproveAgentActionRequest(_Request):
    arguments_hash: str = Field(min_length=64, max_length=64)


class AgentExecutionDetailResponse(BaseModel):
    execution: AgentExecutionResponse
    steps: list[AgentExecutionStepResponse]
    approvals: list[AgentApprovalResponse]


class AgentOverviewResponse(BaseModel):
    agent: AgentResponse
    runtime: AgentRuntimeResponse
    pending_approvals: int
    workflows: int
    enabled_workflows: int
    recent: list[AgentExecutionResponse]

    @classmethod
    def of(cls, overview: Overview, runtime: AgentRuntimeResponse) -> "AgentOverviewResponse":
        return cls(
            agent=AgentResponse.of(overview.agent),
            runtime=runtime,
            pending_approvals=overview.pending_approvals,
            workflows=overview.workflows,
            enabled_workflows=overview.enabled_workflows,
            recent=[AgentExecutionResponse.of(e) for e in overview.recent],
        )


# Memory


MemoryText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=300),
    AfterValidator(single_line),
]


class AgentMemoryRequest(_Request):
    content: MemoryText


class AgentMemoryResponse(BaseModel):
    id: uuid.UUID
    category: MemoryCategory
    workflow_id: uuid.UUID | None
    content: str
    source: Literal["user", "agent"]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, memory: Memory) -> "AgentMemoryResponse":
        return cls(
            id=memory.id,
            category=memory.category,
            workflow_id=memory.workflow_id,
            content=memory.content,
            source=memory.source,
            created_at=memory.created_at,
            updated_at=memory.updated_at,
        )


class AgentMemoryListResponse(BaseModel):
    memories: list[AgentMemoryResponse]


class AgentMemoryQueryParams(_Request):
    category: MemoryCategory | None = None
