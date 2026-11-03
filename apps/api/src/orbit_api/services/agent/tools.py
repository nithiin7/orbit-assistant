"""The tool registry: Orbit's functionality as typed, permission-checked tools.

A tool is a `ToolSpec` (what it is: name, input schema, module, access, risk, approval and
idempotency behavior) and a `ToolHandler` (how it runs, through the module's own service). The
concrete tools are registered in `orbit_api.api.agent_tools`, where the modules' request schemas
live; this file holds only the contract.

Every call goes through `prepare` before it runs: the arguments are validated by the tool's own
schema (never trusted because a model produced them), and the target record is looked up, so an
approval can show what will change. A call is prepared again just before it runs, so a changed
or deleted record is caught then too.
"""

import hashlib
import json
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final, Protocol

from orbit_api.services.agent.models import AgentModule, RiskLevel, Scalar, ToolAccess
from orbit_api.services.ai.models import ActionResult, RecordRef

# What every tool returns: text for the person and the planner, the records it touched, and
# structured values that workflow conditions can test (every tool sets `count`).
OUTPUT_SCHEMA: Final[dict[str, object]] = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "records": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string"},
                    "id": {"type": ["string", "null"]},
                    "title": {"type": "string"},
                },
            },
        },
        "data": {"type": "object", "properties": {"count": {"type": "integer"}}},
    },
    "required": ["text", "records", "data"],
}


@dataclass(frozen=True, slots=True)
class ToolContext:
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    timezone: str
    today: date
    now: datetime
    execution_id: uuid.UUID | None = None
    # Workflows can't start workflows; only an agent run can, one level deep.
    from_workflow: bool = False


@dataclass(frozen=True, slots=True)
class PreparedCall:
    """A validated call: normalized arguments, a one-line summary, what it touches, and what it
    will do."""

    tool: str
    arguments: dict[str, object]
    summary: str
    target: RecordRef | None = None
    effect: str = ""

    @property
    def fingerprint(self) -> str:
        return call_hash(self.tool, self.arguments)


@dataclass(frozen=True, slots=True)
class ToolOutput:
    text: str
    records: tuple[RecordRef, ...] = ()
    data: dict[str, Scalar] = field(default_factory=dict[str, Scalar])
    # The record a write created or changed.
    result: ActionResult | None = None


class ToolHandler(Protocol):
    async def prepare(self, arguments: dict[str, object], context: ToolContext) -> PreparedCall:
        """Validate and normalize; raise `InvalidToolCallError` with a safe message."""
        ...

    async def run(self, call: PreparedCall, context: ToolContext) -> ToolOutput:
        """Run through the module's service; raise `ToolFailedError` with a safe message.
        Writes only flush: the engine commits them together with the step that records
        them, so a write happens exactly once."""
        ...


@dataclass(frozen=True, slots=True)
class ToolSpec:
    name: str
    title: str
    description: str
    # The module whose permission the tool needs; `None` for the agent's own records (memory,
    # workflows), which need no module permission.
    module: AgentModule | None
    access: ToolAccess
    risk: RiskLevel
    # Safe to run again with the same arguments (reads are; creating a task isn't).
    idempotent: bool
    # Always asks, whatever the autonomy level (saving a memory, starting a workflow).
    always_confirm: bool
    input_schema: dict[str, object]
    # Sends record content to the AI provider (summaries): needs the AI layer's permission.
    uses_ai: bool = False
    # Available to workflows' tool steps (some exist only for agent runs).
    in_workflows: bool = True
    output_schema: dict[str, object] = field(default_factory=lambda: OUTPUT_SCHEMA)

    @property
    def approval(self) -> str:
        """How approval works for this tool, for display."""
        if self.access == "read":
            return "never"
        if self.always_confirm or self.risk == "high":
            return "always"
        return "configurable"


@dataclass(frozen=True, slots=True)
class MailHit:
    subject: str
    sender: str
    received: date
    snippet: str


class MailReader(Protocol):
    async def search(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, query: str, limit: int
    ) -> list[MailHit]:
        """Messages in the labels the person chose for Orbit. Raises `ToolFailedError` when
        no mailbox is connected or the provider fails."""
        ...


@dataclass(frozen=True, slots=True)
class Tool:
    spec: ToolSpec
    handler: ToolHandler


class ToolRegistry:
    def __init__(self, tools: Iterable[Tool]) -> None:
        self._tools: dict[str, Tool] = {}
        for tool in tools:
            if tool.spec.name in self._tools:
                raise ValueError(f"Tool {tool.spec.name!r} is registered twice.")
            self._tools[tool.spec.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def specs(self) -> list[ToolSpec]:
        return [tool.spec for tool in self._tools.values()]

    def names(self) -> list[str]:
        return list(self._tools)


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def call_hash(tool: str, arguments: dict[str, object]) -> str:
    """Fingerprint of an exact call: the same tool with the same normalized arguments."""
    return hashlib.sha256(
        canonical_json({"tool": tool, "arguments": arguments}).encode()
    ).hexdigest()


def specs_named(registry: ToolRegistry, names: Sequence[str]) -> list[ToolSpec]:
    return [tool.spec for name in names if (tool := registry.get(name)) is not None]
