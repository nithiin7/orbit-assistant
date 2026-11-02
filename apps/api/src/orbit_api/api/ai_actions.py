"""Validating and running AI action proposals with the modules' own rules.

Validation uses each module's own request schema (the same models its routes accept), so a
proposal can't hold anything the module's API would refuse. Execution calls the module's own
service, exactly as its route would. Only the allowlisted kinds exist; there is no way to run
arbitrary queries or touch other tables.
"""

import json
import uuid
from typing import Final, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from orbit_api.schemas.calendar import CreateEventRequest
from orbit_api.schemas.documents import UpdateDocumentRequest
from orbit_api.schemas.notes import AddNoteTagRequest, CreateNoteRequest
from orbit_api.schemas.reminders import CreateReminderRequest
from orbit_api.schemas.tasks import CreateTaskRequest
from orbit_api.services.ai.models import ActionKind, ActionResult, InvalidActionError
from orbit_api.services.calendar.models import CategoryNotFoundError as EventCategoryNotFoundError
from orbit_api.services.calendar.models import EventNoteNotFoundError, EventTaskNotFoundError
from orbit_api.services.calendar.service import CalendarService
from orbit_api.services.documents.models import DocumentNotFoundError
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.notes.content import (
    NoteDocument,
    build_document,
    document_from_text,
    load_document,
)
from orbit_api.services.notes.models import (
    FolderNotFoundError,
    NoteChanges,
    NoteNotFoundError,
    RevisionConflictError,
    TooManyTagsError,
)
from orbit_api.services.notes.service import NoteService
from orbit_api.services.reminders.models import ReminderInPastError, ReminderTaskNotFoundError
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.tasks.service import TaskService

MAX_TAGS: Final = 5


class _AppendToNote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: uuid.UUID
    text: str = Field(min_length=1, max_length=10_000)


