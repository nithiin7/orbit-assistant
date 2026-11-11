"""The agent's tools: Orbit's modules as typed, permission-checked operations.

Every tool validates its arguments with its own Pydantic model (`extra="forbid"`), so a model's
call can't carry anything else; writes are validated again by the target module's own request
schema (`ModuleActionValidator`, shared with the assistant's proposals) and run by the module's
own service, exactly as its route would. Reads go through the same module services the
assistant's structured context uses, so figures are Orbit's.

There are no tools for deleting, paying, transferring, investing, sending email, sharing, or
changing settings or permissions; financial tools are read only.

Writes only flush: the engine commits a write together with the step that records it.
"""

import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Annotated, Any, Final, Literal, Protocol, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from orbit_api.api.ai_actions import ModuleActionExecutor, ModuleActionValidator
from orbit_api.repositories.agent import SqlAgentStore
from orbit_api.repositories.agent_services import ToolInputs
from orbit_api.services.agent.engine import run_link
from orbit_api.services.agent.models import (
    AgentModule,
    InvalidToolCallError,
    Memory,
    RiskLevel,
    Scalar,
    ToolAccess,
    ToolFailedError,
)
from orbit_api.services.agent.safety import redact_text
from orbit_api.services.agent.tools import (
    MailReader,
    PreparedCall,
    Tool,
    ToolContext,
    ToolOutput,
    ToolRegistry,
    ToolSpec,
)
from orbit_api.services.ai.assist import AssistRequest, AssistService
from orbit_api.services.ai.context import ContextBlock, ContextBuilder, Viewer, format_money
from orbit_api.services.ai.models import (
    ActionKind,
    ActionResult,
    AiDisabledError,
    AiNotConfiguredError,
    CloudProcessingNotAllowedError,
    InvalidActionError,
    ModuleNotPermittedError,
    RecordRef,
    SourceNotFoundError,
    UsageLimitReachedError,
)
from orbit_api.services.ai.providers import ProviderError
from orbit_api.services.ai.routing import Route
from orbit_api.services.commitments.models import PaymentQuery
from orbit_api.services.documents.models import (
    DateRange,
    Document,
    DocumentNotFoundError,
    DocumentQuery,
)
from orbit_api.services.finance.models import TransactionQuery
from orbit_api.services.notes.models import Note, NoteNotFoundError, NoteQuery
from orbit_api.services.notifications.models import Notification
from orbit_api.services.tasks.models import TaskChanges, TaskNotFoundError, TaskQuery
from orbit_api.services.tasks.service import TaskService
from orbit_api.utils.changes import UNSET

MAX_TEXT: Final = 6000


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Limit = Annotated[int, Field(ge=1, le=25, description="Most results to return.")]
Days = Annotated[int, Field(ge=0, le=366)]
Text = Annotated[str, Field(min_length=1, max_length=200)]


# Read tool arguments


class SearchTasksArgs(_Args):
    query: str | None = Field(default=None, max_length=200, description="Words in the title.")
    status: Literal["open", "completed", "any"] = "open"
    due_within_days: Days | None = Field(default=None, description="Due from today to N days.")
    overdue_only: bool = False
    limit: Limit = 10


class CalendarArgs(_Args):
    days_ahead: Annotated[int, Field(ge=0, le=31)] = 7
    days_back: Annotated[int, Field(ge=0, le=31)] = 0


class RemindersArgs(_Args):
    days_ahead: Annotated[int, Field(ge=1, le=90)] = 14


class SearchNotesArgs(_Args):
    query: Text
    limit: Limit = 8


class SearchDocumentsArgs(_Args):
    query: str | None = Field(default=None, max_length=200)
    expiring_within_days: Annotated[int, Field(ge=1, le=366)] | None = None
    limit: Limit = 10


class DocumentArgs(_Args):
    document_id: uuid.UUID


class NoteArgs(_Args):
    note_id: uuid.UUID


class NoArgs(_Args):
    pass


class TransactionsArgs(_Args):
    days_back: Annotated[int, Field(ge=1, le=366)] = 30
    query: str | None = Field(default=None, max_length=200)
    limit: Annotated[int, Field(ge=1, le=50)] = 20


class FinanceSummaryArgs(_Args):
    period: Literal["this_month", "last_month"] = "this_month"


class PaymentsArgs(_Args):
    days_ahead: Annotated[int, Field(ge=1, le=90)] = 30


class WorkoutArgs(_Args):
    days_back: Annotated[int, Field(ge=1, le=90)] = 14


class SearchEmailArgs(_Args):
    query: Text
    limit: Annotated[int, Field(ge=1, le=20)] = 10


# Write tool arguments (validated again by the module's request schema)


class CreateTaskArgs(_Args):
    title: Text
    description: str = Field(default="", max_length=5000)
    priority: Literal["none", "low", "medium", "high"] = "none"
    due_date: date | None = None


class UpdateTaskArgs(_Args):
    task_id: uuid.UUID
    title: str | None = Field(default=None, min_length=1, max_length=200)
    priority: Literal["none", "low", "medium", "high"] | None = None
    due_date: date | None = None


class TaskArgs(_Args):
    task_id: uuid.UUID


class CreateReminderArgs(_Args):
    title: Text
    start_date: date
    time_of_day: str = Field(pattern=r"^\d{2}:\d{2}$", description="HH:MM, local time.")
    description: str = Field(default="", max_length=2000)


