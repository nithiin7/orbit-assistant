"""Action proposals: things the AI suggests creating or changing, run only with approval.

1. The AI produces a structured proposal (a kind and a payload).
2. The kind must be on the allowlist, and the payload is validated by the target module's own
   request schema (`ActionValidator`), before anything is stored.
3. The person sees a preview and approves or rejects it.
4. Approval claims the proposal with a conditional update (`pending` → `executing`), so a
   double click or a second tab can't run it twice; the module's own service then does the work
   (`ActionExecutor`), and the result is recorded.

There is no generic "run this query" or "update this row" action, and nothing runs on its own.
"""

import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Protocol

from orbit_api.services.ai.models import (
    ACTION_KINDS,
    ActionKind,
    ActionResult,
    InvalidActionError,
    Proposal,
    ProposalNotFoundError,
    ProposalNotPendingError,
    ProposalStatus,
)
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

MAX_PROPOSALS_PER_ANSWER = 3


class ActionValidator(Protocol):
    def validate(
        self, kind: ActionKind, payload: dict[str, object], timezone: str
    ) -> tuple[dict[str, object], str]:
        """The normalized payload and a one-line summary, or `InvalidActionError`."""
        ...


class ActionExecutor(Protocol):
    async def execute(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        kind: ActionKind,
        payload: dict[str, object],
        timezone: str | None,
    ) -> ActionResult:
        """Run the action through the module's own service. Raises `InvalidActionError` with
        a safe message when the module refuses it."""
        ...


class ProposalRepository(Protocol):
    async def add(self, proposal: Proposal) -> None: ...

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal | None: ...

    async def for_messages(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, message_ids: Sequence[uuid.UUID]
    ) -> list[Proposal]: ...

    async def transition(
        self,
        proposal_id: uuid.UUID,
        expected: ProposalStatus,
        status: ProposalStatus,
        now: datetime,
    ) -> bool:
        """Move the proposal from `expected` to `status`; `False` if it wasn't in `expected`."""
        ...

    async def finish(
        self,
        proposal_id: uuid.UUID,
        status: ProposalStatus,
        result: ActionResult | None,
        error: str | None,
    ) -> None: ...


def as_kind(value: str) -> ActionKind | None:
    return next((kind for kind in ACTION_KINDS if kind == value), None)


class ProposalService:
    def __init__(
        self,
        repository: ProposalRepository,
        validator: ActionValidator,
        executor: ActionExecutor,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._repository = repository
        self._validator = validator
        self._executor = executor
        self._transaction = transaction
        self._clock = clock

    def check(
        self, raw: Sequence[tuple[str, dict[str, object]]], timezone: str
    ) -> list[tuple[ActionKind, dict[str, object], str]]:
        """The valid proposals among the model's raw ones, at most `MAX_PROPOSALS_PER_ANSWER`.
        Unknown kinds and invalid payloads are dropped."""
        valid: list[tuple[ActionKind, dict[str, object], str]] = []
        for name, payload in raw:
            kind = as_kind(name)
            if kind is None:
                continue
            try:
                normalized, summary = self._validator.validate(kind, payload, timezone)
            except InvalidActionError:
                continue
            valid.append((kind, normalized, summary))
            if len(valid) >= MAX_PROPOSALS_PER_ANSWER:
                break
        return valid

    async def propose(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        proposals: Sequence[tuple[ActionKind, dict[str, object], str]],
        *,
        conversation_id: uuid.UUID | None = None,
        message_id: uuid.UUID | None = None,
        from_untrusted_context: bool = False,
        commit: bool = True,
    ) -> list[Proposal]:
        now = self._clock()
        stored: list[Proposal] = []
        for kind, payload, summary in proposals:
            proposal = Proposal(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                user_id=user_id,
                conversation_id=conversation_id,
                message_id=message_id,
                kind=kind,
                payload=payload,
                summary=summary[:300],
                status="pending",
                from_untrusted_context=from_untrusted_context,
                result_kind=None,
                result_id=None,
                error=None,
                created_at=now,
                decided_at=None,
            )
            await self._repository.add(proposal)
            stored.append(proposal)
        if commit:
            await self._transaction.commit()
        return stored

    async def for_messages(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, message_ids: Sequence[uuid.UUID]
    ) -> list[Proposal]:
        return await self._repository.for_messages(workspace_id, user_id, message_ids)

    async def approve(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        proposal_id: uuid.UUID,
        timezone: str | None,
    ) -> Proposal:
        proposal = await self._get(workspace_id, user_id, proposal_id)
        if not await self._repository.transition(
            proposal.id, "pending", "executing", self._clock()
        ):
            raise ProposalNotPendingError
        await self._transaction.commit()
        try:
            # Validated again: the rules may have changed since it was proposed.
            payload, _ = self._validator.validate(
                proposal.kind, proposal.payload, timezone or "UTC"
            )
            result = await self._executor.execute(
                workspace_id, user_id, proposal.kind, payload, timezone
            )
        except InvalidActionError as exc:
            await self._transaction.rollback()
            await self._repository.finish(proposal.id, "failed", None, str(exc)[:300])
            await self._transaction.commit()
        else:
            await self._repository.finish(proposal.id, "executed", result, None)
            await self._transaction.commit()
        return await self._get(workspace_id, user_id, proposal_id)

    async def reject(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal:
        proposal = await self._get(workspace_id, user_id, proposal_id)
        if not await self._repository.transition(proposal.id, "pending", "rejected", self._clock()):
            raise ProposalNotPendingError
        await self._transaction.commit()
        return await self._get(workspace_id, user_id, proposal_id)

    async def _get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal:
        proposal = await self._repository.get(workspace_id, user_id, proposal_id)
        if proposal is None:
            raise ProposalNotFoundError
        return proposal
