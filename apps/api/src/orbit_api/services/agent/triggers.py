"""Deterministic workflow logic: schedule times, conditions, argument templates, and
validation of workflow definitions. Pure Python: no model decides any of this.

- **Schedules** are wall-clock times in the workflow's time zone, so 08:00 stays 08:00 across
  daylight-saving changes. A nonexistent local time (skipped by a DST jump) runs at the first
  valid instant after it.
- **Conditions** compare a named value with a constant. Names are dotted paths into the
  execution's values (`trigger.title`, `steps.overdue.count`); there is no expression language
  and nothing is evaluated as code.
- **Templates** put values into a tool step's text arguments (`Renew {{trigger.title}}`). They
  are substituted as plain text, and the result is then validated by the tool's own schema.
"""

import calendar
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from orbit_api.services.agent.models import (
    EVENT_MODULE,
    METRIC_MODULE,
    AgentModule,
    Condition,
    InvalidWorkflowError,
    Scalar,
    Schedule,
    Trigger,
    WorkflowDraft,
    WorkflowStep,
)

MAX_STEPS: Final = 20
MAX_DELAY_MINUTES: Final = 7 * 24 * 60
MAX_TEMPLATE_VALUE: Final = 500
_STEP_ID = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_TEMPLATE = re.compile(r"\{\{\s*([a-z0-9_.]{1,80})\s*\}\}")
_PATH = re.compile(r"^(trigger|steps|workflow)(\.[a-z0-9_]{1,40}){1,3}$")


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise InvalidWorkflowError(f"Unknown time zone: {name}.") from None


# Schedules


def next_run(schedule: Schedule, after: datetime) -> datetime | None:
    """The first scheduled instant strictly after `after` (UTC), or `None` if there is none
    (a `once` schedule in the past)."""
    tz = zone(schedule.timezone)
    local = after.astimezone(tz)
    day = local.date()
    # Two years is more than any schedule needs to find its next day.
    for offset in range(0, 800):
        candidate_day = day + timedelta(days=offset)
        if not _runs_on(schedule, candidate_day):
            continue
        at = _instant(candidate_day, schedule.time, tz)
        if at > after:
            return at
    return None


def _runs_on(schedule: Schedule, day: date) -> bool:
    match schedule.frequency:
        case "daily":
            return True
        case "weekly":
            return day.weekday() in (schedule.weekdays or (0,))
        case "monthly":
            wanted = schedule.day_of_month or 1
            last = calendar.monthrange(day.year, day.month)[1]
            return day.day == min(wanted, last)
        case "once":
            return schedule.on_date == day


def _instant(day: date, at: time, tz: ZoneInfo) -> datetime:
    local = datetime.combine(day, at, tzinfo=tz)
    # A time skipped by a DST jump doesn't survive a round trip; move to the first valid one.
    round_trip = local.astimezone(UTC).astimezone(tz)
    if round_trip.replace(tzinfo=None) != local.replace(tzinfo=None):
        local = round_trip
    return local.astimezone(UTC)


# Values, conditions, and templates


def lookup(values: Mapping[str, object], path: str) -> object:
    """The value at a dotted path, or `None` when any part is missing."""
    current: object = values
    for part in path.split("."):
        if not isinstance(current, Mapping):
            return None
        mapping: Mapping[str, object] = current  # pyright: ignore[reportUnknownVariableType] - narrowed above; values are JSON
        current = mapping.get(part)
    return current


def evaluate(condition: Condition, values: Mapping[str, object]) -> bool:
    left = lookup(values, condition.left)
    right = condition.right
    match condition.op:
        case "exists":
            return left is not None and left != "" and left != []
        case "contains":
            return isinstance(left, str) and str(right or "").lower() in left.lower()
        case "not_contains":
            return not (isinstance(left, str) and str(right or "").lower() in left.lower())
        case "eq":
            return _same(left, right)
        case "ne":
            return not _same(left, right)
        case "gt" | "gte" | "lt" | "lte":
            a, b = _number(left), _number(right)
            if a is None or b is None:
                return False
            return {
                "gt": a > b,
                "gte": a >= b,
                "lt": a < b,
                "lte": a <= b,
            }[condition.op]