class CreateEventArgs(_Args):
    title: Text
    start: str = Field(description="YYYY-MM-DDTHH:MM local time, or YYYY-MM-DD if all day.")
    end: str = Field(description="Like start.")
    all_day: bool = False
    location: str = Field(default="", max_length=300)
    description: str = Field(default="", max_length=5000)


class CreateNoteArgs(_Args):
    title: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=20_000)


class AppendNoteArgs(_Args):
    note_id: uuid.UUID
    text: str = Field(min_length=1, max_length=10_000)


class TagNoteArgs(_Args):
    note_id: uuid.UUID
    tags: list[Annotated[str, Field(min_length=1, max_length=50)]] = Field(
        min_length=1, max_length=5
    )


class DocumentDetailsArgs(_Args):
    document_id: uuid.UUID
    provider: str | None = Field(default=None, max_length=200)
    issuing_authority: str | None = Field(default=None, max_length=200)
    reference_number: str | None = Field(default=None, max_length=200)
    issue_date: date | None = None
    effective_date: date | None = None
    expiry_date: date | None = None
    renewal_date: date | None = None


class NotifyArgs(_Args):
    title: Text
    body: str = Field(default="", max_length=2000)


class RememberArgs(_Args):
    text: str = Field(min_length=3, max_length=300, description="A short preference to keep.")


class RunWorkflowArgs(_Args):
    workflow_id: uuid.UUID


# Dependencies


