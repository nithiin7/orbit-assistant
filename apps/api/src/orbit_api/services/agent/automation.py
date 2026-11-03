"""The agent's background work, run by the existing worker (there is no second scheduler).

Each job keeps its state in the database and claims its work with conditional updates, so a
restart loses nothing and several workers (the one embedded in each API process, plus any
`orbit-worker`) never do the same work twice:

- **Schedules:** a workflow's `next_run_at` is claimed by moving it forward from the value read;
  the worker that wins creates the execution. Runs missed while nothing was running catch up
  once (the latest slot), not once per missed slot.
- **Event and condition checks:** a workflow is claimed by moving `checked_at` forward; signals
  become executions whose trigger keys are unique, so a signal fires at most once.
- **Executions:** claimed with a lease (`lease_until`); one whose worker died is claimed again
  when the lease ends and resumes from its last checkpoint.
- **Approvals** past their expiry are expired; **retention** deletes old history.
- **Monitoring** runs per agent at its frequency and notifies about new findings only.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Final, Literal, Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.agent.engine import ExecutionEngine, Notifier, new_execution
from orbit_api.services.agent.models import (
    Agent,
    Approval,
    Condition,
    ConditionTrigger,
    Execution,
    Finding,
    MonitorFrequency,
    Scalar,
    Workflow,
)
from orbit_api.services.agent.monitoring import Monitor
from orbit_api.services.agent.service import AgentRepository
from orbit_api.services.agent.signals import Signal, SignalReader
from orbit_api.services.agent.triggers import evaluate, next_run, trigger_module
from orbit_api.services.ai.context import Viewer
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.clock import utc_now

logger = logging.getLogger(__name__)

BATCH: Final = 20
EVENT_INTERVAL: Final = timedelta(minutes=1)
MONITOR_INTERVALS: Final[dict[MonitorFrequency, timedelta]] = {
    "hourly": timedelta(hours=1),
    "every_6_hours": timedelta(hours=6),
    "daily": timedelta(days=1),
}
# Schedule slots missed by more than this are skipped rather than run late.
CATCH_UP: Final = timedelta(days=1)
CRASH_ATTEMPTS: Final = 3


class AutomationStore(AgentRepository, Protocol):
    async def due_schedules(self, now: datetime, limit: int) -> list[Workflow]: ...

    async def claim_schedule(
        self, workflow_id: uuid.UUID, expected: datetime, following: datetime | None
    ) -> bool: ...

    async def watched_workflows(self, checked_before: datetime, limit: int) -> list[Workflow]: ...

    async def claim_check(
        self, workflow_id: uuid.UUID, previous: datetime | None, now: datetime
    ) -> bool: ...

    async def expired_approvals(self, now: datetime, limit: int) -> list[Approval]: ...

    async def execution_by_id(self, execution_id: uuid.UUID) -> Execution | None: ...

    async def monitored_agents(self, limit: int) -> list[Agent]: ...

    async def claim_monitor(
        self, agent_id: uuid.UUID, previous: datetime | None, now: datetime
    ) -> bool: ...

    async def alerted(self, agent_id: uuid.UUID, keys: list[str]) -> set[str]: ...

    async def add_alert(self, agent: Agent, key: str, category: str, now: datetime) -> None: ...

    async def purge(self, now: datetime) -> int: ...

    async def claim_executions(
        self, now: datetime, lease_until: datetime, limit: int
    ) -> list[Execution]: ...


@dataclass(frozen=True, slots=True)
class HousekeepingReport:
    scheduled: int = 0
    triggered: int = 0
    expired: int = 0
    notified: int = 0


class AutomationService:
    def __init__(
        self,
        store: AutomationStore,
        engine: ExecutionEngine,
        signals: SignalReader,
        monitor: Monitor,
        notifier: Notifier,
        transaction: Transaction,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._engine = engine
        self._signals = signals
        self._monitor = monitor
        self._notifier = notifier
        self._transaction = transaction
        self._clock = clock

    @property
    def engine(self) -> ExecutionEngine:
        return self._engine

    async def expire_approvals(self) -> int:
        expired = 0
        for approval in await self._store.expired_approvals(self._clock(), BATCH):
            execution = await self._store.execution_by_id(approval.execution_id)
            if execution is not None:
                await self._engine.expire(approval, execution)
                expired += 1
        return expired

    async def run_schedules(self) -> int:
        now = self._clock()
        started = 0
        for workflow in await self._store.due_schedules(now, BATCH):
            schedule = workflow.trigger.schedule
            due = workflow.next_run_at
            if schedule is None or due is None:
                continue
            following = next_run(schedule, now)
            if not await self._store.claim_schedule(workflow.id, due, following):
                await self._transaction.rollback()
                continue  # Another worker took it.
            late = now - due
            if late > CATCH_UP:
                logger.info("Skipped a missed run of workflow %s.", workflow.id)
                await self._transaction.commit()
                continue
            key = f"wf:{workflow.id}:schedule:{due.isoformat()}"
            data: dict[str, Scalar] = {
                "scheduled_for": due.isoformat(),
                "late": late > EVENT_INTERVAL,
            }
            if await self._start(workflow, "schedule", key, data):
                started += 1
            await self._transaction.commit()
        return started

    async def check_triggers(self) -> int:
        """Event and condition workflows due a check, each claimed so one worker checks it."""
        now = self._clock()
        started = 0
        for workflow in await self._store.watched_workflows(now - EVENT_INTERVAL, BATCH):
            if workflow.trigger.kind == "condition" and workflow.trigger.condition is not None:
                interval = timedelta(minutes=workflow.trigger.condition.check_minutes)
                if workflow.checked_at is not None and now - workflow.checked_at < interval:
                    continue
            if not await self._store.claim_check(workflow.id, workflow.checked_at, now):
                await self._transaction.rollback()
                continue
            try:
                started += await self._check(workflow, now)
                await self._transaction.commit()
            except ConflictError:
                # Another worker created the same execution first: nothing is lost, since its
                # key is the same. The cursor stays, and the next check skips what exists.
                await self._transaction.rollback()
        return started

    async def _check(self, workflow: Workflow, now: datetime) -> int:
        agent = await self._store.agent(workflow.agent_id)
        if agent is None or not agent.enabled:
            return 0
        module = trigger_module(workflow.trigger)
        if module is not None and module not in agent.modules:
            return 0
        timezone = await self._store.timezone(workflow.user_id)
        started = 0
        trigger = workflow.trigger
        if trigger.kind == "event" and trigger.event is not None:
            since = workflow.trigger_cursor or workflow.created_at
            signals = await self._signals.events(
                trigger.event,
                workspace_id=workflow.workspace_id,
                user_id=workflow.user_id,
                timezone=timezone,
                since=since,
                now=now,
            )
            for signal in signals:
                if await self._fire(workflow, trigger.event.event, signal):
                    started += 1
            await self._store.save_workflow(replace(workflow, trigger_cursor=now, checked_at=now))
        elif trigger.kind == "condition" and trigger.condition is not None:
            value = await self._signals.metric(
                trigger.condition,
                workspace_id=workflow.workspace_id,
                user_id=workflow.user_id,
                timezone=timezone,
                now=now,
            )
            met = evaluate(_metric_condition(trigger.condition), {"metric": {"value": value}})
            if met and workflow.condition_state is not True:
                key = f"wf:{workflow.id}:condition:{now:%Y%m%dT%H%M}"
                data: dict[str, Scalar] = {"metric": trigger.condition.metric, "value": value}
                if await self._start(workflow, "condition", key, data):
                    started += 1
            await self._store.save_workflow(replace(workflow, condition_state=met, checked_at=now))
        return started

    async def _fire(self, workflow: Workflow, event: str, signal: Signal) -> bool:
        key = f"wf:{workflow.id}:{event}:{signal.key}"
        data: dict[str, Scalar] = {"event": event, **signal.data}
        return await self._start(workflow, "event", key, data)

    async def _start(
        self,
        workflow: Workflow,
        kind: Literal["schedule", "event", "condition"],
        key: str,
        data: dict[str, Scalar],
    ) -> bool:
        """Create the trigger's execution unless it exists, the workflow's conditions aren't
        met, or a daily limit is reached."""
        agent = await self._store.agent(workflow.agent_id)
        if agent is None or not agent.enabled or not workflow.enabled:
            return False
        if await self._store.execution_by_key(agent.id, key) is not None:
            return False
        values: dict[str, object] = {"trigger": data}
        if not all(evaluate(condition, values) for condition in workflow.conditions):
            return False
        now = self._clock()
        since = now - timedelta(days=1)
        if await self._store.runs_since(agent.id, since) >= agent.limits.max_runs_per_day or (
            await self._store.runs_since(agent.id, since, workflow.id) >= workflow.max_runs_per_day
        ):
            logger.info("Workflow %s reached a daily run limit.", workflow.id)
            return False
        execution = new_execution(
            agent,
            trigger_kind=kind,
            trigger_key=key,
            now=now,
            workflow=workflow,
            trigger_data=data,
        )
        await self._store.add_execution(execution)
        await self._store.save_workflow(replace(workflow, last_run_at=now))
        return True

    async def monitor(self) -> int:
        """Run monitoring for agents that are due; return how many notifications were sent."""
        now = self._clock()
        sent = 0
        for agent in await self._store.monitored_agents(BATCH):
            interval = MONITOR_INTERVALS[agent.monitoring.frequency]
            if agent.monitored_at is not None and now - agent.monitored_at < interval:
                continue
            if not await self._store.claim_monitor(agent.id, agent.monitored_at, now):
                await self._transaction.rollback()
                continue
            timezone = await self._store.timezone(agent.user_id)
            local = now.astimezone(ZoneInfo(timezone))
            viewer = Viewer(
                workspace_id=agent.workspace_id,
                user_id=agent.user_id,
                today=local.date(),
                timezone=timezone,
                now=local,
            )
            findings = await self._monitor.findings(agent, viewer)
            for finding in findings:
                if await self._notify(agent, finding, now):
                    sent += 1
            await self._transaction.commit()
        return sent

    async def _notify(self, agent: Agent, finding: Finding, now: datetime) -> bool:
        keys = [item.key for item in finding.items]
        seen = await self._store.alerted(agent.id, keys)
        new = [item for item in finding.items if item.key not in seen]
        if not new:
            return False
        for item in new:
            await self._store.add_alert(agent, item.key, finding.category, now)
        if not agent.notifications.insights:
            return False
        body = "\n".join(f"• {item.label}" for item in new[:10])
        await self._notifier.notify(agent.user_id, agent.workspace_id, finding.title, body)
        return True

    async def purge(self) -> int:
        removed = await self._store.purge(self._clock())
        await self._transaction.commit()
        return removed

    async def claim(self, lease: timedelta, limit: int = 5) -> list[Execution]:
        now = self._clock()
        claims = await self._store.claim_executions(now, now + lease, limit)
        await self._transaction.commit()
        return claims

    async def record_crash(self, execution_id: uuid.UUID, error: str) -> None:
        """An unexpected error stopped an execution mid-step: retry it from its checkpoint
        after a pause, or fail it after a few crashes. Only the error's type is kept."""
        execution = await self._store.execution_by_id(execution_id)
        if execution is None or execution.status != "running":
            return
        crashes = execution.state.get("crashes")
        count = (crashes if isinstance(crashes, int) else 0) + 1
        if count >= CRASH_ATTEMPTS:
            await self._engine.finish(
                execution, "failed", error="An unexpected error stopped this run."
            )
            return
        now = self._clock()
        await self._store.save_execution(
            replace(
                execution,
                status="queued",
                state={**execution.state, "crashes": count, "last_crash": error[:100]},
                lease_until=None,
                resume_at=now + timedelta(minutes=count),
                updated_at=now,
            )
        )
        await self._transaction.commit()


def _metric_condition(trigger: ConditionTrigger) -> Condition:
    return Condition(left="metric.value", op=trigger.op, right=trigger.value)
