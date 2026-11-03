"""The permission and autonomy model, decided in code for every single tool call.

Inputs are the agent's configuration (which only its owner changes, through the API), the
tool's spec, and what started the execution. Nothing a model writes, and nothing in a record it
read, is an input: a model can't grant itself a permission, because there is no permission it
can reach.

| Level         | Reads | Writes                                                          |
| ------------- | ----- | --------------------------------------------------------------- |
| `read_only`   | yes   | refused                                                         |
| `suggest`     | yes   | recorded as a suggestion; never run                             |
| `approval`    | yes   | run after the person approves that exact call                   |
| `limited`     | yes   | low-risk tools set to `auto`, from allowed triggers, within the |
|               |       | daily quota, run on their own; everything else asks             |

High-risk and `always_confirm` tools ask at every level that can write.
"""

from dataclasses import dataclass
from typing import Literal

from orbit_api.services.agent.models import Agent, TriggerKind
from orbit_api.services.agent.tools import ToolSpec
from orbit_api.services.ai.models import AiModule

Outcome = Literal["allow", "approval", "suggest", "deny"]


@dataclass(frozen=True, slots=True)
class Decision:
    outcome: Outcome
    # Safe to show, and to give back to the planner.
    reason: str


def decide(
    agent: Agent,
    spec: ToolSpec,
    *,
    trigger: TriggerKind,
    ai_modules: frozenset[AiModule],
    model_reads: bool,
    autonomous_today: int,
) -> Decision:
    """`ai_modules` is what the AI layer may read (empty when AI is off); `model_reads` says
    whether a model will see the result (agent runs). Tools that summarize always need it."""
    if not agent.enabled:
        return Decision("deny", "The agent is turned off.")
    mode = agent.tool_modes.get(spec.name)
    if mode == "off":
        return Decision("deny", f"{spec.title} is turned off for the agent.")
    if spec.module is not None and spec.module not in agent.modules:
        return Decision("deny", f"The agent isn't allowed to use {spec.module}.")
    if (model_reads or spec.uses_ai) and not _ai_may_read(spec, ai_modules):
        return Decision(
            "deny", f"AI isn't allowed to read {spec.module}. Change it in Settings → AI."
        )
    if spec.access == "read":
        return Decision("allow", "Reading is allowed.")
    if spec.access not in agent.action_types:
        return Decision("deny", f"The agent isn't allowed to {spec.access} records.")
    match agent.autonomy:
        case "read_only":
            return Decision("deny", "The agent is read only.")
        case "suggest":
            return Decision("suggest", "The agent only suggests actions.")
        case "approval":
            return Decision("approval", "Actions need your approval.")
        case "limited":
            pass
    if spec.always_confirm or spec.risk == "high":
        return Decision("approval", "This action always needs your approval.")
    if mode != "auto":
        return Decision("approval", "This action needs your approval.")
    if spec.risk != "low":
        return Decision("approval", "Only low-risk actions run without approval.")
    if trigger not in agent.autonomous_triggers:
        return Decision("approval", "Actions from this kind of trigger need your approval.")
    if autonomous_today >= agent.limits.max_autonomous_actions_per_day:
        return Decision("approval", "Today's limit of automatic actions has been reached.")
    return Decision("allow", "Allowed to run automatically.")


def _ai_may_read(spec: ToolSpec, ai_modules: frozenset[AiModule]) -> bool:
    if spec.module is None or spec.module == "mail":
        # Mail has no AI-layer permission of its own; the agent's `mail` permission covers it,
        # and its text is only given to a model as untrusted data. Memory and workflows are
        # the agent's own records.
        return True
    return spec.module in ai_modules