class NoteReader(Protocol):
    async def get(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> Note: ...


class DocumentReader(Protocol):
    async def get(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document: ...


class TransactionReader(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: TransactionQuery) -> Any: ...


class NotificationWriter(Protocol):
    async def add(self, notification: Notification) -> None: ...


class MemoryWriter(Protocol):
    async def add_memory(self, memory: Memory) -> None: ...

    async def primary_agent_id(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID: ...

    async def memory_enabled(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> bool: ...


type StartWorkflow = Callable[[ToolContext, uuid.UUID], Awaitable[str]]
type WorkflowTitle = Callable[[ToolContext, uuid.UUID], Awaitable[str | None]]


@dataclass(frozen=True, slots=True)
class ToolDeps:
    context: ContextBuilder
    assist: AssistService
    notes: NoteReader
    documents: DocumentReader
    transactions: TransactionReader
    # Write services built on a flush-only transaction (see the module docstring).
    tasks: TaskService
    executor: ModuleActionExecutor
    notifications: NotificationWriter
    memories: MemoryWriter
    start_workflow: StartWorkflow
    workflow_title: WorkflowTitle
    mail: MailReader | None
    validator: ModuleActionValidator = field(default_factory=ModuleActionValidator)


# Helpers


def _validate[T: BaseModel](model: type[T], arguments: dict[str, object]) -> T:
    try:
        return model.model_validate(arguments)
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in e["loc"]) or "arguments" for e in exc.errors()})
        raise InvalidToolCallError("Invalid arguments: " + ", ".join(fields[:5]) + ".") from None


def _dump(args: BaseModel) -> dict[str, object]:
    return cast(dict[str, object], args.model_dump(mode="json", exclude_none=True))


def _viewer(ctx: ToolContext) -> Viewer:
    return Viewer(
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        today=ctx.today,
        timezone=ctx.timezone,
        now=ctx.now,
    )


def _route(start: date | None = None, end: date | None = None, period: str | None = None) -> Route:
    return Route(
        modules=frozenset(),
        start=start,
        end=end,
        period=period,
        wants_action=False,
        keywords=(),
        overview=False,
    )


def _blocks(blocks: Sequence[ContextBlock]) -> ToolOutput:
    lines: list[str] = []
    records: list[RecordRef] = []
    for block in blocks:
        lines.append(f"## {block.heading}" if block.items else f"## {block.heading}: none")
        for item in block.items:
            lines.append(f"- {item.ref.title}: {item.body}".strip())
            if item.ref.id is not None:
                records.append(item.ref)
    return ToolOutput(
        text="\n".join(lines)[:MAX_TEXT], records=tuple(records[:25]), data={"count": len(records)}
    )


def _lines(
    heading: str,
    rows: Sequence[tuple[str, RecordRef | None]],
    extra: dict[str, Scalar] | None = None,
) -> ToolOutput:
    body = "\n".join(f"- {text}" for text, _ in rows) or "- none"
    records = tuple(ref for _, ref in rows if ref is not None)
    return ToolOutput(
        text=f"## {heading}\n{body}"[:MAX_TEXT],
        records=records[:25],
        data={"count": len(rows), **(extra or {})},
    )


def _assist_error(exc: Exception) -> ToolFailedError:
    if isinstance(exc, ModuleNotPermittedError):
        return ToolFailedError(f"AI isn't allowed to read {exc.module}.")
    if isinstance(exc, AiDisabledError):
        return ToolFailedError("AI is turned off.")
    if isinstance(exc, AiNotConfiguredError):
        return ToolFailedError(exc.message)
    if isinstance(exc, CloudProcessingNotAllowedError):
        return ToolFailedError("Cloud processing isn't allowed for the AI provider.")
    if isinstance(exc, UsageLimitReachedError):
        return ToolFailedError("This month's AI token limit has been reached.")
    if isinstance(exc, SourceNotFoundError):
        return ToolFailedError("That record wasn't found.")
    if isinstance(exc, ProviderError):
        return ToolFailedError(exc.message, retryable=True)
    return ToolFailedError("The tool failed.")


# Handlers


type ReadFn[A: BaseModel] = Callable[[A, ToolContext], Awaitable[ToolOutput]]


class _Read[A: BaseModel]:
    def __init__(self, title: str, model: type[A], run: ReadFn[A]) -> None:
        self._title = title
        self._model = model
        self._run = run

    async def prepare(self, arguments: dict[str, object], context: ToolContext) -> PreparedCall:
        args = _validate(self._model, arguments)
        return PreparedCall(tool="", arguments=_dump(args), summary=self._title)

    async def run(self, call: PreparedCall, context: ToolContext) -> ToolOutput:
        return await self._run(self._model.model_validate(call.arguments), context)


class _Action:
    """A write that is one of the assistant's allowlisted action kinds."""

    def __init__(
        self,
        deps: ToolDeps,
        kind: ActionKind,
        model: type[BaseModel],
        target: Callable[[dict[str, object], ToolContext], Awaitable[RecordRef | None]]
        | None = None,
        effect: str = "",
    ) -> None:
        self._deps = deps
        self._kind: ActionKind = kind
        self._model = model
        self._target = target
        self._effect = effect

    async def prepare(self, arguments: dict[str, object], context: ToolContext) -> PreparedCall:
        args = _dump(_validate(self._model, arguments))
        try:
            payload, summary = self._deps.validator.validate(self._kind, args, context.timezone)
        except InvalidActionError as exc:
            raise InvalidToolCallError(str(exc)) from None
        target = await self._target(payload, context) if self._target else None
        return PreparedCall(
            tool="", arguments=payload, summary=summary, target=target, effect=self._effect
        )

    async def run(self, call: PreparedCall, context: ToolContext) -> ToolOutput:
        try:
            result = await self._deps.executor.execute(
                context.workspace_id, context.user_id, self._kind, call.arguments, context.timezone
            )
        except InvalidActionError as exc:
            raise ToolFailedError(str(exc)) from None
        return ToolOutput(text=f"Done: {call.summary}", result=result, data={"count": 1})


class _Custom:
    def __init__(
        self,
        prepare: Callable[[dict[str, object], ToolContext], Awaitable[PreparedCall]],
        run: Callable[[PreparedCall, ToolContext], Awaitable[ToolOutput]],
    ) -> None:
        self._prepare = prepare
        self._run = run

    async def prepare(self, arguments: dict[str, object], context: ToolContext) -> PreparedCall:
        return await self._prepare(arguments, context)

    async def run(self, call: PreparedCall, context: ToolContext) -> ToolOutput:
        return await self._run(call, context)


class _Named:
    """Stamps the tool's name on prepared calls, so a call's fingerprint names its tool."""

    def __init__(self, name: str, inner: _Read[Any] | _Action | _Custom) -> None:
        self._name = name
        self._inner = inner

    async def prepare(self, arguments: dict[str, object], context: ToolContext) -> PreparedCall:
        call = await self._inner.prepare(arguments, context)
        return PreparedCall(
            tool=self._name,
            arguments=call.arguments,
            summary=redact_text(call.summary, 300),
            target=call.target,
            effect=call.effect,
        )

    async def run(self, call: PreparedCall, context: ToolContext) -> ToolOutput:
        return await self._inner.run(call, context)


def _spec(
    name: str,
    title: str,
    description: str,
    module: AgentModule | None,
    access: ToolAccess,
    risk: RiskLevel,
    model: type[BaseModel],
    *,
    idempotent: bool | None = None,
    always_confirm: bool = False,
    uses_ai: bool = False,
    in_workflows: bool = True,
) -> ToolSpec:
    schema = model.model_json_schema()
    schema.pop("title", None)
    return ToolSpec(
        name=name,
        title=title,
        description=description,
        module=module,
        access=access,
        risk=risk,
        idempotent=access == "read" if idempotent is None else idempotent,
        always_confirm=always_confirm,
        input_schema=schema,
        uses_ai=uses_ai,
        in_workflows=in_workflows,
    )


def build_tools(deps: ToolDeps) -> ToolRegistry:
    context = deps.context
    sources = context.sources
    tools: list[Tool] = []

    def add(spec: ToolSpec, handler: _Read[Any] | _Action | _Custom) -> None:
        tools.append(Tool(spec=spec, handler=_Named(spec.name, handler)))

    # Tasks

    async def search_tasks(args: SearchTasksArgs, ctx: ToolContext) -> ToolOutput:
        due_from: date | None = None
        due_to: date | None = None
        if args.overdue_only:
            due_to = ctx.today - timedelta(days=1)
        elif args.due_within_days is not None:
            due_from, due_to = ctx.today, ctx.today + timedelta(days=args.due_within_days)
        query = TaskQuery(
            status="open" if args.overdue_only else None if args.status == "any" else args.status,
            search=args.query,
            due_from=due_from,
            due_to=due_to,
            sort="due_date",
            limit=args.limit,
        )
        page = await sources.tasks.find(ctx.workspace_id, query)
        rows = [
            (
                f"{t.title}"
                + (f" (due {t.due_date:%a %d %b})" if t.due_date else "")
                + (f", {t.priority} priority" if t.priority != "none" else "")
                + (", completed" if t.status == "completed" else "")
                + f" [id {t.id}]",
                RecordRef(kind="task", id=t.id, title=t.title, day=t.due_date),
            )
            for t in page.tasks
        ]
        return _lines(f"Tasks ({page.total} matching)", rows, {"total": page.total})

    add(
        _spec(
            "search_tasks",
            "Search tasks",
            "Find tasks by words, status, and due date.",
            "tasks",
            "read",
            "low",
            SearchTasksArgs,
        ),
        _Read("Search tasks", SearchTasksArgs, search_tasks),
    )

    add(
        _spec(
            "create_task",
            "Create a task",
            "Create a task in this workspace.",
            "tasks",
            "create",
            "low",
            CreateTaskArgs,
        ),
        _Action(deps, "create_task", CreateTaskArgs, None, "A new task is added."),
    )

    async def find_task(ctx: ToolContext, task_id: uuid.UUID) -> RecordRef:
        try:
            task = await deps.tasks.get(ctx.workspace_id, task_id)
        except TaskNotFoundError:
            raise InvalidToolCallError("That task doesn't exist.") from None
        return RecordRef(kind="task", id=task.id, title=task.title, day=task.due_date)

    async def prepare_complete(arguments: dict[str, object], ctx: ToolContext) -> PreparedCall:
        args = _validate(TaskArgs, arguments)
        target = await find_task(ctx, args.task_id)
        return PreparedCall(
            tool="",
            arguments=_dump(args),
            summary=f"Complete “{target.title}”",
            target=target,
            effect="The task is marked completed.",
        )

    async def run_complete(call: PreparedCall, ctx: ToolContext) -> ToolOutput:
        args = TaskArgs.model_validate(call.arguments)
        try:
            task = await deps.tasks.complete(ctx.workspace_id, args.task_id)
        except TaskNotFoundError:
            raise ToolFailedError("The task no longer exists.") from None
        return ToolOutput(
            text=f"Completed “{task.title}”.",
            result=ActionResult(kind="task", id=task.id, title=task.title),
            data={"count": 1},
        )

    add(
        _spec(
            "complete_task",
            "Complete a task",
            "Mark a task completed. Use an id from search_tasks.",
            "tasks",
            "update",
            "low",
            TaskArgs,
            idempotent=True,
        ),
        _Custom(prepare_complete, run_complete),
    )

    async def prepare_update(arguments: dict[str, object], ctx: ToolContext) -> PreparedCall:
        args = _validate(UpdateTaskArgs, arguments)
        changed = _dump(args)
        if len(changed) == 1:
            raise InvalidToolCallError("Nothing to change.")
        target = await find_task(ctx, args.task_id)
        labels = ", ".join(k.replace("_", " ") for k in changed if k != "task_id")
        return PreparedCall(
            tool="",
            arguments=changed,
            summary=f"Change the {labels} of “{target.title}”",
            target=target,
            effect="The task's " + labels + " change.",
        )

    async def run_update(call: PreparedCall, ctx: ToolContext) -> ToolOutput:
        args = UpdateTaskArgs.model_validate(call.arguments)
        changes = TaskChanges(
            title=args.title if args.title is not None else UNSET,
            priority=args.priority if args.priority is not None else UNSET,
            due_date=args.due_date if args.due_date is not None else UNSET,
        )
        try:
            task = await deps.tasks.update(ctx.workspace_id, args.task_id, changes)
        except TaskNotFoundError:
            raise ToolFailedError("The task no longer exists.") from None
        except ValueError as exc:
            raise ToolFailedError(str(exc) or "The values aren't valid.") from None
        return ToolOutput(
            text=f"Updated “{task.title}”.",
            result=ActionResult(kind="task", id=task.id, title=task.title),
            data={"count": 1},
        )

    add(
        _spec(
            "update_task",
            "Update a task",
            "Change a task's title, priority, or due date. Use an id from search_tasks.",
            "tasks",
            "update",
            "medium",
            UpdateTaskArgs,
            idempotent=True,
        ),
        _Custom(prepare_update, run_update),
    )

    # Reminders and notifications

    async def get_reminders(args: RemindersArgs, ctx: ToolContext) -> ToolOutput:
        return _blocks(
            await context.reminders(
                _viewer(ctx), _route(end=ctx.today + timedelta(days=args.days_ahead))
            )
        )

    add(
        _spec(
            "get_reminders",
            "Upcoming reminders",
            "List upcoming reminders.",
            "reminders",
            "read",
            "low",
            RemindersArgs,
        ),
        _Read("Upcoming reminders", RemindersArgs, get_reminders),
    )
    add(
        _spec(
            "create_reminder",
            "Create a reminder",
            "Create a one-time reminder at a local date and time.",
            "reminders",
            "create",
            "low",
            CreateReminderArgs,
        ),
        _Action(deps, "create_reminder", CreateReminderArgs, None, "A reminder is scheduled."),
    )

    async def prepare_notify(arguments: dict[str, object], ctx: ToolContext) -> PreparedCall:
        args = _validate(NotifyArgs, arguments)
        return PreparedCall(
            tool="",
            arguments=_dump(args),
            summary=f"Notify you: “{args.title}”",
            effect="An in-app notification appears for you.",
        )

    async def run_notify(call: PreparedCall, ctx: ToolContext) -> ToolOutput:
        args = NotifyArgs.model_validate(call.arguments)
        await deps.notifications.add(
            Notification(
                id=uuid.uuid4(),
                user_id=ctx.user_id,
                workspace_id=ctx.workspace_id,
                reminder_id=None,
                occurrence_id=None,
                title=args.title[:200],
                body=args.body[:2000],
                scheduled_for=ctx.now,
                created_at=ctx.now,
                read_at=None,
                link=None if ctx.execution_id is None else run_link(ctx.execution_id),
            )
        )
        return ToolOutput(text=f"Sent you a notification: {args.title}", data={"count": 1})

    add(
        _spec(
            "send_notification",
            "Notify me",
            "Send the person an in-app notification (never email or anything external).",
            "reminders",
            "create",
            "low",
            NotifyArgs,
        ),
        _Custom(prepare_notify, run_notify),
    )

    # Calendar

    async def search_calendar(args: CalendarArgs, ctx: ToolContext) -> ToolOutput:
        start = ctx.today - timedelta(days=args.days_back)
        end = ctx.today + timedelta(days=args.days_ahead)
        return _blocks(await context.calendar(_viewer(ctx), _route(start, end)))

    add(
        _spec(
            "search_calendar",
            "Calendar",
            "Events from N days back to N days ahead, with overlaps found by Orbit.",
            "calendar",
            "read",
            "low",
            CalendarArgs,
        ),
        _Read("Read the calendar", CalendarArgs, search_calendar),
    )
    add(
        _spec(
            "create_event",
            "Create an event",
            "Add an event to the calendar.",
            "calendar",
            "create",
            "medium",
            CreateEventArgs,
        ),
        _Action(deps, "create_event", CreateEventArgs, None, "A calendar event is added."),
    )

    # Notes

    async def search_notes(args: SearchNotesArgs, ctx: ToolContext) -> ToolOutput:
        page = await sources.notes.find(
            ctx.workspace_id, NoteQuery(search=args.query, limit=args.limit)
        )
        rows = [
            (
                f"{item.note.title or 'Untitled note'} [id {item.note.id}]: {item.excerpt}",
                RecordRef(
                    kind="note",
                    id=item.note.id,
                    title=item.note.title or "Untitled note",
                    day=item.note.updated_at.date(),
                ),
            )
            for item in page.items
        ]
        return _lines("Matching notes", rows)

    add(
        _spec(
            "search_notes",
            "Search notes",
            "Find notes containing all the given words.",
            "notes",
            "read",
            "low",
            SearchNotesArgs,
        ),
        _Read("Search notes", SearchNotesArgs, search_notes),
    )

    async def summarize(
        kind: Literal["note_summary", "document_summary", "document_extract"],
        target_id: uuid.UUID,
        ctx: ToolContext,
    ) -> ToolOutput:
        try:
            result = await deps.assist.run(
                ctx.workspace_id,
                ctx.user_id,
                AssistRequest(kind=kind, target_id=target_id),
                ctx.timezone,
            )
        except (
            ModuleNotPermittedError,
            AiDisabledError,
            AiNotConfiguredError,
            CloudProcessingNotAllowedError,
            UsageLimitReachedError,
            SourceNotFoundError,
            ProviderError,
        ) as exc:
            raise _assist_error(exc) from None
        items = "\n".join(
            f"- {item.label}: {item.detail}".rstrip(": ") for item in result.items[:20]
        )
        text = result.text + (f"\n{items}" if items else "")
        refs = tuple(c.ref for c in result.citations if c.ref.id is not None)
        return ToolOutput(text=text[:MAX_TEXT], records=refs, data={"count": len(refs) or 1})

    async def summarize_note(args: NoteArgs, ctx: ToolContext) -> ToolOutput:
        return await summarize("note_summary", args.note_id, ctx)

    add(
        _spec(
            "summarize_note",
            "Summarize a note",
            "Summarize one note with AI. Use an id from search_notes.",
            "notes",
            "read",
            "low",
            NoteArgs,
            uses_ai=True,
        ),
        _Read("Summarize a note", NoteArgs, summarize_note),
    )

    async def note_target(payload: dict[str, object], ctx: ToolContext) -> RecordRef | None:
        note_id = payload.get("note_id")
        if not isinstance(note_id, str):
            return None
        try:
            note = await deps.notes.get(ctx.workspace_id, uuid.UUID(note_id))
        except NoteNotFoundError:
            raise InvalidToolCallError("That note doesn't exist.") from None
        return RecordRef(kind="note", id=note.id, title=note.title or "Untitled note")

    add(
        _spec(
            "create_note",
            "Create a note",
            "Create a note from plain text.",
            "notes",
            "create",
            "low",
            CreateNoteArgs,
        ),
        _Action(deps, "create_note", CreateNoteArgs, None, "A new note is added."),
    )
    add(
        _spec(
            "append_to_note",
            "Add to a note",
            "Add text to the end of a note. Use an id from search_notes.",
            "notes",
            "update",
            "medium",
            AppendNoteArgs,
        ),
        _Action(deps, "append_to_note", AppendNoteArgs, note_target, "Text is added to the note."),
    )
    add(
        _spec(
            "add_note_tags",
            "Tag a note",
            "Add tags to a note. Use an id from search_notes.",
            "notes",
            "update",
            "low",
            TagNoteArgs,
            idempotent=True,
        ),
        _Action(deps, "add_note_tags", TagNoteArgs, note_target, "Tags are added to the note."),
    )

    # Documents

    async def search_documents(args: SearchDocumentsArgs, ctx: ToolContext) -> ToolOutput:
        expiry = (
            DateRange(ctx.today, ctx.today + timedelta(days=args.expiring_within_days))
            if args.expiring_within_days
            else DateRange()
        )
        documents, total = await sources.documents.find(
            ctx.workspace_id,
            DocumentQuery(
                search=args.query,
                expiry=expiry,
                sort="expiry" if args.expiring_within_days else "updated",
                order="asc" if args.expiring_within_days else "desc",
                limit=args.limit,
            ),
        )
        rows = [
            (
                f"{d.title} [id {d.id}]"
                + (f", expires {d.details.expiry_date:%d %b %Y}" if d.details.expiry_date else ""),
                RecordRef(kind="document", id=d.id, title=d.title, day=d.details.expiry_date),
            )
            for d in documents
        ]
        return _lines(f"Documents ({total} matching)", rows, {"total": total})

    add(
        _spec(
            "search_documents",
            "Search documents",
            "Find documents by words, or those expiring within N days.",
            "documents",
            "read",
            "low",
            SearchDocumentsArgs,
        ),
        _Read("Search documents", SearchDocumentsArgs, search_documents),
    )

    async def get_document(args: DocumentArgs, ctx: ToolContext) -> ToolOutput:
        try:
            d = await deps.documents.get(ctx.workspace_id, args.document_id)
        except DocumentNotFoundError:
            raise ToolFailedError("That document doesn't exist.") from None
        details = d.details
        fields: dict[str, object] = {
            "Provider": details.provider,
            "Issued by": details.issuing_authority,
            "Issued": details.issue_date,
            "Effective": details.effective_date,
            "Expires": details.expiry_date,
            "Renews": details.renewal_date,
            "Review": details.review_date,
            "Tags": ", ".join(d.tags) or None,
            "File": d.file.filename if d.file else None,
        }
        # Reference numbers are identifiers (passport, policy numbers): never handed to a model.
        rows = [(f"{label}: {value}", None) for label, value in fields.items() if value]
        output = _lines(f"Document “{d.title}”", rows)
        return ToolOutput(
            text=output.text,
            records=(RecordRef(kind="document", id=d.id, title=d.title),),
            data={"count": 1, "expiry_date": str(details.expiry_date or "")},
        )

    add(
        _spec(
            "get_document",
            "Document details",
            "A document's metadata (dates, provider, tags), without its reference number.",
            "documents",
            "read",
            "low",
            DocumentArgs,
        ),
        _Read("Read document details", DocumentArgs, get_document),
    )

    async def summarize_document(args: DocumentArgs, ctx: ToolContext) -> ToolOutput:
        return await summarize("document_summary", args.document_id, ctx)

    async def extract_document(args: DocumentArgs, ctx: ToolContext) -> ToolOutput:
        return await summarize("document_extract", args.document_id, ctx)

    add(
        _spec(
            "summarize_document",
            "Summarize a document",
            "Summarize one document's text with AI.",
            "documents",
            "read",
            "low",
            DocumentArgs,
            uses_ai=True,
        ),
        _Read("Summarize a document", DocumentArgs, summarize_document),
    )
    add(
        _spec(
            "extract_document_details",
            "Extract document details",
            "Read dates and details from a document's text with AI (nothing is changed).",
            "documents",
            "read",
            "low",
            DocumentArgs,
            uses_ai=True,
        ),
        _Read("Extract document details", DocumentArgs, extract_document),
    )

    async def document_target(payload: dict[str, object], ctx: ToolContext) -> RecordRef | None:
        document_id = payload.get("document_id")
        if not isinstance(document_id, str):
            return None
        try:
            d = await deps.documents.get(ctx.workspace_id, uuid.UUID(document_id))
        except DocumentNotFoundError:
            raise InvalidToolCallError("That document doesn't exist.") from None
        return RecordRef(kind="document", id=d.id, title=d.title)

    add(
        _spec(
            "update_document_details",
            "Fill in document details",
            "Set a document's provider, issuer, or dates. Never its file, folder, or state.",
            "documents",
            "update",
            "medium",
            DocumentDetailsArgs,
            idempotent=True,
        ),
        _Action(
            deps,
            "update_document_details",
            DocumentDetailsArgs,
            document_target,
            "The document's details change.",
        ),
    )

    # Finance (read only)

    async def get_accounts(args: NoArgs, ctx: ToolContext) -> ToolOutput:
        accounts = await sources.finance.accounts(ctx.workspace_id)
        rows = [
            (
                f"{v.account.name} ({v.account.type}): "
                f"{format_money(v.balance, v.account.currency)}",
                RecordRef(kind="account", id=v.account.id, title=v.account.name),
            )
            for v in accounts
            if v.account.archived_at is None
        ]
        return _lines("Account balances (calculated by Orbit)", rows)

    add(
        _spec(
            "get_accounts",
            "Account balances",
            "Each account's balance, calculated by Orbit.",
            "finance",
            "read",
            "low",
            NoArgs,
        ),
        _Read("Read account balances", NoArgs, get_accounts),
    )

    async def get_transactions(args: TransactionsArgs, ctx: ToolContext) -> ToolOutput:
        page = await deps.transactions.find(
            ctx.workspace_id,
            TransactionQuery(
                date_from=ctx.today - timedelta(days=args.days_back),
                date_to=ctx.today,
                search=args.query,
                limit=args.limit,
            ),
        )
        rows = [
            (
                f"{t.occurred_on:%d %b}: {t.type} {format_money(t.amount, t.currency)}"
                + (f", {t.description}" if t.description else ""),
                RecordRef(kind="transaction", id=t.id, title=t.description or t.type),
            )
            for t in page.transactions
        ]
        return _lines(f"Transactions ({page.total} matching)", rows, {"total": page.total})

    add(
        _spec(
            "get_transactions",
            "Transactions",
            "Recorded transactions from the last N days, optionally matching words.",
            "finance",
            "read",
            "low",
            TransactionsArgs,
        ),
        _Read("Read transactions", TransactionsArgs, get_transactions),
    )

    async def finance_summary(args: FinanceSummaryArgs, ctx: ToolContext) -> ToolOutput:
        first = ctx.today.replace(day=1)
        if args.period == "last_month":
            end = first - timedelta(days=1)
            route = _route(end.replace(day=1), end, "last month")
        else:
            route = _route(first, ctx.today, "this month")
        return _blocks(await context.finance(_viewer(ctx), route))

    add(
        _spec(
            "get_finance_summary",
            "Spending summary",
            "Spending by category, income, upcoming payments, and budgets, calculated by Orbit.",
            "finance",
            "read",
            "low",
            FinanceSummaryArgs,
        ),
        _Read("Summarize finances", FinanceSummaryArgs, finance_summary),
    )

    async def get_budgets(args: NoArgs, ctx: ToolContext) -> ToolOutput:
        rows: list[tuple[str, RecordRef | None]] = []
        for view in await sources.budgets.views(ctx.workspace_id, ctx.today):
            if view.status != "active" or view.current is None:
                continue
            u = view.current.utilization
            used = f"{u.utilization_bps / 100:.1f}%" if u.utilization_bps is not None else "n/a"
            rows.append(
                (
                    f"{view.budget.name}: {format_money(u.spent, view.budget.currency)} of "
                    f"{format_money(u.available, view.budget.currency)} ({used} used)",
                    RecordRef(kind="budget", id=view.budget.id, title=view.budget.name),
                )
            )
        return _lines("Active budgets (calculated by Orbit)", rows)

    add(
        _spec(
            "get_budgets",
            "Budgets",
            "Active budgets and how much of each is used.",
            "finance",
            "read",
            "low",
            NoArgs,
        ),
        _Read("Read budgets", NoArgs, get_budgets),
    )

    async def upcoming_payments(args: PaymentsArgs, ctx: ToolContext) -> ToolOutput:
        payments = await sources.payments.payments(
            ctx.workspace_id,
            PaymentQuery(
                today=ctx.today,
                date_from=ctx.today,
                date_to=ctx.today + timedelta(days=args.days_ahead),
            ),
        )
        rows: list[tuple[str, RecordRef | None]] = [
            (
                f"{p.name}: {format_money(p.amount, p.currency)}"
                + (" (estimate)" if p.estimated else "")
                + f" due {p.due_date:%a %d %b}"
                + (" — overdue" if p.due_date < ctx.today else ""),
                None,
            )
            for p in payments
            if p.status != "paid"
        ]
        return _lines("Upcoming payments (loans, subscriptions, bills)", rows)

    add(
        _spec(
            "get_upcoming_payments",
            "Upcoming payments",
            "Loan, subscription, and bill payments due in the next N days.",
            "finance",
            "read",
            "low",
            PaymentsArgs,
        ),
        _Read("Read upcoming payments", PaymentsArgs, upcoming_payments),
    )

    # Habits and health

    async def habit_progress(args: NoArgs, ctx: ToolContext) -> ToolOutput:
        return _blocks(await context.habits(_viewer(ctx)))

    add(
        _spec(
            "get_habit_progress",
            "Habit progress",
            "Active habits with today's state, streaks, and rates, calculated by Orbit.",
            "habits",
            "read",
            "low",
            NoArgs,
        ),
        _Read("Read habit progress", NoArgs, habit_progress),
    )

    async def workouts(args: WorkoutArgs, ctx: ToolContext) -> ToolOutput:
        start = ctx.today - timedelta(days=args.days_back)
        return _blocks(await context.health(_viewer(ctx), _route(start, ctx.today)))

    add(
        _spec(
            "get_workout_history",
            "Workout history",
            "Completed workouts and a health summary (only the person's own data).",
            "health",
            "read",
            "low",
            WorkoutArgs,
        ),
        _Read("Read workout history", WorkoutArgs, workouts),
    )

    async def health_summary(args: NoArgs, ctx: ToolContext) -> ToolOutput:
        output = _blocks(await context.health(_viewer(ctx), _route()))
        first = output.text.split("\n- ", 2)
        return ToolOutput(text="\n- ".join(first[:2]), data={"count": 1})

    add(
        _spec(
            "get_health_summary",
            "Health summary",
            "Today's recorded water, nutrition, workouts this week, and latest weight.",
            "health",
            "read",
            "low",
            NoArgs,
        ),
        _Read("Read the health summary", NoArgs, health_summary),
    )

    # Mail (read only)

    async def search_email(args: SearchEmailArgs, ctx: ToolContext) -> ToolOutput:
        if deps.mail is None:
            raise ToolFailedError("Email isn't available on this server.")
        hits = await deps.mail.search(ctx.workspace_id, ctx.user_id, args.query, args.limit)
        rows: list[tuple[str, RecordRef | None]] = [
            (f"{h.received:%d %b} from {h.sender}: “{h.subject}” — {h.snippet[:200]}", None)
            for h in hits
        ]
        return _lines("Matching emails (from your selected labels)", rows)

    add(
        _spec(
            "search_email",
            "Search email",
            "Search messages in the labels chosen for Orbit in connected mailboxes.",
            "mail",
            "read",
            "low",
            SearchEmailArgs,
        ),
        _Read("Search email", SearchEmailArgs, search_email),
    )

    # Memory and workflows (agent runs only)

    async def prepare_remember(arguments: dict[str, object], ctx: ToolContext) -> PreparedCall:
        args = _validate(RememberArgs, arguments)
        if not await deps.memories.memory_enabled(ctx.workspace_id, ctx.user_id):
            raise InvalidToolCallError("Saved preferences are turned off.")
        text = redact_text(args.text, 300)
        return PreparedCall(
            tool="",
            arguments={"text": text},
            summary=f"Remember: “{text}”",
            effect="The agent keeps this preference for future runs. You can edit or delete it.",
        )

    async def run_remember(call: PreparedCall, ctx: ToolContext) -> ToolOutput:
        args = RememberArgs.model_validate(call.arguments)
        await deps.memories.add_memory(
            Memory(
                id=uuid.uuid4(),
                workspace_id=ctx.workspace_id,
                user_id=ctx.user_id,
                agent_id=await deps.memories.primary_agent_id(ctx.workspace_id, ctx.user_id),
                category="preference",
                workflow_id=None,
                content=args.text,
                source="agent",
                created_at=ctx.now,
                updated_at=ctx.now,
            )
        )
        return ToolOutput(text="Saved the preference.", data={"count": 1})

    add(
        _spec(
            "remember_preference",
            "Save a preference",
            "Keep a short preference the person stated, for future runs. Always asks first.",
            None,
            "create",
            "medium",
            RememberArgs,
            always_confirm=True,
            in_workflows=False,
        ),
        _Custom(prepare_remember, run_remember),
    )

    async def prepare_run(arguments: dict[str, object], ctx: ToolContext) -> PreparedCall:
        args = _validate(RunWorkflowArgs, arguments)
        if ctx.from_workflow:
            raise InvalidToolCallError("Workflows can't start other workflows.")
        title = await deps.workflow_title(ctx, args.workflow_id)
        if title is None:
            raise InvalidToolCallError("That workflow doesn't exist.")
        return PreparedCall(
            tool="",
            arguments=_dump(args),
            summary=f"Run the workflow “{title}”",
            target=RecordRef(kind="workflow", id=args.workflow_id, title=title),
            effect="The workflow runs with its own steps and approvals.",
        )

    async def run_workflow(call: PreparedCall, ctx: ToolContext) -> ToolOutput:
        args = RunWorkflowArgs.model_validate(call.arguments)
        message = await deps.start_workflow(ctx, args.workflow_id)
        return ToolOutput(text=message, data={"count": 1})

    add(
        _spec(
            "run_workflow",
            "Run a workflow",
            "Start one of the person's workflows by id. Always asks first.",
            None,
            "create",
            "medium",
            RunWorkflowArgs,
            always_confirm=True,
            in_workflows=False,
        ),
        _Custom(prepare_run, run_workflow),
    )

    return ToolRegistry(tools)


class _AgentMemories:
    """Saved preferences, through the agent's own repository."""

    def __init__(self, store: SqlAgentStore) -> None:
        self._store = store

    async def add_memory(self, memory: Memory) -> None:
        await self._store.add_memory(memory)

    async def primary_agent_id(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
        agent = await self._store.primary(workspace_id, user_id)
        if agent is None:
            raise ToolFailedError("The agent no longer exists.")
        return agent.id

    async def memory_enabled(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        agent = await self._store.primary(workspace_id, user_id)
        return agent is not None and agent.memory.preferences


def tool_factory(inputs: ToolInputs) -> ToolRegistry:
    """The registry for one session: reads through the AI layer's module sources, writes
    through the flush-only module services."""
    writes = inputs.writes
    return build_tools(
        ToolDeps(
            context=inputs.ai.context,
            assist=inputs.ai.assist,
            notes=inputs.ai.modules.notes,
            documents=inputs.ai.modules.documents,
            transactions=inputs.ai.modules.finance,
            tasks=writes.tasks,
            executor=ModuleActionExecutor(
                tasks=writes.tasks,
                reminders=writes.reminders,
                calendar=writes.calendar,
                notes=writes.notes,
                documents=writes.documents,
            ),
            notifications=inputs.notifications,
            memories=_AgentMemories(inputs.store),
            start_workflow=inputs.start_workflow,
            workflow_title=inputs.workflow_title,
            mail=inputs.mail,
        )
    )
