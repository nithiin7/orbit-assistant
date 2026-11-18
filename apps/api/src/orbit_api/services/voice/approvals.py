"""Spoken answers to pending actions: an assistant proposal or an agent approval.

A voice reply never approves on its own authority. The reply must be a clear yes
(`classify_reply`), the action must be one voice may approve (new records only, not proposed
while reading untrusted content, not medium or high risk), it must still be pending, and for
agent approvals the `arguments_hash` the person heard must match. Approval then goes through the
same service as a click, which checks permissions again and runs the action at most once.
Anything else is left for the screen.
"""

import uuid
from dataclasses import dataclass
from typing import Final, Literal, Protocol

from orbit_api.services.agent.models import Approval
from orbit_api.services.ai.models import ActionKind, Proposal
from orbit_api.services.voice.confirmation import Reply, classify_reply

# Proposal kinds a spoken yes may approve: each only creates a new record. Changing existing
# records (appending to a note, tags, document details) needs the screen.
VOICE_APPROVABLE: Final[frozenset[ActionKind]] = frozenset(
    {
        "create_task",
        "create_reminder",
        "create_event",
        "create_note",
        "add_shopping_item",
        "create_habit",
        "add_place",
        "save_link",
        "add_watch_item",
    }
)

Outcome = Literal["approved", "rejected", "unclear", "needs_screen", "not_pending"]


@dataclass(frozen=True, slots=True)
class ProposalDecision:
    outcome: Outcome
    reply: Reply
    proposal: Proposal


@dataclass(frozen=True, slots=True)
class ApprovalDecision:
    outcome: Outcome
    reply: Reply
    approval: Approval


class Proposals(Protocol):
    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal: ...

    async def approve(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        proposal_id: uuid.UUID,
        timezone: str | None,
    ) -> Proposal: ...

    async def reject(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal: ...


class Approvals(Protocol):
    async def approval(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> Approval: ...

    async def approve(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        approval_id: uuid.UUID,
        arguments_hash: str,
    ) -> Approval: ...

    async def reject(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> Approval: ...


class ProposalNotInConversationError(Exception):
    """The proposal belongs to another conversation than the one being spoken in."""


def voice_may_approve_proposal(proposal: Proposal) -> bool:
    return proposal.kind in VOICE_APPROVABLE and not proposal.from_untrusted_context


def voice_may_approve(approval: Approval) -> bool:
    return approval.risk == "low" and not approval.from_untrusted_context


async def answer_proposal(
    proposals: Proposals,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    proposal_id: uuid.UUID,
    conversation_id: uuid.UUID,
    transcript: str,
    timezone: str | None,
) -> ProposalDecision:
    proposal = await proposals.get(workspace_id, user_id, proposal_id)
    if proposal.conversation_id != conversation_id:
        raise ProposalNotInConversationError
    reply = classify_reply(transcript)
    if proposal.status != "pending":
        return ProposalDecision("not_pending", reply, proposal)
    match reply:
        case "unclear":
            return ProposalDecision("unclear", reply, proposal)
        case "reject":
            rejected = await proposals.reject(workspace_id, user_id, proposal_id)
            return ProposalDecision("rejected", reply, rejected)
        case "confirm":
            if not voice_may_approve_proposal(proposal):
                return ProposalDecision("needs_screen", reply, proposal)
            approved = await proposals.approve(workspace_id, user_id, proposal_id, timezone)
            return ProposalDecision("approved", reply, approved)


async def answer_approval(
    approvals: Approvals,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    approval_id: uuid.UUID,
    arguments_hash: str,
    transcript: str,
) -> ApprovalDecision:
    approval = await approvals.approval(workspace_id, user_id, approval_id)
    reply = classify_reply(transcript)
    if approval.status != "pending":
        return ApprovalDecision("not_pending", reply, approval)
    match reply:
        case "unclear":
            return ApprovalDecision("unclear", reply, approval)
        case "reject":
            rejected = await approvals.reject(workspace_id, user_id, approval_id)
            return ApprovalDecision("rejected", reply, rejected)
        case "confirm":
            if not voice_may_approve(approval):
                return ApprovalDecision("needs_screen", reply, approval)
            # The service checks the hash, expiry, policy, and runs it at most once.
            approved = await approvals.approve(workspace_id, user_id, approval_id, arguments_hash)
            return ApprovalDecision("approved", reply, approved)
