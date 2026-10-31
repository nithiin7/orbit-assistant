"""Note types."""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal

from orbit_api.services.notes.content import NoteDocument
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.sorting import SortOrder

# A standard note, a quick capture, or a journal entry (one per day).
NoteType = Literal["note", "quick", "journal"]
# Active notes are neither archived nor in the trash. Archived notes are out of the way but
# kept; trashed notes wait to be restored or deleted for good.
NoteState = Literal["active", "archived", "trashed"]
NoteSort = Literal["updated_at", "created_at", "title", "recent", "journal_date"]
# What happens to a deleted folder's notes: move them up to its parent folder (subfolders move
# up too), to the Inbox, or to the trash (subfolders are deleted with it in those two cases).
FolderDeleteMode = Literal["parent", "inbox", "trash"]

TITLE_MAX_LENGTH = 200
FOLDER_NAME_MAX_LENGTH = 100
TAG_NAME_MAX_LENGTH = 50
# Folders deeper than this are hard to navigate and to show on a phone.
MAX_FOLDER_DEPTH = 8
MAX_TAGS_PER_NOTE = 50


@dataclass(frozen=True, slots=True)
class Note:
    id: uuid.UUID
    workspace_id: uuid.UUID
    # `None` is the Inbox (for notes and quick notes; journal entries live in the journal).
    folder_id: uuid.UUID | None
    note_type: NoteType
    title: str
    # The editor document as stored JSON (`content_format`); see `content.py`.
    content: str
    content_format: str
    plain_text: str
    journal_date: date | None
    is_pinned: bool
    is_favorite: bool
    archived_at: datetime | None
    trashed_at: datetime | None
    # Counts changes to the title or content; starts at 1.
    revision: int
    created_at: datetime
    # Changes only when the title or content changes, so "recently updated" means edited.
    updated_at: datetime
    last_opened_at: datetime | None


@dataclass(frozen=True, slots=True)
class Tag:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    normalized_name: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class TagUsage:
    tag: Tag
    # Active notes with the tag.
    note_count: int


@dataclass(frozen=True, slots=True)
class Folder:
    id: uuid.UUID
    workspace_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class FolderUsage:
    folder: Folder
    # Active notes directly in the folder, not in its subfolders.
    note_count: int


@dataclass(frozen=True, slots=True)
class NoteSummary:
    """A note in a list: everything but the document, with a short excerpt of its text."""

    note: Note
    tags: list[Tag]
    # The start of the text, or the text around the first search match.
    excerpt: str


@dataclass(frozen=True, slots=True)
class NoteDetail:
    note: Note
    tags: list[Tag]
    task_ids: list[uuid.UUID]


@dataclass(frozen=True, slots=True)
class NoteDraft:
    title: str = ""
    document: NoteDocument | None = None
    note_type: Literal["note", "quick"] = "note"
    folder_id: uuid.UUID | None = None
    tag_names: list[str] = field(default_factory=list[str])


@dataclass(frozen=True, slots=True)
class NoteChanges:
    """A partial update. `UNSET` leaves a field as it is; `folder_id=None` moves to the Inbox.

    `expected_revision`, when given, must equal the note's revision for a title or content change
    to apply; otherwise someone else's newer edit would be overwritten.
    """

    title: Change[str] = UNSET
    document: Change[NoteDocument] = UNSET
    expected_revision: int | None = None
    folder_id: Change[uuid.UUID | None] = UNSET
    note_type: Change[Literal["note", "quick"]] = UNSET
    is_pinned: Change[bool] = UNSET
    is_favorite: Change[bool] = UNSET
    archived: Change[bool] = UNSET


@dataclass(frozen=True, slots=True)
class NoteQuery:
    state: NoteState = "active"
    # `UNSET` is any folder; `None` is the Inbox (no folder).
    folder_id: Change[uuid.UUID | None] = UNSET
    tag_id: uuid.UUID | None = None
    note_types: frozenset[NoteType] = frozenset()
    task_id: uuid.UUID | None = None
    favorite: bool | None = None
    pinned: bool | None = None
    # Words that must each appear in the title, text, a tag, or the folder's name.
    search: str | None = None
    sort: NoteSort = "updated_at"
    order: SortOrder | None = None
    # Pinned notes first, then the sort.
    pinned_first: bool = False
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True, slots=True)
class NotePage:
    items: list[NoteSummary]
    # All notes matching the query, ignoring `limit` and `offset`.
    total: int


@dataclass(frozen=True, slots=True)
class NoteRef:
    """Enough of a note to show and open a link to it."""

    id: uuid.UUID
    title: str
    note_type: NoteType
    journal_date: date | None
    archived: bool


@dataclass(frozen=True, slots=True)
class NoteConnections:
    # Notes this note's content links to, and notes whose content links to it. Trashed notes
    # are left out of both.
    outgoing: list[NoteRef]
    backlinks: list[NoteRef]


@dataclass(frozen=True, slots=True)
class NoteCounts:
    all: int
    inbox: int
    favorites: int
    pinned: int
    journal: int
    archived: int
    trashed: int


@dataclass(frozen=True, slots=True)
class Attachment:
    id: uuid.UUID
    workspace_id: uuid.UUID
    note_id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


class NoteNotFoundError(Exception):
    """The note does not exist in this workspace."""


class FolderNotFoundError(Exception):
    """The folder does not exist in this workspace."""


class TagNotFoundError(Exception):
    """The tag does not exist in this workspace."""


class LinkedTaskNotFoundError(Exception):
    """The task does not exist in this workspace."""


class AttachmentNotFoundError(Exception):
    """The attachment does not exist on this note."""


class RevisionConflictError(Exception):
    """The note changed since the client loaded it. Carries the current note."""

    def __init__(self, current: Note) -> None:
        super().__init__("The note was changed elsewhere.")
        self.current = current


class FolderMoveError(Exception):
    """A folder can't move inside itself or one of its subfolders, or nest too deeply."""


class TagNameTakenError(Exception):
    """Another tag in the workspace has the same name (ignoring case and spacing)."""


class TooManyTagsError(Exception):
    """A note has the most tags allowed."""


class NoteNotTrashedError(Exception):
    """Only notes in the trash can be deleted permanently."""


class JournalChangeError(Exception):
    """Journal entries keep their type and date."""


class AttachmentRejectedError(Exception):
    """The file is too large or of a type notes don't accept. The message says which."""