def _same(left: object, right: Scalar) -> bool:
    if isinstance(left, str) and isinstance(right, str):
        return left.strip().lower() == right.strip().lower()
    a, b = _number(left), _number(right)
    if a is not None and b is not None and not isinstance(left, bool):
        return a == b
    return left == right


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def render(arguments: Mapping[str, Scalar], values: Mapping[str, object]) -> dict[str, object]:
    """The step's arguments with `{{path}}` placeholders in strings replaced by values. A string
    that is only a placeholder takes the value as is (a number stays a number)."""
    rendered: dict[str, object] = {}
    for key, value in arguments.items():
        if not isinstance(value, str):
            rendered[key] = value
            continue
        whole = _TEMPLATE.fullmatch(value.strip())
        if whole is not None:
            found = lookup(values, whole.group(1))
            rendered[key] = (
                found if found is None or isinstance(found, str | int | float) else _text(found)
            )
            continue
        rendered[key] = _TEMPLATE.sub(lambda m: _text(lookup(values, m.group(1))), value)
    return rendered


def render_text(template: str, values: Mapping[str, object]) -> str:
    return _TEMPLATE.sub(lambda m: _text(lookup(values, m.group(1))), template)


def placeholders(template: str) -> list[str]:
    return _TEMPLATE.findall(template)


def _text(value: object) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    return text[:MAX_TEMPLATE_VALUE]


# Validation


def validate_draft(draft: WorkflowDraft, *, tools: Mapping[str, AgentModule | None]) -> None:
    """Raise `InvalidWorkflowError` unless the definition can run: a complete trigger, known
    tools, unique step ids, forward-only jumps, and placeholders that name earlier steps.
    `tools` maps each tool workflows may use to its module."""
    _validate_trigger(draft.trigger)
    if not draft.steps:
        raise InvalidWorkflowError("Add at least one step.")
    if len(draft.steps) > MAX_STEPS:
        raise InvalidWorkflowError(f"A workflow can have at most {MAX_STEPS} steps.")
    seen: list[str] = []
    for index, step in enumerate(draft.steps):
        if not _STEP_ID.match(step.id):
            raise InvalidWorkflowError(
                f"Step {index + 1}: ids are lowercase letters, digits, and underscores."
            )
        if step.id in seen:
            raise InvalidWorkflowError(f"Step {index + 1}: the id “{step.id}” is used twice.")
        _validate_step(index, step, tools, earlier=seen)
        seen.append(step.id)
    ids = [step.id for step in draft.steps]
    for index, step in enumerate(draft.steps):
        if step.kind == "condition" and step.on_false not in ("end", *ids[index + 1 :]):
            raise InvalidWorkflowError(
                f"Step {index + 1}: “otherwise” must go to a later step or the end."
            )
    for condition in draft.conditions:
        _validate_condition(condition, earlier=[], where="Workflow condition")


def _validate_trigger(trigger: Trigger) -> None:
    match trigger.kind:
        case "schedule":
            schedule = trigger.schedule
            if schedule is None:
                raise InvalidWorkflowError("Choose when the schedule runs.")
            zone(schedule.timezone)
            if schedule.frequency == "weekly" and not schedule.weekdays:
                raise InvalidWorkflowError("Choose at least one weekday.")
            if any(d < 0 or d > 6 for d in schedule.weekdays):
                raise InvalidWorkflowError("Weekdays are 0 (Monday) to 6 (Sunday).")
            if schedule.frequency == "monthly" and not 1 <= (schedule.day_of_month or 0) <= 31:
                raise InvalidWorkflowError("Choose a day of the month from 1 to 31.")
            if schedule.frequency == "once" and schedule.on_date is None:
                raise InvalidWorkflowError("Choose the date to run on.")
        case "event":
            if trigger.event is None:
                raise InvalidWorkflowError("Choose the event that starts the workflow.")
            if not 5 <= trigger.event.lead_minutes <= 7 * 24 * 60:
                raise InvalidWorkflowError("The lead time is 5 minutes to 7 days.")
            if not 1 <= trigger.event.days_ahead <= 365:
                raise InvalidWorkflowError("The look-ahead is 1 to 365 days.")
        case "condition":
            if trigger.condition is None:
                raise InvalidWorkflowError("Choose the condition that starts the workflow.")
            if trigger.condition.op not in ("gt", "gte", "lt", "lte", "eq", "ne"):
                raise InvalidWorkflowError("Compare the metric with a number.")
            if not 15 <= trigger.condition.check_minutes <= 24 * 60:
                raise InvalidWorkflowError("Check every 15 minutes to 24 hours.")
            if not 1 <= trigger.condition.days_ahead <= 90:
                raise InvalidWorkflowError("The look-ahead is 1 to 90 days.")
        case "manual":
            pass