class _AddNoteTags(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: uuid.UUID
    tags: list[str] = Field(min_length=1, max_length=MAX_TAGS)


class _UpdateDocumentDetails(BaseModel):
    """Only descriptive fields an extraction can fill; never the file, folder, or state."""

    model_config = ConfigDict(extra="forbid")

    document_id: uuid.UUID
    provider: str | None = None
    issuing_authority: str | None = None
    reference_number: str | None = None
    issue_date: str | None = None
    effective_date: str | None = None
    expiry_date: str | None = None
    renewal_date: str | None = None


def _clean(payload: dict[str, object]) -> dict[str, object]:
    """Drop nulls and empty strings the model used for 'not stated'."""
    return {k: v for k, v in payload.items() if v is not None and v != "" and v != "null"}


class ModuleActionValidator:
    def validate(
        self, kind: ActionKind, payload: dict[str, object], timezone: str
    ) -> tuple[dict[str, object], str]:
        try:
            return self._validate(kind, _clean(payload), timezone)
        except ValidationError:
            raise InvalidActionError("The proposed values aren't valid.") from None

    def _validate(
        self, kind: ActionKind, payload: dict[str, object], timezone: str
    ) -> tuple[dict[str, object], str]:
        match kind:
            case "create_task":
                task = CreateTaskRequest.model_validate(payload)
                due = f", due {task.due_date:%a %d %b}" if task.due_date else ""
                return _dump(task), f"Create task “{task.title}”{due}"
            case "create_reminder":
                payload.setdefault("timezone", timezone)
                reminder = CreateReminderRequest.model_validate(payload)
                return (
                    _dump(reminder),
                    f"Remind “{reminder.title}” on {reminder.start_date:%a %d %b} at "
                    f"{reminder.time_of_day:%H:%M}",
                )
            case "create_event":
                payload.setdefault("timezone", timezone)
                allowed = {
                    "title",
                    "start",
                    "end",
                    "timezone",
                    "all_day",
                    "description",
                    "location",
                }
                event = CreateEventRequest.model_validate(
                    {k: v for k, v in payload.items() if k in allowed}
                )
                when = (
                    f"{event.start:%a %d %b} (all day)"
                    if event.all_day
                    else f"{event.start:%a %d %b %H:%M} to {event.end:%H:%M}"
                )
                return _dump(event), f"Add event “{event.title}” on {when}"
            case "create_note":
                note = CreateNoteRequest.model_validate(
                    {"title": payload.get("title", ""), "text": payload.get("text", "")}
                )
                return _dump(note), f"Create note “{note.title or 'Untitled'}”"
            case "append_to_note":
                append = _AppendToNote.model_validate(payload)
                document_from_text(append.text)
                return _dump(append), "Add text to the end of a note"
            case "add_note_tags":
                tags = _AddNoteTags.model_validate(payload)
                names = [AddNoteTagRequest(name=t).name for t in tags.tags]
                return (
                    {"note_id": str(tags.note_id), "tags": names},
                    "Tag the note: " + ", ".join(names),
                )
            case "update_document_details":
                details = _UpdateDocumentDetails.model_validate(payload)
                fields = details.model_dump(exclude={"document_id"}, exclude_none=True)
                if not fields:
                    raise InvalidActionError("Nothing to change.")
                UpdateDocumentRequest.model_validate(fields)
                labels = ", ".join(k.replace("_", " ") for k in fields)
                return (
                    {"document_id": str(details.document_id), **fields},
                    f"Fill in the document's {labels}",
                )


def _dump(model: BaseModel) -> dict[str, object]:
    return cast(dict[str, object], model.model_dump(mode="json", exclude_unset=True))


class ModuleActionExecutor:
    def __init__(
        self,
        *,
        tasks: TaskService,
        reminders: ReminderService,
        calendar: CalendarService,
        notes: NoteService,
        documents: DocumentService,
    ) -> None:
        self._tasks = tasks
        self._reminders = reminders
        self._calendar = calendar
        self._notes = notes
        self._documents = documents

    async def execute(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        kind: ActionKind,
        payload: dict[str, object],
        timezone: str | None,
    ) -> ActionResult:
        try:
            return await self._execute(workspace_id, kind, payload, timezone)
        except (NoteNotFoundError, DocumentNotFoundError):
            raise InvalidActionError("The record no longer exists.") from None
        except ReminderInPastError:
            raise InvalidActionError("That time has already passed.") from None
        except RevisionConflictError:
            raise InvalidActionError("The note changed since this was proposed.") from None
        except TooManyTagsError:
            raise InvalidActionError("The note has as many tags as it can hold.") from None
        except (
            ReminderTaskNotFoundError,
            EventCategoryNotFoundError,
            EventNoteNotFoundError,
            EventTaskNotFoundError,
            FolderNotFoundError,
        ):
            raise InvalidActionError("A linked record no longer exists.") from None
        except ValueError as exc:
            # The modules' invalid-value errors (times, schedules) carry safe messages.
            raise InvalidActionError(str(exc) or "The proposed values aren't valid.") from None

    async def _execute(
        self,
        workspace_id: uuid.UUID,
        kind: ActionKind,
        payload: dict[str, object],
        timezone: str | None,
    ) -> ActionResult:
        match kind:
            case "create_task":
                task = await self._tasks.create(
                    workspace_id, CreateTaskRequest.model_validate(payload).to_draft()
                )
                return ActionResult(kind="task", id=task.id, title=task.title)
            case "create_reminder":
                view = await self._reminders.create(
                    workspace_id,
                    CreateReminderRequest.model_validate(payload).to_draft(),
                    default_timezone=timezone,
                )
                return ActionResult(kind="reminder", id=view.reminder.id, title=view.reminder.title)
            case "create_event":
                detail = await self._calendar.create_event(
                    workspace_id,
                    CreateEventRequest.model_validate(payload).to_draft(),
                    default_timezone=timezone,
                )
                return ActionResult(kind="event", id=detail.event.id, title=detail.event.title)
            case "create_note":
                note = await self._notes.create(
                    workspace_id, CreateNoteRequest.model_validate(payload).to_draft()
                )
                return ActionResult(
                    kind="note", id=note.note.id, title=note.note.title or "Untitled note"
                )
            case "append_to_note":
                append = _AppendToNote.model_validate(payload)
                note = await self._notes.get(workspace_id, append.note_id)
                document = _appended(note.content, append.text)
                detail = await self._notes.update(
                    workspace_id,
                    note.id,
                    NoteChanges(document=document, expected_revision=note.revision),
                )
                return ActionResult(
                    kind="note", id=detail.note.id, title=detail.note.title or "Untitled note"
                )
            case "add_note_tags":
                tags = _AddNoteTags.model_validate(payload)
                note = await self._notes.get(workspace_id, tags.note_id)
                for name in tags.tags:
                    await self._notes.add_tag(workspace_id, note.id, name)
                return ActionResult(kind="note", id=note.id, title=note.title or "Untitled note")
            case "update_document_details":
                details = _UpdateDocumentDetails.model_validate(payload)
                fields = details.model_dump(exclude={"document_id"}, exclude_none=True)
                changes = UpdateDocumentRequest.model_validate(fields).to_changes()
                document = await self._documents.update(workspace_id, details.document_id, changes)
                return ActionResult(kind="document", id=document.id, title=document.title)


def _appended(content: str, text: str) -> NoteDocument:
    """The note's document with `text` added as paragraphs at the end."""
    existing = load_document(content)
    current = cast(dict[str, object], json.loads(existing.json))
    added = cast(dict[str, object], json.loads(document_from_text(text).json))
    nodes = cast(list[object], current.get("content") or []) + cast(
        list[object], added.get("content") or []
    )
    return build_document({"type": "doc", "content": nodes})
