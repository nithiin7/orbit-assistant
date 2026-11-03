"""What the person does with their agent: configure it, manage workflows, start runs, review
history, decide approvals, and curate memory. Every call is scoped to the signed-in person in
an authorized workspace; IDs from requests only find rows inside that scope.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Protocol

from orbit_api.services.agent.engine import AgentStore, ExecutionEngine, ModelGateway, new_execution
from orbit_api.services.agent.models import (
    DEFAULT_ACTION_TYPES,
    DEFAULT_AGENT_MODULES,
    DEFAULT_AUTONOMOUS_TRIGGERS,
    FINISHED,
    Agent,
    AgentDisabledError,
    AgentLimits,
    AgentModule,
    Approval,
    ApprovalChangedError,
    ApprovalExpiredError,
    ApprovalNotFoundError,
    ApprovalNotPendingError,
    ApprovalStatus,
    AutonomyLevel,
    Execution,
    ExecutionFinishedError,
    ExecutionNotFoundError,
    ExecutionNotRetryableError,
    ExecutionQuery,
    ExecutionStep,
    InvalidWorkflowError,
    Memory,
    MemoryCategory,
    MemoryNotFoundError,
    MemorySettings,
    MonitorSettings,
    NotificationSettings,
    RunLimitReachedError,
    ToolAccess,
    ToolMode,
    TriggerKind,
    Workflow,
    WorkflowDraft,
    WorkflowNotFoundError,
)
from orbit_api.services.agent.policy import Decision, decide
from orbit_api.services.agent.safety import redact_text
from orbit_api.services.agent.tools import ToolSpec
from orbit_api.services.agent.triggers import next_run, trigger_module, validate_draft
from orbit_api.services.transactions import Transaction
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.clock import utc_now

MAX_WORKFLOWS = 50
MAX_MEMORIES = 100


class AgentRepository(AgentStore, Protocol):
    async def primary(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Agent | None: ...

    async def add_agent(self, agent: Agent) -> None: ...

    async def save_agent(self, agent: Agent) -> None: ...

    async def workflows(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[Workflow]: ...

    async def get_workflow(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, workflow_id: uuid.UUID
    ) -> Workflow | None: ...

    async def add_workflow(self, workflow: Workflow) -> None: ...

    async def save_workflow(self, workflow: Workflow) -> None: ...

    async def delete_workflow(self, workflow: Workflow) -> None: ...

    async def executions(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, query: ExecutionQuery
    ) -> list[Execution]: ...

    async def get_execution(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, execution_id: uuid.UUID
    ) -> Execution | None: ...

    async def add_execution(self, execution: Execution) -> None: ...

    async def execution_by_key(self, agent_id: uuid.UUID, trigger_key: str) -> Execution | None: ...

    async def runs_since(
        self, agent_id: uuid.UUID, since: datetime, workflow_id: uuid.UUID | None = None
    ) -> int: ...

    async def request_cancel(self, execution_id: uuid.UUID) -> None: ...

    async def steps(self, execution_id: uuid.UUID) -> list[ExecutionStep]: ...

    async def approvals(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        statuses: frozenset[ApprovalStatus],
        limit: int,
    ) -> list[Approval]: ...

    async def get_approval(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> Approval | None: ...

    async def pending_count(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> int: ...

    async def list_memories(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, category: MemoryCategory | None
    ) -> list[Memory]: ...

    async def get_memory(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, memory_id: uuid.UUID
    ) -> Memory | None: ...

    async def save_memory(self, memory: Memory) -> None: ...

    async def delete_memory(self, memory: Memory) -> None: ...


@dataclass(frozen=True, slots=True)
class AgentChanges:
    name: Change[str] = UNSET
    description: Change[str] = UNSET
    enabled: Change[bool] = UNSET
    instructions: Change[str] = UNSET
    chat_model: Change[str | None] = UNSET
    autonomy: Change[AutonomyLevel] = UNSET
    modules: Change[frozenset[AgentModule]] = UNSET
    tool_modes: Change[dict[str, ToolMode]] = UNSET
    action_types: Change[frozenset[ToolAccess]] = UNSET
    autonomous_triggers: Change[frozenset[TriggerKind]] = UNSET
    limits: Change[AgentLimits] = UNSET
    memory: Change[MemorySettings] = UNSET
    notifications: Change[NotificationSettings] = UNSET
    monitoring: Change[MonitorSettings] = UNSET


@dataclass(frozen=True, slots=True)
class ToolView:
    spec: ToolSpec
    # What would happen if the agent called it now from a manual run, with its settings.
    decision: Decision


@dataclass(frozen=True, slots=True)
class Overview:
    agent: Agent
    pending_approvals: int
    workflows: int
    enabled_workflows: int
    recent: list[Execution]


class AgentService:
    def __init__(
        self,
        repository: AgentRepository,
        engine: ExecutionEngine,
        models: ModelGateway,
        transaction: Transaction,
        *,
        server_enabled: bool = True,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._repository = repository
        self._engine = engine
        self._models = models
        self._transaction = transaction
        self._server_enabled = server_enabled
        self._clock = clock

    @property
    def server_enabled(self) -> bool:
        return self._server_enabled

    # The agent

    async def agent(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Agent:
        """The person's primary agent here, created (off) the first time it is asked for."""
        agent = await self._repository.primary(workspace_id, user_id)
        if agent is not None:
            return agent
        now = self._clock()
        agent = Agent(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            user_id=user_id,
            name="Orbit agent",
            description="Your personal assistant for automations.",
            enabled=False,
            instructions="",
            chat_model=None,
            autonomy="approval",
            modules=DEFAULT_AGENT_MODULES,
            tool_modes={},
            action_types=DEFAULT_ACTION_TYPES,
            autonomous_triggers=DEFAULT_AUTONOMOUS_TRIGGERS,
            limits=AgentLimits(),
            memory=MemorySettings(),
            notifications=NotificationSettings(),
            monitoring=MonitorSettings(),
            monitored_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._repository.add_agent(agent)
        await self._transaction.commit()
        return agent

    async def overview(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Overview:
        agent = await self.agent(workspace_id, user_id)
        workflows = await self._repository.workflows(workspace_id, user_id)
        return Overview(
            agent=agent,
            pending_approvals=await self._repository.pending_count(workspace_id, user_id),
            workflows=len(workflows),
            enabled_workflows=sum(1 for w in workflows if w.enabled),
            recent=await self._repository.executions(
                workspace_id, user_id, ExecutionQuery(limit=5)
            ),
        )

    async def update(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, changes: AgentChanges
    ) -> Agent:
        agent = await self.agent(workspace_id, user_id)
        if changes.enabled is True and not self._server_enabled:
            raise AgentDisabledError
        if changes.tool_modes is not UNSET:
            known = set(self._engine.registry.names())
            unknown = sorted(set(changes.tool_modes) - known)
            if unknown:
                raise InvalidWorkflowError(f"Unknown tool: {unknown[0]}.")
        updated = replace(
            agent,
            name=_pick(changes.name, agent.name),
            description=_pick(changes.description, agent.description),
            enabled=_pick(changes.enabled, agent.enabled),
            instructions=_pick(changes.instructions, agent.instructions),
            chat_model=_pick(changes.chat_model, agent.chat_model),
            autonomy=_pick(changes.autonomy, agent.autonomy),
            modules=_pick(changes.modules, agent.modules),
            tool_modes=_pick(changes.tool_modes, agent.tool_modes),
            action_types=_pick(changes.action_types, agent.action_types),
            autonomous_triggers=_pick(changes.autonomous_triggers, agent.autonomous_triggers),
            limits=_pick(changes.limits, agent.limits),
            memory=_pick(changes.memory, agent.memory),
            notifications=_pick(changes.notifications, agent.notifications),
            monitoring=_pick(changes.monitoring, agent.monitoring),
        )
        if updated != agent:
            updated = replace(updated, updated_at=self._clock())
            await self._repository.save_agent(updated)
            await self._transaction.commit()
        return updated

    async def tools(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[ToolView]:
        agent = await self.agent(workspace_id, user_id)
        ai_modules = await self._models.ai_modules(user_id)
        return [
            ToolView(
                spec=spec,
                decision=decide(
                    agent,
                    spec,
                    trigger="manual",
                    ai_modules=ai_modules,
                    model_reads=True,
                    autonomous_today=0,
                ),
            )
            for spec in self._engine.registry.specs()
        ]

    # Workflows

    async def workflows(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> list[Workflow]:
        return await self._repository.workflows(workspace_id, user_id)

    async def workflow(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, workflow_id: uuid.UUID
    ) -> Workflow:
        workflow = await self._repository.get_workflow(workspace_id, user_id, workflow_id)
        if workflow is None:
            raise WorkflowNotFoundError
        return workflow

    async def create_workflow(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, draft: WorkflowDraft
    ) -> Workflow:
        agent = await self.agent(workspace_id, user_id)
        self._validate(agent, draft)
        if len(await self._repository.workflows(workspace_id, user_id)) >= MAX_WORKFLOWS:
            raise InvalidWorkflowError(f"You can have up to {MAX_WORKFLOWS} workflows.")
        now = self._clock()
        workflow = Workflow(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            user_id=user_id,
            agent_id=agent.id,
            name=draft.name,
            description=draft.description,
            enabled=draft.enabled,
            trigger=draft.trigger,
            conditions=draft.conditions,
            steps=draft.steps,
            max_runs_per_day=draft.max_runs_per_day,
            next_run_at=_first_run(draft, now),
            # Event triggers see changes from now on, not everything that came before.
            trigger_cursor=now,
            condition_state=None,
            checked_at=None,
            last_run_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._repository.add_workflow(workflow)
        await self._transaction.commit()
        return workflow

    async def update_workflow(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        workflow_id: uuid.UUID,
        draft: WorkflowDraft,
    ) -> Workflow:
        workflow = await self.workflow(workspace_id, user_id, workflow_id)
        agent = await self.agent(workspace_id, user_id)
        self._validate(agent, draft)
        now = self._clock()
        trigger_changed = draft.trigger != workflow.trigger
        updated = replace(
            workflow,
            name=draft.name,
            description=draft.description,
            enabled=draft.enabled,
            trigger=draft.trigger,
            conditions=draft.conditions,
            steps=draft.steps,
            max_runs_per_day=draft.max_runs_per_day,
            next_run_at=_first_run(draft, now)
            if trigger_changed or (draft.enabled and not workflow.enabled)
            else workflow.next_run_at,
            trigger_cursor=now if trigger_changed else workflow.trigger_cursor,
            condition_state=None if trigger_changed else workflow.condition_state,
            updated_at=now,
        )
        await self._repository.save_workflow(updated)
        await self._transaction.commit()
        return updated

    async def set_workflow_enabled(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, workflow_id: uuid.UUID, enabled: bool
    ) -> Workflow:
        workflow = await self.workflow(workspace_id, user_id, workflow_id)
        if workflow.enabled == enabled:
            return workflow
        now = self._clock()
        updated = replace(
            workflow,
            enabled=enabled,
            next_run_at=_first_run(_draft_of(workflow), now) if enabled else workflow.next_run_at,
            # Turning a workflow back on doesn't replay what happened while it was off.
            trigger_cursor=now if enabled else workflow.trigger_cursor,
            updated_at=now,
        )
        await self._repository.save_workflow(updated)
        await self._transaction.commit()
        return updated

    async def delete_workflow(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, workflow_id: uuid.UUID
    ) -> None:
        workflow = await self.workflow(workspace_id, user_id, workflow_id)
        for execution in await self._repository.executions(
            workspace_id,
            user_id,
            ExecutionQuery(
                workflow_id=workflow.id,
                statuses=frozenset({"queued", "waiting", "waiting_approval"}),
                limit=200,
            ),
        ):
            await self._engine.finish(
                execution, "cancelled", summary="The workflow was deleted.", commit=False
            )
        await self._repository.delete_workflow(workflow)
        await self._transaction.commit()

    def _validate(self, agent: Agent, draft: WorkflowDraft) -> None:
        tools: dict[str, AgentModule | None] = {
            spec.name: spec.module for spec in self._engine.registry.specs() if spec.in_workflows
        }
        validate_draft(draft, tools=tools)
        module = trigger_module(draft.trigger)
        if module is not None and module not in agent.modules:
            raise InvalidWorkflowError(
                f"The agent isn't allowed to use {module}. Allow it in the agent's settings first."
            )

    # Runs

    async def run_workflow(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        workflow_id: uuid.UUID,
        idempotency_key: str | None = None,
        *,
        trigger: TriggerKind = "manual",
        commit: bool = True,
    ) -> Execution:
        """Queue a run of the workflow. `commit=False` when the caller commits (the
        `run_workflow` tool, inside an agent run's step)."""
        agent = await self._require_enabled(workspace_id, user_id)
        workflow = await self.workflow(workspace_id, user_id, workflow_id)
        key = f"wf:{workflow.id}:{trigger}:{idempotency_key or uuid.uuid4()}"
        existing = await self._repository.execution_by_key(agent.id, key)
        if existing is not None:
            return existing
        await self._check_limits(agent, workflow)
        execution = new_execution(
            agent, trigger_kind=trigger, trigger_key=key, now=self._clock(), workflow=workflow
        )
        await self._repository.add_execution(execution)
        await self._repository.save_workflow(replace(workflow, last_run_at=self._clock()))
        if commit:
            await self._transaction.commit()
        return execution

    async def start_run(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        goal: str,
        idempotency_key: str | None = None,
    ) -> Execution:
        """An agent run for the person's request. AI must be set up: the provider is resolved
        now (with the AI layer's checks), so a misconfiguration is an error here rather than a
        failed run later."""
        agent = await self._require_enabled(workspace_id, user_id)
        key = f"run:{idempotency_key or uuid.uuid4()}"
        existing = await self._repository.execution_by_key(agent.id, key)
        if existing is not None:
            return existing
        await self._models.provider(user_id, workspace_id, agent.chat_model)
        await self._check_limits(agent, None)
        execution = new_execution(
            agent,
            trigger_kind="manual",
            trigger_key=key,
            now=self._clock(),
            goal=redact_text(goal.strip(), 2000),
        )
        await self._repository.add_execution(execution)
        await self._transaction.commit()
        return execution

    async def _require_enabled(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Agent:
        agent = await self.agent(workspace_id, user_id)
        if not self._server_enabled or not agent.enabled:
            raise AgentDisabledError
        return agent

    async def _check_limits(self, agent: Agent, workflow: Workflow | None) -> None:
        since = self._clock() - timedelta(days=1)
        if await self._repository.runs_since(agent.id, since) >= agent.limits.max_runs_per_day:
            raise RunLimitReachedError
        if (
            workflow is not None
            and await self._repository.runs_since(agent.id, since, workflow.id)
            >= workflow.max_runs_per_day
        ):
            raise RunLimitReachedError

    # History

    async def executions(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, query: ExecutionQuery
    ) -> list[Execution]:
        return await self._repository.executions(workspace_id, user_id, query)

    async def execution(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, execution_id: uuid.UUID
    ) -> tuple[Execution, list[ExecutionStep], list[Approval]]:
        execution = await self._execution(workspace_id, user_id, execution_id)
        steps = await self._repository.steps(execution.id)
        approvals = [
            a
            for a in await self._repository.approvals(workspace_id, user_id, frozenset(), limit=500)
            if a.execution_id == execution.id
        ]
        return execution, steps, approvals

    async def cancel(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, execution_id: uuid.UUID
    ) -> Execution:
        execution = await self._execution(workspace_id, user_id, execution_id)
        if execution.status in FINISHED:
            raise ExecutionFinishedError
        await self._repository.request_cancel(execution.id)
        if execution.status == "running":
            # A worker holds it: it stops before its next step.
            await self._transaction.commit()
            return replace(execution, cancel_requested=True)
        return await self._engine.finish(execution, "cancelled", summary="Cancelled by you.")

    async def retry(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, execution_id: uuid.UUID
    ) -> Execution:
        """Resume a failed execution from the step that failed. That step's write (if any) was
        never committed, so running it again can't duplicate anything."""
        execution = await self._execution(workspace_id, user_id, execution_id)
        if execution.status != "failed":
            raise ExecutionNotRetryableError
        await self._require_enabled(workspace_id, user_id)
        now = self._clock()
        state = {k: v for k, v in execution.state.items() if k not in ("retries", "invalid")}
        retried = replace(
            execution,
            status="queued",
            error=None,
            finished_at=None,
            started_at=None,
            cursor=execution.cursor if execution.workflow_id else 0,
            tool_calls=execution.tool_calls if execution.workflow_id else 0,
            state=state,
            usage=replace(execution.usage, input_tokens=0, output_tokens=0),
            cancel_requested=False,
            updated_at=now,
        )
        await self._repository.save_execution(retried)
        await self._transaction.commit()
        return retried

    async def _execution(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, execution_id: uuid.UUID
    ) -> Execution:
        execution = await self._repository.get_execution(workspace_id, user_id, execution_id)
        if execution is None:
            raise ExecutionNotFoundError
        return execution

    # Approvals

    async def approvals(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        statuses: frozenset[ApprovalStatus],
        limit: int = 100,
    ) -> list[Approval]:
        await self._expire_overdue(workspace_id, user_id)
        return await self._repository.approvals(workspace_id, user_id, statuses, limit)

    async def approve(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        approval_id: uuid.UUID,
        arguments_hash: str,
    ) -> Approval:
        """Approve exactly the action the person reviewed: `arguments_hash` must match it."""
        approval, execution = await self._pending(workspace_id, user_id, approval_id)
        if arguments_hash != approval.arguments_hash:
            raise ApprovalChangedError
        if not self._server_enabled:
            raise AgentDisabledError
        return await self._engine.approve(approval, execution)

    async def reject(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> Approval:
        approval, execution = await self._pending(workspace_id, user_id, approval_id)
        return await self._engine.reject(approval, execution)

    async def _pending(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> tuple[Approval, Execution]:
        approval = await self._repository.get_approval(workspace_id, user_id, approval_id)
        if approval is None:
            raise ApprovalNotFoundError
        if approval.status != "pending":
            raise ApprovalNotPendingError
        execution = await self._execution(workspace_id, user_id, approval.execution_id)
        if approval.expires_at <= self._clock():
            await self._engine.expire(approval, execution)
            raise ApprovalExpiredError
        if execution.status != "waiting_approval" or execution.state.get("awaiting") != str(
            approval.id
        ):
            raise ApprovalNotPendingError
        return approval, execution

    async def _expire_overdue(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> None:
        now = self._clock()
        for approval in await self._repository.approvals(
            workspace_id, user_id, frozenset({"pending"}), limit=200
        ):
            if approval.expires_at <= now:
                execution = await self._repository.get_execution(
                    workspace_id, user_id, approval.execution_id
                )
                if execution is not None:
                    await self._engine.expire(approval, execution)

    # Memory

    async def memories(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, category: MemoryCategory | None
    ) -> list[Memory]:
        return await self._repository.list_memories(workspace_id, user_id, category)

    async def add_memory(self, workspace_id: uuid.UUID, user_id: uuid.UUID, content: str) -> Memory:
        """A preference the person writes themselves."""
        agent = await self.agent(workspace_id, user_id)
        if len(await self._repository.list_memories(workspace_id, user_id, None)) >= MAX_MEMORIES:
            raise InvalidWorkflowError(f"You can keep up to {MAX_MEMORIES} memories.")
        now = self._clock()
        memory = Memory(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            user_id=user_id,
            agent_id=agent.id,
            category="preference",
            workflow_id=None,
            content=content.strip(),
            source="user",
            created_at=now,
            updated_at=now,
        )
        await self._repository.add_memory(memory)
        await self._transaction.commit()
        return memory

    async def update_memory(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, memory_id: uuid.UUID, content: str
    ) -> Memory:
        memory = await self._memory(workspace_id, user_id, memory_id)
        updated = replace(memory, content=content.strip(), updated_at=self._clock())
        await self._repository.save_memory(updated)
        await self._transaction.commit()
        return updated

    async def delete_memory(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, memory_id: uuid.UUID
    ) -> None:
        memory = await self._memory(workspace_id, user_id, memory_id)
        await self._repository.delete_memory(memory)
        await self._transaction.commit()

    async def _memory(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, memory_id: uuid.UUID
    ) -> Memory:
        memory = await self._repository.get_memory(workspace_id, user_id, memory_id)
        if memory is None:
            raise MemoryNotFoundError
        return memory


def _first_run(draft: WorkflowDraft, now: datetime) -> datetime | None:
    schedule = draft.trigger.schedule
    if draft.trigger.kind != "schedule" or schedule is None:
        return None
    return next_run(schedule, now)


def _draft_of(workflow: Workflow) -> WorkflowDraft:
    return WorkflowDraft(
        name=workflow.name,
        description=workflow.description,
        enabled=workflow.enabled,
        trigger=workflow.trigger,
        conditions=workflow.conditions,
        steps=workflow.steps,
        max_runs_per_day=workflow.max_runs_per_day,
    )


def _pick[T](change: Change[T], current: T) -> T:
    return current if change is UNSET else change