def _validate_step(
    index: int,
    step: WorkflowStep,
    tools: Mapping[str, AgentModule | None],
    *,
    earlier: Sequence[str],
) -> None:
    where = f"Step {index + 1}"
    match step.kind:
        case "tool":
            if step.tool is None or step.tool not in tools:
                raise InvalidWorkflowError(f"{where}: choose a tool workflows can use.")
            if len(step.arguments) > 20:
                raise InvalidWorkflowError(f"{where}: too many arguments.")
            for key, value in step.arguments.items():
                if not re.fullmatch(r"[a-z_]{1,40}", key):
                    raise InvalidWorkflowError(f"{where}: “{key}” isn't an argument name.")
                if isinstance(value, str):
                    if len(value) > 4000:
                        raise InvalidWorkflowError(f"{where}: “{key}” is too long.")
                    _check_placeholders(where, value, earlier)
        case "condition":
            if step.condition is None:
                raise InvalidWorkflowError(f"{where}: set the condition.")
            _validate_condition(step.condition, earlier=earlier, where=where)
        case "delay":
            if not 1 <= step.minutes <= MAX_DELAY_MINUTES:
                raise InvalidWorkflowError(f"{where}: wait 1 minute to 7 days.")
        case "approval":
            if len(step.prompt) > 500:
                raise InvalidWorkflowError(f"{where}: the message is too long.")
        case "ai":
            if not step.prompt.strip():
                raise InvalidWorkflowError(f"{where}: write the instruction for the AI.")
            if len(step.prompt) > 4000:
                raise InvalidWorkflowError(f"{where}: the instruction is too long.")
            _check_placeholders(where, step.prompt, earlier)


def _validate_condition(condition: Condition, *, earlier: Sequence[str], where: str) -> None:
    if not _PATH.match(condition.left):
        raise InvalidWorkflowError(
            f"{where}: compare a value such as trigger.title or steps.<id>.count."
        )
    _check_path(where, condition.left, earlier)
    if isinstance(condition.right, str) and len(condition.right) > 200:
        raise InvalidWorkflowError(f"{where}: the value is too long.")


def _check_placeholders(where: str, text: str, earlier: Sequence[str]) -> None:
    for path in placeholders(text):
        if not _PATH.match(path):
            raise InvalidWorkflowError(f"{where}: “{{{{{path}}}}}” isn't a value name.")
        _check_path(where, path, earlier)


def _check_path(where: str, path: str, earlier: Sequence[str]) -> None:
    parts = path.split(".")
    if parts[0] == "steps" and (len(parts) < 3 or parts[1] not in earlier):
        raise InvalidWorkflowError(f"{where}: “{path}” must name an earlier step's value.")


def trigger_module(trigger: Trigger) -> AgentModule | None:
    """The module whose data starts the workflow, which the agent must be allowed to use."""
    if trigger.kind == "event" and trigger.event is not None:
        return EVENT_MODULE[trigger.event.event]
    if trigger.kind == "condition" and trigger.condition is not None:
        return METRIC_MODULE[trigger.condition.metric]
    return None
