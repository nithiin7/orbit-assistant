"""What the index can hold, read through each module's own service.

The catalog lists records with a fingerprint of what would be indexed (so unchanged records are
never embedded again), loads one record's text for indexing, and answers whether a record still
exists and is readable. Retrieval asks the last question about every match before showing it, so
an index that hasn't caught up with a deletion or a trash can't surface the record.

What is indexed per record:

- notes (active, not archived or trashed): title, tags, and text split at headings;
- documents (active or archived): title, descriptive metadata, and the file's text where it can
  be read (PDF pages, Word headings, slides). Reference numbers are left out, as in search;
- tasks, events (series, not each occurrence), and habits: a short description of each.
"""

import hashlib
import uuid
from collections.abc import Awaitable, Callable, Iterable, Sequence
from datetime import date
from pathlib import Path
from typing import Final, Protocol

import anyio.to_thread

from orbit_api.services.ai.chunking import note_sections
from orbit_api.services.ai.extraction import ExtractionError, can_extract, extract_sections
from orbit_api.services.ai.models import SourceContent, SourceSection, SourceStamp, SourceType
from orbit_api.services.calendar.models import (
    CalendarEvent,
    EventDetail,
    EventNotFoundError,
    EventPage,
    EventQuery,
)
from orbit_api.services.documents.models import (
    Document,
    DocumentNotFoundError,
    DocumentQuery,
    DocumentVersion,
    FileMissingError,
    VersionNotFoundError,
)
from orbit_api.services.habits.models import (
    Habit,
    HabitDetail,
    HabitNotFoundError,
    HabitProgress,
    HabitStatus,
)
from orbit_api.services.notes.models import Note, NoteNotFoundError, NotePage, NoteQuery
from orbit_api.services.tasks.models import Task, TaskNotFoundError, TaskPage, TaskQuery

PAGE: Final = 200
# The most records of one type indexed per workspace.
MAX_PER_TYPE: Final = 5000


