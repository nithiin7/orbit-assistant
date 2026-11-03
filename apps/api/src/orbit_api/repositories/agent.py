"""SQL for the agent tables, the change feed that finds event triggers in the modules' tables,
and the AI layer as the agent's model gateway.

Every query a person can reach filters by workspace and owner. The worker's queries (due
schedules, claims) select by state and then load rows by ID; nothing here accepts an ID from a
model.
"""

import uuid
from collections.abc import Sequence
from dataclasses import replace
from datetime import date, datetime, time, timedelta
from typing import Any, Final, Literal, cast

from sqlalchemy import ColumnElement, and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    AgentApprovalModel,
    AgentExecutionModel,
    AgentExecutionStepModel,
    AgentMemoryModel,
    AgentModel,
    AgentMonitorAlertModel,
    AgentWorkflowModel,
    FinanceBudgetAlertModel,
    FinanceBudgetModel,
    FinanceBudgetPeriodModel,
    IntegrationLinkModel,
    NotificationModel,
    TaskModel,
    UserModel,
    WorkspaceModel,
)
from orbit_api.repositories.transaction import flush
from orbit_api.services.agent.models import (
    AGENT_MODULES,
    APPROVAL_STATUSES,
    AUTONOMY_LEVELS,
    COMPARE_OPS,
    CONDITION_METRICS,
    EVENT_KINDS,
    MONITOR_CATEGORIES,
    STEP_KINDS,
    TRIGGER_KINDS,
    Agent,
    AgentLimits,
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
    ExecutionQuery,
    ExecutionStatus,
    ExecutionStep,
    Memory,
    MemoryCategory,
    MemorySettings,
    MonitorFrequency,
    MonitorSettings,
    NotificationSettings,
    RecordedStepKind,
    RiskLevel,
    Scalar,
    Schedule,
    ScheduleFrequency,
    StepKind,
    StepStatus,
    ToolAccess,
    ToolMode,
    Trigger,
    TriggerKind,
    Usage,
    Workflow,
    WorkflowStep,
)
from orbit_api.services.agent.signals import Signal
from orbit_api.services.ai.configuration import AiConfigService, ResolvedProvider
from orbit_api.services.ai.models import AiModule, RecordRef

_E = AgentExecutionModel
_W = AgentWorkflowModel
_A = AgentApprovalModel
_TOOL_MODES: Final[tuple[ToolMode, ...]] = ("off", "ask", "auto")
_ACCESS: Final[tuple[ToolAccess, ...]] = ("read", "create", "update")
_FREQUENCIES: Final[tuple[ScheduleFrequency, ...]] = ("daily", "weekly", "monthly", "once")
_WORKFLOW_TRIGGERS: Final[tuple[Literal["manual", "schedule", "event", "condition"], ...]] = (
    "manual",
    "schedule",
    "event",
    "condition",
)
_MONITOR_FREQUENCIES: Final[tuple[MonitorFrequency, ...]] = ("hourly", "every_6_hours", "daily")


def _rowcount(result: object) -> int:
    return cast(int, getattr(result, "rowcount", 0))


def _pick[T: str](value: object, options: Sequence[T], default: T) -> T:
    return next((option for option in options if option == value), default)


def _picks[T: str](values: object, options: Sequence[T]) -> frozenset[T]:
    if not isinstance(values, list):
        return frozenset()
    items = cast(list[object], values)
    return frozenset(option for option in options if option in items)


def _int(value: object, default: int) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _bool(value: object, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def _dict(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


# Mapping: agents


def encode_limits(limits: AgentLimits) -> dict[str, Any]:
    return {
        "max_steps": limits.max_steps,
        "max_tool_calls": limits.max_tool_calls,
        "timeout_seconds": limits.timeout_seconds,
        "max_tokens_per_run": limits.max_tokens_per_run,
        "max_runs_per_day": limits.max_runs_per_day,
        "max_autonomous_actions_per_day": limits.max_autonomous_actions_per_day,
        "approval_ttl_hours": limits.approval_ttl_hours,
        "max_retries": limits.max_retries,
    }


def _limits(raw: dict[str, Any]) -> AgentLimits:
    d = AgentLimits()
    return AgentLimits(
        max_steps=_int(raw.get("max_steps"), d.max_steps),
        max_tool_calls=_int(raw.get("max_tool_calls"), d.max_tool_calls),
        timeout_seconds=_int(raw.get("timeout_seconds"), d.timeout_seconds),
        max_tokens_per_run=_int(raw.get("max_tokens_per_run"), d.max_tokens_per_run),
        max_runs_per_day=_int(raw.get("max_runs_per_day"), d.max_runs_per_day),
        max_autonomous_actions_per_day=_int(
            raw.get("max_autonomous_actions_per_day"), d.max_autonomous_actions_per_day
        ),
        approval_ttl_hours=_int(raw.get("approval_ttl_hours"), d.approval_ttl_hours),
        max_retries=_int(raw.get("max_retries"), d.max_retries),
    )


def _memory_settings(raw: dict[str, Any]) -> MemorySettings:
    d = MemorySettings()
    return MemorySettings(
        preferences=_bool(raw.get("preferences"), d.preferences),
        conversation=_bool(raw.get("conversation"), d.conversation),
        workflow=_bool(raw.get("workflow"), d.workflow),
        retention_days=_int(raw.get("retention_days"), d.retention_days),
    )


def _notification_settings(raw: dict[str, Any]) -> NotificationSettings:
    d = NotificationSettings()
    return NotificationSettings(
        approvals=_bool(raw.get("approvals"), d.approvals),
        completed=_bool(raw.get("completed"), d.completed),
        failed=_bool(raw.get("failed"), d.failed),
        insights=_bool(raw.get("insights"), d.insights),
    )


def _monitor_settings(raw: dict[str, Any]) -> MonitorSettings:
    d = MonitorSettings()
    return MonitorSettings(
        enabled=_bool(raw.get("enabled"), d.enabled),
        categories=_picks(raw.get("categories"), MONITOR_CATEGORIES)
        if "categories" in raw
        else d.categories,
        frequency=_pick(raw.get("frequency"), _MONITOR_FREQUENCIES, d.frequency),
        days_ahead=_int(raw.get("days_ahead"), d.days_ahead),
        document_days=_int(raw.get("document_days"), d.document_days),
        budget_percent=_int(raw.get("budget_percent"), d.budget_percent),
    )


def _agent(model: AgentModel) -> Agent:
    return Agent(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        name=model.name,
        description=model.description,
        enabled=model.enabled,
        instructions=model.instructions,
        chat_model=model.chat_model,
        autonomy=_pick(model.autonomy, AUTONOMY_LEVELS, cast(AutonomyLevel, "read_only")),
        modules=_picks(model.modules, AGENT_MODULES),
        tool_modes={
            str(name): _pick(mode, _TOOL_MODES, cast(ToolMode, "ask"))
            for name, mode in _dict(model.tool_modes).items()
        },
        action_types=_picks(model.action_types, _ACCESS),
        autonomous_triggers=_picks(model.autonomous_triggers, TRIGGER_KINDS),
        limits=_limits(_dict(model.limits)),
        memory=_memory_settings(_dict(model.memory)),
        notifications=_notification_settings(_dict(model.notifications)),
        monitoring=_monitor_settings(_dict(model.monitoring)),
        monitored_at=model.monitored_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _agent_values(agent: Agent) -> dict[str, Any]:
    monitoring = agent.monitoring
    return {
        "name": agent.name,
        "description": agent.description,
        "enabled": agent.enabled,
        "instructions": agent.instructions,
        "chat_model": agent.chat_model,
        "autonomy": agent.autonomy,
        "modules": sorted(agent.modules),
        "tool_modes": dict(sorted(agent.tool_modes.items())),
        "action_types": sorted(agent.action_types),
        "autonomous_triggers": sorted(agent.autonomous_triggers),
        "limits": encode_limits(agent.limits),
        "memory": {
            "preferences": agent.memory.preferences,
            "conversation": agent.memory.conversation,
            "workflow": agent.memory.workflow,
            "retention_days": agent.memory.retention_days,
        },
        "notifications": {
            "approvals": agent.notifications.approvals,
            "completed": agent.notifications.completed,
            "failed": agent.notifications.failed,
            "insights": agent.notifications.insights,
        },
        "monitoring": {
            "enabled": monitoring.enabled,
            "categories": sorted(monitoring.categories),
            "frequency": monitoring.frequency,
            "days_ahead": monitoring.days_ahead,
            "document_days": monitoring.document_days,
            "budget_percent": monitoring.budget_percent,
        },
        "monitored_at": agent.monitored_at,
        "updated_at": agent.updated_at,
    }


# Mapping: workflows


def encode_trigger(trigger: Trigger) -> dict[str, Any]:
    raw: dict[str, Any] = {"kind": trigger.kind}
    if trigger.schedule is not None:
        s = trigger.schedule
        raw["schedule"] = {
            "frequency": s.frequency,
            "time": s.time.strftime("%H:%M"),
            "timezone": s.timezone,
            "weekdays": list(s.weekdays),
            "day_of_month": s.day_of_month,
            "on_date": s.on_date.isoformat() if s.on_date else None,
        }
    if trigger.event is not None:
        e = trigger.event
        raw["event"] = {
            "event": e.event,
            "lead_minutes": e.lead_minutes,
            "days_ahead": e.days_ahead,
        }
    if trigger.condition is not None:
        c = trigger.condition
        raw["condition"] = {
            "metric": c.metric,
            "op": c.op,
            "value": c.value,
            "check_minutes": c.check_minutes,
            "days_ahead": c.days_ahead,
        }
    return raw


def _trigger(raw: dict[str, Any]) -> Trigger:
    kind: Literal["manual", "schedule", "event", "condition"] = "manual"
    for option in _WORKFLOW_TRIGGERS:
        if option == raw.get("kind"):
            kind = option
    schedule = event = condition = None
    if isinstance(s := raw.get("schedule"), dict):
        s = cast(dict[str, Any], s)
        hour, minute = [*str(s.get("time") or "08:00").split(":"), "0"][:2]
        on_date = s.get("on_date")
        schedule = Schedule(
            frequency=_pick(s.get("frequency"), _FREQUENCIES, cast(ScheduleFrequency, "daily")),
            time=time(int(hour), int(minute)),
            timezone=str(s.get("timezone") or "UTC"),
            weekdays=tuple(int(d) for d in cast(list[Any], s.get("weekdays") or [])),
            day_of_month=s.get("day_of_month"),
            on_date=date.fromisoformat(on_date) if isinstance(on_date, str) else None,
        )
    if isinstance(e := raw.get("event"), dict):
        e = cast(dict[str, Any], e)
        event = EventTrigger(
            event=_pick(e.get("event"), EVENT_KINDS, cast(EventKind, "task_created")),
            lead_minutes=_int(e.get("lead_minutes"), 60),
            days_ahead=_int(e.get("days_ahead"), 30),
        )
    if isinstance(c := raw.get("condition"), dict):
        c = cast(dict[str, Any], c)
        condition = ConditionTrigger(
            metric=_pick(
                c.get("metric"), CONDITION_METRICS, cast(ConditionMetric, "overdue_tasks")
            ),
            op=_pick(c.get("op"), COMPARE_OPS, cast(CompareOp, "gte")),
            value=float(c.get("value") or 0),
            check_minutes=_int(c.get("check_minutes"), 60),
            days_ahead=_int(c.get("days_ahead"), 7),
        )
    return Trigger(kind=kind, schedule=schedule, event=event, condition=condition)


def encode_condition(condition: Condition) -> dict[str, Any]:
    return {"left": condition.left, "op": condition.op, "right": condition.right}


def _condition(raw: dict[str, Any]) -> Condition:
    right = raw.get("right")
    return Condition(
        left=str(raw.get("left") or ""),
        op=_pick(raw.get("op"), COMPARE_OPS, cast(CompareOp, "exists")),
        right=right if right is None or isinstance(right, str | int | float | bool) else None,
    )


def encode_step(step: WorkflowStep) -> dict[str, Any]:
    return {
        "id": step.id,
        "kind": step.kind,
        "title": step.title,
        "tool": step.tool,
        "arguments": dict(step.arguments),
        "continue_on_error": step.continue_on_error,
        "condition": encode_condition(step.condition) if step.condition else None,
        "on_false": step.on_false,
        "minutes": step.minutes,
        "prompt": step.prompt,
    }


def _step(raw: dict[str, Any]) -> WorkflowStep:
    condition = raw.get("condition")
    arguments: dict[str, Scalar] = {
        str(k): v
        for k, v in _dict(raw.get("arguments")).items()
        if v is None or isinstance(v, str | int | float | bool)
    }
    return WorkflowStep(
        id=str(raw.get("id") or "step"),
        kind=_pick(raw.get("kind"), STEP_KINDS, cast(StepKind, "tool")),
        title=str(raw.get("title") or ""),
        tool=raw.get("tool") if isinstance(raw.get("tool"), str) else None,
        arguments=arguments,
        continue_on_error=_bool(raw.get("continue_on_error"), False),
        condition=_condition(cast(dict[str, Any], condition))
        if isinstance(condition, dict)
        else None,
        on_false=str(raw.get("on_false") or "end"),
        minutes=_int(raw.get("minutes"), 0),
        prompt=str(raw.get("prompt") or ""),
    )


def _workflow(model: AgentWorkflowModel) -> Workflow:
    return Workflow(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        agent_id=model.agent_id,
        name=model.name,
        description=model.description,
        enabled=model.enabled,
        trigger=_trigger(_dict(model.trigger)),
        conditions=tuple(_condition(_dict(c)) for c in model.conditions),
        steps=tuple(_step(_dict(s)) for s in model.steps),
        max_runs_per_day=model.max_runs_per_day,
        next_run_at=model.next_run_at,
        trigger_cursor=model.trigger_cursor,
        condition_state=model.condition_state,
        checked_at=model.checked_at,
        last_run_at=model.last_run_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _workflow_values(workflow: Workflow) -> dict[str, Any]:
    return {
        "name": workflow.name,
        "description": workflow.description,
        "enabled": workflow.enabled,
        "trigger_kind": workflow.trigger.kind,
        "trigger": encode_trigger(workflow.trigger),
        "conditions": [encode_condition(c) for c in workflow.conditions],
        "steps": [encode_step(s) for s in workflow.steps],
        "max_runs_per_day": workflow.max_runs_per_day,
        "next_run_at": workflow.next_run_at,
        "trigger_cursor": workflow.trigger_cursor,
        "condition_state": workflow.condition_state,
        "checked_at": workflow.checked_at,
        "last_run_at": workflow.last_run_at,
        "updated_at": workflow.updated_at,
    }


# Mapping: executions, steps, approvals, memory


def _ref(raw: object) -> RecordRef | None:
    if not isinstance(raw, dict):
        return None
    d = cast(dict[str, Any], raw)
    ref_id = d.get("id")
    day = d.get("day")
    try:
        return RecordRef(
            kind=str(d.get("kind") or ""),
            id=uuid.UUID(ref_id) if isinstance(ref_id, str) else None,
            title=str(d.get("title") or ""),
            day=date.fromisoformat(day) if isinstance(day, str) else None,
            detail=str(d.get("detail") or ""),
        )
    except ValueError:
        return None


def encode_ref(ref: RecordRef) -> dict[str, Any]:
    return {
        "kind": ref.kind,
        "id": str(ref.id) if ref.id else None,
        "title": ref.title,
        "day": ref.day.isoformat() if ref.day else None,
        "detail": ref.detail,
    }


def _execution(model: AgentExecutionModel) -> Execution:
    return Execution(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        agent_id=model.agent_id,
        workflow_id=model.workflow_id,
        title=model.title,
        trigger_kind=_pick(model.trigger_kind, TRIGGER_KINDS, cast(TriggerKind, "manual")),
        trigger_key=model.trigger_key,
        trigger_data={
            str(k): v
            for k, v in _dict(model.trigger_data).items()
            if v is None or isinstance(v, str | int | float | bool)
        },
        goal=model.goal,
        status=cast(ExecutionStatus, model.status),
        cursor=model.cursor,
        state=_dict(model.state),
        attempts=model.attempts,
        steps_taken=model.steps_taken,
        tool_calls=model.tool_calls,
        usage=Usage(
            input_tokens=model.input_tokens,
            output_tokens=model.output_tokens,
            cost_micros=model.cost_micros,
        ),
        error=model.error,
        summary=model.summary,
        cancel_requested=model.cancel_requested,
        lease_until=model.lease_until,
        resume_at=model.resume_at,
        created_at=model.created_at,
        started_at=model.started_at,
        finished_at=model.finished_at,
        updated_at=model.updated_at,
    )


def _execution_values(execution: Execution) -> dict[str, Any]:
    return {
        "title": execution.title,
        "status": execution.status,
        "cursor": execution.cursor,
        "state": execution.state,
        "attempts": execution.attempts,
        "steps_taken": execution.steps_taken,
        "tool_calls": execution.tool_calls,
        "input_tokens": execution.usage.input_tokens,
        "output_tokens": execution.usage.output_tokens,
        "cost_micros": execution.usage.cost_micros,
        "error": execution.error,
        "summary": execution.summary,
        "lease_until": execution.lease_until,
        "resume_at": execution.resume_at,
        "started_at": execution.started_at,
        "finished_at": execution.finished_at,
        "updated_at": execution.updated_at,
    }


def _step_row(model: AgentExecutionStepModel) -> ExecutionStep:
    return ExecutionStep(
        id=model.id,
        execution_id=model.execution_id,
        workspace_id=model.workspace_id,
        position=model.position,
        kind=cast(RecordedStepKind, model.kind),
        title=model.title,
        tool=model.tool,
        reason=model.reason,
        arguments=_dict(model.arguments),
        status=cast(StepStatus, model.status),
        output=model.output,
        records=tuple(r for raw in model.records if (r := _ref(raw)) is not None),
        error=model.error,
        approval_id=model.approval_id,
        autonomous=model.autonomous,
        started_at=model.started_at,
        finished_at=model.finished_at,
    )


def _approval(model: AgentApprovalModel) -> Approval:
    return Approval(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        agent_id=model.agent_id,
        execution_id=model.execution_id,
        step_position=model.step_position,
        tool=model.tool,
        arguments=_dict(model.arguments),
        arguments_hash=model.arguments_hash,
        summary=model.summary,
        reason=model.reason,
        context=model.context,
        target=_ref(model.target),
        effect=model.effect,
        risk=cast(RiskLevel, model.risk),
        status=_pick(model.status, APPROVAL_STATUSES, cast(ApprovalStatus, "failed")),
        from_untrusted_context=model.from_untrusted_context,
        expires_at=model.expires_at,
        created_at=model.created_at,
        decided_at=model.decided_at,
        result=_ref(model.result),
        error=model.error,
    )


def _memory(model: AgentMemoryModel) -> Memory:
    return Memory(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        agent_id=model.agent_id,
        category=cast(MemoryCategory, model.category),
        workflow_id=model.workflow_id,
        content=model.content,
        source="user" if model.source == "user" else "agent",
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _claimable(now: datetime) -> ColumnElement[bool]:
    return or_(
        and_(_E.status == "queued", or_(_E.resume_at.is_(None), _E.resume_at <= now)),
        and_(_E.status == "waiting", _E.resume_at <= now),
        and_(_E.status == "running", or_(_E.lease_until.is_(None), _E.lease_until < now)),
    )


class SqlAgentStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # Agents

    async def agent(self, agent_id: uuid.UUID) -> Agent | None:
        model = await self._session.get(AgentModel, agent_id)
        return _agent(model) if model else None

    async def primary(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Agent | None:
        model = await self._session.scalar(
            select(AgentModel).where(
                AgentModel.workspace_id == workspace_id,
                AgentModel.user_id == user_id,
                AgentModel.is_primary.is_(True),
            )
        )
        return _agent(model) if model else None

    async def add_agent(self, agent: Agent) -> None:
        self._session.add(
            AgentModel(
                id=agent.id,
                workspace_id=agent.workspace_id,
                user_id=agent.user_id,
                is_primary=True,
                created_at=agent.created_at,
                **_agent_values(agent),
            )
        )
        await flush(self._session)

    async def save_agent(self, agent: Agent) -> None:
        await self._session.execute(
            update(AgentModel)
            .where(AgentModel.id == agent.id, AgentModel.user_id == agent.user_id)
            .values(**_agent_values(agent))
            .execution_options(synchronize_session=False)
        )

    async def owns_workspace(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        owner = await self._session.scalar(
            select(WorkspaceModel.owner_id).where(WorkspaceModel.id == workspace_id)
        )
        return owner == user_id

    async def timezone(self, user_id: uuid.UUID) -> str:
        zone = await self._session.scalar(select(UserModel.timezone).where(UserModel.id == user_id))
        return zone or "UTC"

    async def monitored_agents(self, limit: int) -> list[Agent]:
        models = await self._session.scalars(
            select(AgentModel)
            .where(AgentModel.enabled.is_(True))
            .order_by(AgentModel.monitored_at.asc().nulls_first(), AgentModel.id)
            .limit(limit * 5)
        )
        agents = [_agent(m) for m in models]
        return [a for a in agents if a.monitoring.enabled][:limit]

    async def claim_monitor(
        self, agent_id: uuid.UUID, previous: datetime | None, now: datetime
    ) -> bool:
        same = (
            AgentModel.monitored_at.is_(None)
            if previous is None
            else AgentModel.monitored_at == previous
        )
        result = await self._session.execute(
            update(AgentModel)
            .where(AgentModel.id == agent_id, same)
            .values(monitored_at=now)
            .execution_options(synchronize_session=False)
        )
        return _rowcount(result) == 1

    # Workflows

    async def workflow(self, workflow_id: uuid.UUID) -> Workflow | None:
        model = await self._session.get(AgentWorkflowModel, workflow_id)
        return _workflow(model) if model else None

    async def workflows(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[Workflow]:
        models = await self._session.scalars(
            select(_W)
            .where(_W.workspace_id == workspace_id, _W.user_id == user_id)
            .order_by(_W.created_at, _W.id)
        )
        return [_workflow(m) for m in models]

    async def get_workflow(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, workflow_id: uuid.UUID
    ) -> Workflow | None:
        model = await self._session.scalar(
            select(_W).where(
                _W.id == workflow_id, _W.workspace_id == workspace_id, _W.user_id == user_id
            )
        )
        return _workflow(model) if model else None

    async def add_workflow(self, workflow: Workflow) -> None:
        self._session.add(
            AgentWorkflowModel(
                id=workflow.id,
                workspace_id=workflow.workspace_id,
                user_id=workflow.user_id,
                agent_id=workflow.agent_id,
                created_at=workflow.created_at,
                **_workflow_values(workflow),
            )
        )
        await flush(self._session)

    async def save_workflow(self, workflow: Workflow) -> None:
        await self._session.execute(
            update(_W)
            .where(_W.id == workflow.id, _W.user_id == workflow.user_id)
            .values(**_workflow_values(workflow))
            .execution_options(synchronize_session=False)
        )

    async def delete_workflow(self, workflow: Workflow) -> None:
        await self._session.execute(
            delete(_W).where(_W.id == workflow.id, _W.user_id == workflow.user_id)
        )

    async def due_schedules(self, now: datetime, limit: int) -> list[Workflow]:
        models = await self._session.scalars(
            select(_W)
            .where(
                _W.enabled.is_(True),
                _W.trigger_kind == "schedule",
                _W.next_run_at.is_not(None),
                _W.next_run_at <= now,
            )
            .order_by(_W.next_run_at, _W.id)
            .limit(limit)
        )
        return [_workflow(m) for m in models]

    async def claim_schedule(
        self, workflow_id: uuid.UUID, expected: datetime, following: datetime | None
    ) -> bool:
        result = await self._session.execute(
            update(_W)
            .where(_W.id == workflow_id, _W.next_run_at == expected)
            .values(next_run_at=following)
            .execution_options(synchronize_session=False)
        )
        return _rowcount(result) == 1

    async def watched_workflows(self, checked_before: datetime, limit: int) -> list[Workflow]:
        models = await self._session.scalars(
            select(_W)
            .where(
                _W.enabled.is_(True),
                _W.trigger_kind.in_(("event", "condition")),
                or_(_W.checked_at.is_(None), _W.checked_at <= checked_before),
            )
            .order_by(_W.checked_at.asc().nulls_first(), _W.id)
            .limit(limit)
        )
        return [_workflow(m) for m in models]

    async def claim_check(
        self, workflow_id: uuid.UUID, previous: datetime | None, now: datetime
    ) -> bool:
        same = _W.checked_at.is_(None) if previous is None else _W.checked_at == previous
        result = await self._session.execute(
            update(_W)
            .where(_W.id == workflow_id, same)
            .values(checked_at=now)
            .execution_options(synchronize_session=False)
        )
        return _rowcount(result) == 1

    # Executions

    async def executions(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, query: ExecutionQuery
    ) -> list[Execution]:
        conditions = [_E.workspace_id == workspace_id, _E.user_id == user_id]
        if query.statuses:
            conditions.append(_E.status.in_(sorted(query.statuses)))
        if query.workflow_id is not None:
            conditions.append(_E.workflow_id == query.workflow_id)
        models = await self._session.scalars(
            select(_E).where(*conditions).order_by(_E.created_at.desc(), _E.id).limit(query.limit)
        )
        return [_execution(m) for m in models]

    async def get_execution(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, execution_id: uuid.UUID
    ) -> Execution | None:
        model = await self._session.scalar(
            select(_E).where(
                _E.id == execution_id, _E.workspace_id == workspace_id, _E.user_id == user_id
            )
        )
        return _execution(model) if model else None

    async def execution_by_id(self, execution_id: uuid.UUID) -> Execution | None:
        model = await self._session.get(AgentExecutionModel, execution_id, populate_existing=True)
        return _execution(model) if model else None

    async def execution_by_key(self, agent_id: uuid.UUID, trigger_key: str) -> Execution | None:
        model = await self._session.scalar(
            select(_E).where(_E.agent_id == agent_id, _E.trigger_key == trigger_key[:300])
        )
        return _execution(model) if model else None

    async def add_execution(self, execution: Execution) -> None:
        self._session.add(
            AgentExecutionModel(
                id=execution.id,
                workspace_id=execution.workspace_id,
                user_id=execution.user_id,
                agent_id=execution.agent_id,
                workflow_id=execution.workflow_id,
                trigger_kind=execution.trigger_kind,
                trigger_key=execution.trigger_key,
                trigger_data=dict(execution.trigger_data),
                goal=execution.goal,
                cancel_requested=execution.cancel_requested,
                created_at=execution.created_at,
                **_execution_values(execution),
            )
        )
        await flush(self._session)

    async def save_execution(self, execution: Execution) -> None:
        await self._session.execute(
            update(_E)
            .where(_E.id == execution.id)
            .values(**_execution_values(execution))
            .execution_options(synchronize_session=False)
        )

    async def cancel_requested(self, execution_id: uuid.UUID) -> bool:
        value = await self._session.scalar(select(_E.cancel_requested).where(_E.id == execution_id))
        return bool(value)

    async def request_cancel(self, execution_id: uuid.UUID) -> None:
        await self._session.execute(
            update(_E)
            .where(_E.id == execution_id)
            .values(cancel_requested=True)
            .execution_options(synchronize_session=False)
        )

    async def runs_since(
        self, agent_id: uuid.UUID, since: datetime, workflow_id: uuid.UUID | None = None
    ) -> int:
        conditions = [_E.agent_id == agent_id, _E.created_at >= since]
        if workflow_id is not None:
            conditions.append(_E.workflow_id == workflow_id)
        return await self._session.scalar(select(func.count()).where(*conditions)) or 0

    async def recent_runs(self, agent_id: uuid.UUID, limit: int) -> list[Execution]:
        models = await self._session.scalars(
            select(_E)
            .where(_E.agent_id == agent_id, _E.workflow_id.is_(None), _E.finished_at.is_not(None))
            .order_by(_E.created_at.desc())
            .limit(limit)
        )
        return [_execution(m) for m in models]

    async def claim_executions(
        self, now: datetime, lease_until: datetime, limit: int
    ) -> list[Execution]:
        ids = list(
            await self._session.scalars(
                select(_E.id).where(_claimable(now)).order_by(_E.created_at, _E.id).limit(limit)
            )
        )
        claimed: list[Execution] = []
        for execution_id in ids:
            # Conditional update: of two workers, the first to update wins.
            result = await self._session.execute(
                update(_E)
                .where(_E.id == execution_id, _claimable(now))
                .values(status="running", lease_until=lease_until, attempts=_E.attempts + 1)
                .execution_options(synchronize_session=False)
            )
            if _rowcount(result) == 1:
                execution = await self.execution_by_id(execution_id)
                if execution is not None:
                    claimed.append(execution)
        return claimed

    # Steps

    async def add_step(self, step: ExecutionStep) -> None:
        self._session.add(
            AgentExecutionStepModel(
                id=step.id,
                execution_id=step.execution_id,
                workspace_id=step.workspace_id,
                position=step.position,
                kind=step.kind,
                title=step.title,
                tool=step.tool,
                reason=step.reason,
                arguments=step.arguments,
                status=step.status,
                output=step.output,
                records=[encode_ref(r) for r in step.records],
                error=step.error,
                approval_id=step.approval_id,
                autonomous=step.autonomous,
                started_at=step.started_at,
                finished_at=step.finished_at,
            )
        )
        await flush(self._session)

    async def save_step(self, step: ExecutionStep) -> None:
        await self._session.execute(
            update(AgentExecutionStepModel)
            .where(AgentExecutionStepModel.id == step.id)
            .values(
                status=step.status,
                output=step.output,
                records=[encode_ref(r) for r in step.records],
                error=step.error,
                finished_at=step.finished_at,
            )
            .execution_options(synchronize_session=False)
        )

    async def step(self, step_id: uuid.UUID) -> ExecutionStep | None:
        model = await self._session.get(AgentExecutionStepModel, step_id, populate_existing=True)
        return _step_row(model) if model else None

    async def steps(self, execution_id: uuid.UUID) -> list[ExecutionStep]:
        models = await self._session.scalars(
            select(AgentExecutionStepModel)
            .where(AgentExecutionStepModel.execution_id == execution_id)
            .order_by(AgentExecutionStepModel.position)
            .execution_options(populate_existing=True)
        )
        return [_step_row(m) for m in models]

    async def autonomous_since(self, agent_id: uuid.UUID, since: datetime) -> int:
        count = await self._session.scalar(
            select(func.count())
            .select_from(AgentExecutionStepModel)
            .join(_E, _E.id == AgentExecutionStepModel.execution_id)
            .where(
                _E.agent_id == agent_id,
                AgentExecutionStepModel.autonomous.is_(True),
                AgentExecutionStepModel.started_at >= since,
            )
        )
        return count or 0

    # Approvals

    async def add_approval(self, approval: Approval) -> None:
        self._session.add(
            AgentApprovalModel(
                id=approval.id,
                workspace_id=approval.workspace_id,
                user_id=approval.user_id,
                agent_id=approval.agent_id,
                execution_id=approval.execution_id,
                step_position=approval.step_position,
                tool=approval.tool,
                arguments=approval.arguments,
                arguments_hash=approval.arguments_hash,
                summary=approval.summary,
                reason=approval.reason,
                context=approval.context,
                target=encode_ref(approval.target) if approval.target else None,
                effect=approval.effect,
                risk=approval.risk,
                status=approval.status,
                from_untrusted_context=approval.from_untrusted_context,
                expires_at=approval.expires_at,
                created_at=approval.created_at,
                decided_at=approval.decided_at,
                result=None,
                error=None,
            )
        )
        await flush(self._session)

    async def save_approval(self, approval: Approval) -> None:
        await self._session.execute(
            update(_A)
            .where(_A.id == approval.id)
            .values(
                status=approval.status,
                decided_at=approval.decided_at,
                result=encode_ref(approval.result) if approval.result else None,
                error=approval.error,
            )
            .execution_options(synchronize_session=False)
        )

    async def transition_approval(
        self,
        approval_id: uuid.UUID,
        expected: ApprovalStatus,
        status: ApprovalStatus,
        now: datetime,
    ) -> bool:
        result = await self._session.execute(
            update(_A)
            .where(_A.id == approval_id, _A.status == expected)
            .values(status=status, decided_at=now)
            .execution_options(synchronize_session=False)
        )
        return _rowcount(result) == 1

    async def pending_approvals(self, execution_id: uuid.UUID) -> list[Approval]:
        models = await self._session.scalars(
            select(_A).where(_A.execution_id == execution_id, _A.status == "pending")
        )
        return [_approval(m) for m in models]

    async def approvals(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        statuses: frozenset[ApprovalStatus],
        limit: int,
    ) -> list[Approval]:
        conditions = [_A.workspace_id == workspace_id, _A.user_id == user_id]
        if statuses:
            conditions.append(_A.status.in_(sorted(statuses)))
        models = await self._session.scalars(
            select(_A)
            .where(*conditions)
            .order_by(_A.created_at.desc(), _A.id)
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        return [_approval(m) for m in models]

    async def get_approval(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> Approval | None:
        model = await self._session.scalar(
            select(_A)
            .where(_A.id == approval_id, _A.workspace_id == workspace_id, _A.user_id == user_id)
            .execution_options(populate_existing=True)
        )
        return _approval(model) if model else None

    async def pending_count(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> int:
        count = await self._session.scalar(
            select(func.count()).where(
                _A.workspace_id == workspace_id, _A.user_id == user_id, _A.status == "pending"
            )
        )
        return count or 0

    async def expired_approvals(self, now: datetime, limit: int) -> list[Approval]:
        models = await self._session.scalars(
            select(_A)
            .where(_A.status == "pending", _A.expires_at <= now)
            .order_by(_A.expires_at)
            .limit(limit)
        )
        return [_approval(m) for m in models]

    # Memory

    async def memories(
        self,
        agent_id: uuid.UUID,
        category: MemoryCategory,
        workflow_id: uuid.UUID | None = None,
        limit: int = 20,
    ) -> list[Memory]:
        conditions = [AgentMemoryModel.agent_id == agent_id, AgentMemoryModel.category == category]
        if workflow_id is not None:
            conditions.append(AgentMemoryModel.workflow_id == workflow_id)
        models = await self._session.scalars(
            select(AgentMemoryModel)
            .where(*conditions)
            .order_by(AgentMemoryModel.created_at.desc(), AgentMemoryModel.id)
            .limit(limit)
        )
        return [_memory(m) for m in models]

    async def list_memories(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, category: MemoryCategory | None
    ) -> list[Memory]:
        conditions = [
            AgentMemoryModel.workspace_id == workspace_id,
            AgentMemoryModel.user_id == user_id,
        ]
        if category is not None:
            conditions.append(AgentMemoryModel.category == category)
        models = await self._session.scalars(
            select(AgentMemoryModel)
            .where(*conditions)
            .order_by(AgentMemoryModel.created_at.desc(), AgentMemoryModel.id)
        )
        return [_memory(m) for m in models]

    async def get_memory(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, memory_id: uuid.UUID
    ) -> Memory | None:
        model = await self._session.scalar(
            select(AgentMemoryModel).where(
                AgentMemoryModel.id == memory_id,
                AgentMemoryModel.workspace_id == workspace_id,
                AgentMemoryModel.user_id == user_id,
            )
        )
        return _memory(model) if model else None

    async def add_memory(self, memory: Memory) -> None:
        self._session.add(
            AgentMemoryModel(
                id=memory.id,
                workspace_id=memory.workspace_id,
                user_id=memory.user_id,
                agent_id=memory.agent_id,
                category=memory.category,
                workflow_id=memory.workflow_id,
                content=memory.content[:500],
                source=memory.source,
                created_at=memory.created_at,
                updated_at=memory.updated_at,
            )
        )
        await flush(self._session)

    async def save_memory(self, memory: Memory) -> None:
        await self._session.execute(
            update(AgentMemoryModel)
            .where(AgentMemoryModel.id == memory.id, AgentMemoryModel.user_id == memory.user_id)
            .values(content=memory.content[:500], updated_at=memory.updated_at)
            .execution_options(synchronize_session=False)
        )

    async def delete_memory(self, memory: Memory) -> None:
        await self._session.execute(
            delete(AgentMemoryModel).where(
                AgentMemoryModel.id == memory.id, AgentMemoryModel.user_id == memory.user_id
            )
        )

    async def trim_workflow_memory(self, workflow_id: uuid.UUID, keep: int) -> None:
        stale = list(
            await self._session.scalars(
                select(AgentMemoryModel.id)
                .where(
                    AgentMemoryModel.workflow_id == workflow_id,
                    AgentMemoryModel.category == "workflow",
                )
                .order_by(AgentMemoryModel.created_at.desc(), AgentMemoryModel.id)
                .offset(keep)
            )
        )
        if stale:
            await self._session.execute(
                delete(AgentMemoryModel).where(AgentMemoryModel.id.in_(stale))
            )

    # Monitoring and retention

    async def alerted(self, agent_id: uuid.UUID, keys: list[str]) -> set[str]:
        if not keys:
            return set()
        rows = await self._session.scalars(
            select(AgentMonitorAlertModel.key).where(
                AgentMonitorAlertModel.agent_id == agent_id,
                AgentMonitorAlertModel.key.in_([k[:300] for k in keys]),
            )
        )
        return set(rows)

    async def add_alert(self, agent: Agent, key: str, category: str, now: datetime) -> None:
        self._session.add(
            AgentMonitorAlertModel(
                id=uuid.uuid4(),
                workspace_id=agent.workspace_id,
                agent_id=agent.id,
                key=key[:300],
                category=category,
                created_at=now,
            )
        )
        await flush(self._session)

    async def purge(self, now: datetime) -> int:
        """Delete finished executions and workflow memory older than each agent's retention,
        and monitoring alerts older than a year (their dates have long passed)."""
        removed = 0
        agents = await self._session.scalars(select(AgentModel))
        for model in list(agents):
            cutoff = now - timedelta(days=_memory_settings(_dict(model.memory)).retention_days)
            result = await self._session.execute(
                delete(_E).where(
                    _E.agent_id == model.id, _E.finished_at.is_not(None), _E.finished_at < cutoff
                )
            )
            removed += _rowcount(result)
            await self._session.execute(
                delete(AgentMemoryModel).where(
                    AgentMemoryModel.agent_id == model.id,
                    AgentMemoryModel.category == "workflow",
                    AgentMemoryModel.created_at < cutoff,
                )
            )
        await self._session.execute(
            delete(AgentMonitorAlertModel).where(
                AgentMonitorAlertModel.created_at < now - timedelta(days=365)
            )
        )
        return removed


class SqlChangeFeed:
    """Recent changes read from the modules' own tables (like universal search does), always
    filtered by workspace, newest last, bounded."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def tasks_created(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]:
        rows = await self._session.execute(
            select(TaskModel.id, TaskModel.title, TaskModel.due_date, TaskModel.created_at)
            .where(
                TaskModel.workspace_id == workspace_id,
                TaskModel.created_at > since,
                TaskModel.created_at <= until,
            )
            .order_by(TaskModel.created_at, TaskModel.id)
            .limit(limit)
        )
        return [
            Signal(
                key=str(task_id),
                data={"id": str(task_id), "title": title, "due_date": str(due) if due else None},
            )
            for task_id, title, due, _ in rows.all()
        ]

    async def tasks_completed(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]:
        rows = await self._session.execute(
            select(TaskModel.id, TaskModel.title, TaskModel.completed_at)
            .where(
                TaskModel.workspace_id == workspace_id,
                TaskModel.status == "completed",
                TaskModel.completed_at > since,
                TaskModel.completed_at <= until,
            )
            .order_by(TaskModel.completed_at, TaskModel.id)
            .limit(limit)
        )
        return [
            Signal(
                key=f"{task_id}:{completed.isoformat() if completed else ''}",
                data={"id": str(task_id), "title": title},
            )
            for task_id, title, completed in rows.all()
        ]

    async def reminders_delivered(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        since: datetime,
        until: datetime,
        limit: int,
    ) -> list[Signal]:
        rows = await self._session.execute(
            select(NotificationModel.id, NotificationModel.reminder_id, NotificationModel.title)
            .where(
                NotificationModel.workspace_id == workspace_id,
                NotificationModel.user_id == user_id,
                NotificationModel.occurrence_id.is_not(None),
                NotificationModel.created_at > since,
                NotificationModel.created_at <= until,
            )
            .order_by(NotificationModel.created_at, NotificationModel.id)
            .limit(limit)
        )
        return [
            Signal(
                key=str(notification_id),
                data={"id": str(reminder_id) if reminder_id else None, "title": title},
            )
            for notification_id, reminder_id, title in rows.all()
        ]

    async def budget_alerts(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]:
        rows = await self._session.execute(
            select(
                FinanceBudgetAlertModel.id,
                FinanceBudgetAlertModel.threshold,
                FinanceBudgetModel.id,
                FinanceBudgetModel.name,
            )
            .join(
                FinanceBudgetPeriodModel,
                FinanceBudgetPeriodModel.id == FinanceBudgetAlertModel.period_id,
            )
            .join(FinanceBudgetModel, FinanceBudgetModel.id == FinanceBudgetPeriodModel.budget_id)
            .where(
                FinanceBudgetAlertModel.workspace_id == workspace_id,
                FinanceBudgetAlertModel.created_at > since,
                FinanceBudgetAlertModel.created_at <= until,
            )
            .order_by(FinanceBudgetAlertModel.created_at, FinanceBudgetAlertModel.id)
            .limit(limit)
        )
        return [
            Signal(
                key=str(alert_id),
                data={"id": str(budget_id), "title": name, "threshold": threshold},
            )
            for alert_id, threshold, budget_id, name in rows.all()
        ]

    async def external_events_changed(
        self, workspace_id: uuid.UUID, since: datetime, until: datetime, limit: int
    ) -> list[Signal]:
        rows = await self._session.execute(
            select(
                IntegrationLinkModel.id,
                IntegrationLinkModel.entity_id,
                IntegrationLinkModel.title,
                IntegrationLinkModel.updated_at,
            )
            .where(
                IntegrationLinkModel.workspace_id == workspace_id,
                IntegrationLinkModel.entity_type == "event",
                IntegrationLinkModel.updated_at > since,
                IntegrationLinkModel.updated_at <= until,
            )
            .order_by(IntegrationLinkModel.updated_at, IntegrationLinkModel.id)
            .limit(limit)
        )
        return [
            Signal(
                key=f"{link_id}:{changed.isoformat()}",
                data={"id": str(entity_id), "title": title},
            )
            for link_id, entity_id, title, changed in rows.all()
        ]

    async def unread_notifications(self, user_id: uuid.UUID) -> int:
        count = await self._session.scalar(
            select(func.count()).where(
                NotificationModel.user_id == user_id, NotificationModel.read_at.is_(None)
            )
        )
        return count or 0


class AiModelGateway:
    """The AI layer's settings and providers, with all of its policy, as the engine's models."""

    def __init__(self, config: AiConfigService) -> None:
        self._config = config

    async def ai_modules(self, user_id: uuid.UUID) -> frozenset[AiModule]:
        if not self._config.server_enabled:
            return frozenset()
        settings = await self._config.settings(user_id)
        return settings.modules if settings.enabled else frozenset()

    async def provider(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, model: str | None
    ) -> ResolvedProvider:
        settings = await self._config.require_enabled(user_id)
        await self._config.usage.check_limit(user_id, settings.monthly_token_limit)
        provider = await self._config.chat_provider(settings, workspace_id, "assist")
        if model:
            provider = replace(provider, model=model)
        return provider