class TaskReader(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage: ...

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task: ...


class NoteReader(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> NotePage: ...

    async def get(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> Note: ...


class EventReader(Protocol):
    async def find_events(self, workspace_id: uuid.UUID, query: EventQuery) -> EventPage: ...

    async def get_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> EventDetail: ...


class DocumentReader(Protocol):
    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]: ...

    async def get(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document: ...

    async def open_file(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, version_id: uuid.UUID | None
    ) -> tuple[DocumentVersion, Path]: ...


class HabitReader(Protocol):
    async def find(
        self, workspace_id: uuid.UUID, statuses: Sequence[HabitStatus] | None
    ) -> list[HabitProgress]: ...

    async def get(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> HabitDetail: ...


async def read_file(path: Path) -> bytes:
    return await anyio.to_thread.run_sync(path.read_bytes)


class SourceCatalog:
    def __init__(
        self,
        *,
        tasks: TaskReader,
        notes: NoteReader,
        events: EventReader,
        documents: DocumentReader,
        habits: HabitReader,
        read: Callable[[Path], Awaitable[bytes]] = read_file,
    ) -> None:
        self._tasks = tasks
        self._notes = notes
        self._events = events
        self._documents = documents
        self._habits = habits
        self._read = read

    async def stamps(
        self, workspace_id: uuid.UUID, types: Iterable[SourceType]
    ) -> list[SourceStamp]:
        wanted = set(types)
        stamps: list[SourceStamp] = []
        if "note" in wanted:
            stamps += await self._note_stamps(workspace_id)
        if "document" in wanted:
            stamps += await self._document_stamps(workspace_id)
        if "task" in wanted:
            stamps += await self._task_stamps(workspace_id)
        if "event" in wanted:
            stamps += await self._event_stamps(workspace_id)
        if "habit" in wanted:
            stamps += [
                _stamp("habit", p.habit.id, p.habit.name, None, _habit_text(p.habit))
                for p in (await self._habits.find(workspace_id, None))[:MAX_PER_TYPE]
            ]
        return stamps

    async def load(
        self, workspace_id: uuid.UUID, source_type: SourceType, source_id: uuid.UUID
    ) -> SourceContent | None:
        """The record's indexable text, or `None` if it no longer exists or isn't indexable
        (trashed, archived note)."""
        try:
            match source_type:
                case "note":
                    note = await self._notes.get(workspace_id, source_id)
                    if not _note_indexable(note):
                        return None
                    return SourceContent(
                        source_type="note",
                        source_id=note.id,
                        title=note.title or "Untitled note",
                        day=_note_day(note),
                        sections=note_sections(note.title, note.content, note.plain_text),
                    )
                case "document":
                    return await self._load_document(workspace_id, source_id)
                case "task":
                    task = await self._tasks.get(workspace_id, source_id)
                    return _single("task", task.id, task.title, task.due_date, _task_text(task))
                case "event":
                    event = (await self._events.get_event(workspace_id, source_id)).event
                    return _single(
                        "event", event.id, event.title, event.start.date(), _event_text(event)
                    )
                case "habit":
                    habit = (await self._habits.get(workspace_id, source_id)).progress.habit
                    return _single("habit", habit.id, habit.name, None, _habit_text(habit))
        except (
            NoteNotFoundError,
            DocumentNotFoundError,
            TaskNotFoundError,
            EventNotFoundError,
            HabitNotFoundError,
        ):
            return None

    async def exists(
        self, workspace_id: uuid.UUID, source_type: SourceType, source_id: uuid.UUID
    ) -> bool:
        """Whether the record still exists in this workspace and may be shown."""
        try:
            match source_type:
                case "note":
                    return _note_indexable(await self._notes.get(workspace_id, source_id))
                case "document":
                    document = await self._documents.get(workspace_id, source_id)
                    return document.trashed_at is None
                case "task":
                    await self._tasks.get(workspace_id, source_id)
                case "event":
                    await self._events.get_event(workspace_id, source_id)
                case "habit":
                    await self._habits.get(workspace_id, source_id)
        except (
            NoteNotFoundError,
            DocumentNotFoundError,
            TaskNotFoundError,
            EventNotFoundError,
            HabitNotFoundError,
        ):
            return False
        return True

    async def _note_stamps(self, workspace_id: uuid.UUID) -> list[SourceStamp]:
        stamps: list[SourceStamp] = []
        offset = 0
        while offset < MAX_PER_TYPE:
            page = await self._notes.find(
                workspace_id, NoteQuery(state="active", limit=PAGE, offset=offset)
            )
            for item in page.items:
                note = item.note
                tags = ",".join(sorted(tag.normalized_name for tag in item.tags))
                # The revision changes with every edit to the title or content.
                stamps.append(
                    _stamp(
                        "note",
                        note.id,
                        note.title or "Untitled note",
                        _note_day(note),
                        f"{note.revision}|{note.title}|{tags}",
                    )
                )
            offset += PAGE
            if offset >= page.total:
                break
        return stamps

    async def _document_stamps(self, workspace_id: uuid.UUID) -> list[SourceStamp]:
        stamps: list[SourceStamp] = []
        offset = 0
        while offset < MAX_PER_TYPE:
            documents, total = await self._documents.find(
                workspace_id,
                DocumentQuery(states=("active", "archived"), limit=PAGE, offset=offset),
            )
            for document in documents:
                version = document.file.version_id if document.file else None
                stamps.append(
                    _stamp(
                        "document",
                        document.id,
                        document.title,
                        _document_day(document),
                        f"{_document_header(document)}|{version}",
                    )
                )
            offset += PAGE
            if offset >= total:
                break
        return stamps

    async def _task_stamps(self, workspace_id: uuid.UUID) -> list[SourceStamp]:
        stamps: list[SourceStamp] = []
        offset = 0
        while offset < MAX_PER_TYPE:
            page = await self._tasks.find(workspace_id, TaskQuery(limit=PAGE, offset=offset))
            stamps += [_stamp("task", t.id, t.title, t.due_date, _task_text(t)) for t in page.tasks]
            offset += PAGE
            if offset >= page.total:
                break
        return stamps

    async def _event_stamps(self, workspace_id: uuid.UUID) -> list[SourceStamp]:
        stamps: list[SourceStamp] = []
        offset = 0
        while offset < MAX_PER_TYPE:
            page = await self._events.find_events(
                workspace_id, EventQuery(limit=PAGE, offset=offset)
            )
            stamps += [
                _stamp("event", e.id, e.title, e.start.date(), _event_text(e)) for e in page.events
            ]
            offset += PAGE
            if offset >= page.total:
                break
        return stamps

    async def _load_document(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID
    ) -> SourceContent | None:
        document = await self._documents.get(workspace_id, document_id)
        if document.trashed_at is not None:
            return None
        sections = [SourceSection(location="Details", text=_document_header(document))]
        sections += await self.document_text(workspace_id, document)
        return SourceContent(
            source_type="document",
            source_id=document.id,
            title=document.title,
            day=_document_day(document),
            sections=sections,
        )

    async def document_text(
        self, workspace_id: uuid.UUID, document: Document
    ) -> list[SourceSection]:
        """The current file's text, located by page or heading; empty when the file can't be
        read (no file, an image, a scanned PDF, a damaged file)."""
        if document.file is None or not can_extract(document.file.extension):
            return []
        try:
            version, path = await self._documents.open_file(workspace_id, document.id, None)
            data = await self._read(path)
            return await anyio.to_thread.run_sync(extract_sections, version.extension, data)
        except (VersionNotFoundError, FileMissingError, ExtractionError, OSError):
            return []


def _note_indexable(note: Note) -> bool:
    return note.trashed_at is None and note.archived_at is None


def _note_day(note: Note) -> date:
    return note.journal_date or note.updated_at.date()


def _document_day(document: Document) -> date:
    return document.details.issue_date or document.created_at.date()


def _document_header(document: Document) -> str:
    details = document.details
    lines = [f"Document: {document.title}"]
    for label, value in (
        ("Description", details.description),
        ("Issued by", details.issuing_authority),
        ("Provider", details.provider),
        ("Issued", details.issue_date),
        ("Effective", details.effective_date),
        ("Expires", details.expiry_date),
        ("Renewal", details.renewal_date),
        ("Review", details.review_date),
        ("Notes", details.notes),
        ("Tags", ", ".join(document.tags)),
    ):
        if value:
            lines.append(f"{label}: {value}")
    return "\n".join(lines)


def _task_text(task: Task) -> str:
    lines = [f"Task: {task.title}", f"Status: {task.status}", f"Priority: {task.priority}"]
    if task.due_date:
        lines.append(f"Due: {task.due_date.isoformat()}")
    if task.description:
        lines.append(task.description)
    return "\n".join(lines)


def _event_text(event: CalendarEvent) -> str:
    when = (
        f"{event.start:%Y-%m-%d} (all day)"
        if event.all_day
        else f"{event.start:%Y-%m-%d %H:%M} to {event.end:%H:%M} ({event.timezone})"
    )
    lines = [f"Event: {event.title}", f"When: {when}"]
    if event.recurrence is not None:
        lines.append("Repeats")
    if event.location:
        lines.append(f"Where: {event.location}")
    if event.status != "confirmed":
        lines.append(f"Status: {event.status}")
    if event.description:
        lines.append(event.description)
    return "\n".join(lines)


def _habit_text(habit: Habit) -> str:
    lines = [f"Habit: {habit.name}", f"Status: {habit.status}"]
    if habit.target is not None:
        lines.append(f"Target: {habit.target:g} {habit.unit}".strip())
    if habit.description:
        lines.append(habit.description)
    return "\n".join(lines)


def _stamp(
    source_type: SourceType, source_id: uuid.UUID, title: str, day: date | None, basis: str
) -> SourceStamp:
    return SourceStamp(
        source_type=source_type,
        source_id=source_id,
        title=title[:300],
        day=day,
        content_hash=hashlib.sha256(basis.encode()).hexdigest(),
    )


def _single(
    source_type: SourceType, source_id: uuid.UUID, title: str, day: date | None, text: str
) -> SourceContent:
    return SourceContent(
        source_type=source_type,
        source_id=source_id,
        title=title,
        day=day,
        sections=[SourceSection(location="Details", text=text)],
    )
