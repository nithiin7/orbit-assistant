"""Note, folder, tag, journal, and attachment models."""

import json
import uuid
from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    PrivateAttr,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import Name, SearchText, multi_line, single_line
from orbit_api.services.notes.content import (
    CONTENT_FORMAT,
    InvalidDocumentError,
    NoteDocument,
    build_document,
    document_from_text,
)
from orbit_api.services.notes.models import (
    MAX_TAGS_PER_NOTE,
    TAG_NAME_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    Attachment,
    FolderDeleteMode,
    FolderUsage,
    Note,
    NoteChanges,
    NoteConnections,
    NoteCounts,
    NoteDetail,
    NoteDraft,
    NoteQuery,
    NoteRef,
    NoteSort,
    NoteState,
    NoteSummary,
    NoteType,
    Tag,
    TagUsage,
)
from orbit_api.services.notes.service import clean_tag_name
from orbit_api.utils.changes import UNSET
from orbit_api.utils.sorting import SortOrder

PAGE_MAX_SIZE = 100
QUICK_TEXT_MAX_LENGTH = 20_000

# The editor document (ProseMirror JSON), validated by `services/notes/content.py`.
NoteContent = dict[str, JsonValue]

Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=TITLE_MAX_LENGTH),
    AfterValidator(single_line),
]


def _tag_name(value: str) -> str:
    cleaned = clean_tag_name(single_line(value))
    if not cleaned:
        raise ValueError("must not be blank")
    if len(cleaned) > TAG_NAME_MAX_LENGTH:
        raise ValueError(f"must be at most {TAG_NAME_MAX_LENGTH} characters")
    return cleaned


TagName = Annotated[str, StringConstraints(max_length=200), AfterValidator(_tag_name)]


def _document(content: NoteContent) -> NoteDocument:
    try:
        return build_document(content)
    except InvalidDocumentError as error:
        raise ValueError(f"content {error}") from None


class TagRef(BaseModel):
    id: uuid.UUID
    name: str

    @classmethod
    def of(cls, tag: Tag) -> "TagRef":
        return cls(id=tag.id, name=tag.name)


class _NoteFields(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    folder_id: uuid.UUID | None = Field(description="`null` for notes in the Inbox.")
    note_type: NoteType
    title: str = Field(description="May be empty; journal entries are usually named by date.")
    journal_date: date | None = Field(description="The entry's day, for journal entries only.")
    is_pinned: bool
    is_favorite: bool
    archived_at: datetime | None
    trashed_at: datetime | None
    revision: int = Field(
        description="Counts title and content changes. Send it back as `expected_revision`."
    )
    created_at: datetime
    updated_at: datetime = Field(description="When the title or content last changed.")
    last_opened_at: datetime | None
    tags: list[TagRef]

    @staticmethod
    def _fields(note: Note, tags: list[Tag]) -> dict[str, object]:
        return {
            "id": note.id,
            "workspace_id": note.workspace_id,
            "folder_id": note.folder_id,
            "note_type": note.note_type,
            "title": note.title,
            "journal_date": note.journal_date,
            "is_pinned": note.is_pinned,
            "is_favorite": note.is_favorite,
            "archived_at": note.archived_at,
            "trashed_at": note.trashed_at,
            "revision": note.revision,
            "created_at": note.created_at,
            "updated_at": note.updated_at,
            "last_opened_at": note.last_opened_at,
            "tags": [TagRef.of(tag) for tag in tags],
        }


class NoteResponse(_NoteFields):
    content: NoteContent = Field(description="The editor document (ProseMirror JSON).")
    content_format: str = Field(description=f"Currently always `{CONTENT_FORMAT}`.")
    task_ids: list[uuid.UUID] = Field(description="Tasks linked to the note, oldest link first.")

    @classmethod
    def of(cls, detail: NoteDetail) -> "NoteResponse":
        content: NoteContent = json.loads(detail.note.content)
        return cls.model_validate(
            cls._fields(detail.note, detail.tags)
            | {
                "content": content,
                "content_format": detail.note.content_format,
                "task_ids": detail.task_ids,
            }
        )


class NoteSummaryResponse(_NoteFields):
    excerpt: str = Field(
        description="The start of the text, or the text around the first search match."
    )

    @classmethod
    def of(cls, summary: NoteSummary) -> "NoteSummaryResponse":
        return cls.model_validate(
            cls._fields(summary.note, summary.tags) | {"excerpt": summary.excerpt}
        )


class NoteListResponse(BaseModel):
    notes: list[NoteSummaryResponse]
    total: int = Field(description="Notes matching the filters, across all pages.")


class NoteListParams(BaseModel):
    """Filters, search, sorting, and paging for listing notes."""

    model_config = ConfigDict(extra="forbid")

    state: NoteState = Field(
        default="active", description="Active notes, the archive, or the trash."
    )
    folder_id: uuid.UUID | None = Field(default=None, description="Notes directly in a folder.")
    inbox: bool = Field(default=False, description="Only notes in no folder.")
    type: list[NoteType] = Field(
        default_factory=list[NoteType], description="Repeat for several types. Omit for all."
    )
    tag_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = Field(default=None, description="Notes linked to this task.")
    favorite: bool | None = None
    pinned: bool | None = None
    q: SearchText = Field(
        default=None,
        description="Words that must each appear in the title, text, a tag, or the folder name "
        "(case-insensitive).",
    )
    sort: NoteSort = "updated_at"
    order: SortOrder | None = Field(
        default=None, description="Newest first by default; titles A to Z."
    )
    pinned_first: bool = False
    limit: int = Field(default=50, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _check_folder(self) -> Self:
        if self.inbox and self.folder_id is not None:
            raise ValueError("use either inbox or folder_id, not both")
        return self

    def to_query(self) -> NoteQuery:
        return NoteQuery(
            state=self.state,
            folder_id=None if self.inbox else self.folder_id if self.folder_id else UNSET,
            tag_id=self.tag_id,
            note_types=frozenset(self.type),
            task_id=self.task_id,
            favorite=self.favorite,
            pinned=self.pinned,
            search=self.q,
            sort=self.sort,
            order=self.order,
            pinned_first=self.pinned_first,
            limit=self.limit,
            offset=self.offset,
        )


class NoteCountsResponse(BaseModel):
    all: int = Field(
        description="Active notes and quick notes (journal entries are counted apart)."
    )
    inbox: int
    favorites: int
    pinned: int
    journal: int
    archived: int
    trashed: int

    @classmethod
    def of(cls, counts: NoteCounts) -> "NoteCountsResponse":
        return cls(
            all=counts.all,
            inbox=counts.inbox,
            favorites=counts.favorites,
            pinned=counts.pinned,
            journal=counts.journal,
            archived=counts.archived,
            trashed=counts.trashed,
        )


class CreateNoteRequest(BaseModel):
    """A new note. Give `content` (an editor document) or `text` (plain text, one paragraph per
    line, for quick capture), or neither for an empty note."""

    model_config = ConfigDict(extra="forbid")

    title: Title = ""
    content: NoteContent | None = None
    text: (
        Annotated[
            str, StringConstraints(max_length=QUICK_TEXT_MAX_LENGTH), AfterValidator(multi_line)
        ]
        | None
    ) = None
    note_type: Literal["note", "quick"] = "note"
    folder_id: uuid.UUID | None = None
    tags: list[TagName] = Field(default_factory=list[str], max_length=MAX_TAGS_PER_NOTE)

    _document: NoteDocument | None = PrivateAttr(default=None)

    @model_validator(mode="after")
    def _check_content(self) -> Self:
        if self.content is not None and self.text is not None:
            raise ValueError("send content or text, not both")
        if self.content is not None:
            self._document = _document(self.content)
        elif self.text is not None:
            self._document = document_from_text(self.text)
        return self

    def to_draft(self) -> NoteDraft:
        return NoteDraft(
            title=self.title,
            document=self._document,
            note_type=self.note_type,
            folder_id=self.folder_id,
            tag_names=list(self.tags),
        )


class UpdateNoteRequest(BaseModel):
    """Change some of a note's fields. Omitted fields keep their values; `folder_id: null` moves
    the note to the Inbox. Send `expected_revision` with title or content changes: if the note
    has changed since, the update is refused with 409 rather than overwriting it."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    content: NoteContent | None = None
    expected_revision: int | None = Field(default=None, ge=1)
    folder_id: uuid.UUID | None = None
    note_type: Literal["note", "quick"] | None = None
    is_pinned: bool | None = None
    is_favorite: bool | None = None
    archived: bool | None = None

    _document: NoteDocument | None = PrivateAttr(default=None)

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        changes = self.model_fields_set - {"expected_revision"}
        if not changes:
            raise ValueError("include at least one field to change")
        for name in changes - {"folder_id"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        if self.content is not None:
            self._document = _document(self.content)
        return self

    def to_changes(self) -> NoteChanges:
        provided = self.model_fields_set
        return NoteChanges(
            title=self.title if self.title is not None else UNSET,
            document=self._document if self._document is not None else UNSET,
            expected_revision=self.expected_revision,
            folder_id=self.folder_id if "folder_id" in provided else UNSET,
            note_type=self.note_type if self.note_type is not None else UNSET,
            is_pinned=self.is_pinned if self.is_pinned is not None else UNSET,
            is_favorite=self.is_favorite if self.is_favorite is not None else UNSET,
            archived=self.archived if self.archived is not None else UNSET,
        )


class EmptyTrashResponse(BaseModel):
    deleted: int


class NoteRefResponse(BaseModel):
    id: uuid.UUID
    title: str
    note_type: NoteType
    journal_date: date | None
    archived: bool

    @classmethod
    def of(cls, ref: NoteRef) -> "NoteRefResponse":
        return cls(
            id=ref.id,
            title=ref.title,
            note_type=ref.note_type,
            journal_date=ref.journal_date,
            archived=ref.archived,
        )


class NoteConnectionsResponse(BaseModel):
    outgoing: list[NoteRefResponse] = Field(description="Notes this note links to.")
    backlinks: list[NoteRefResponse] = Field(description="Notes that link to this note.")

    @classmethod
    def of(cls, connections: NoteConnections) -> "NoteConnectionsResponse":
        return cls(
            outgoing=[NoteRefResponse.of(ref) for ref in connections.outgoing],
            backlinks=[NoteRefResponse.of(ref) for ref in connections.backlinks],
        )


class AddNoteTagRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TagName = Field(description="An existing tag's name (any case) or a new tag's.")


class NoteTagsResponse(BaseModel):
    tags: list[TagRef]


class TagResponse(BaseModel):
    id: uuid.UUID
    name: str
    note_count: int = Field(description="Active notes with the tag.")
    created_at: datetime

    @classmethod
    def of(cls, usage: TagUsage) -> "TagResponse":
        return cls(
            id=usage.tag.id,
            name=usage.tag.name,
            note_count=usage.note_count,
            created_at=usage.tag.created_at,
        )


class TagListResponse(BaseModel):
    tags: list[TagResponse]


class TagRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TagName


class FolderResponse(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    note_count: int = Field(description="Active notes directly in the folder.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, usage: FolderUsage) -> "FolderResponse":
        folder = usage.folder
        return cls(
            id=folder.id,
            parent_id=folder.parent_id,
            name=folder.name,
            note_count=usage.note_count,
            created_at=folder.created_at,
            updated_at=folder.updated_at,
        )


class FolderListResponse(BaseModel):
    folders: list[FolderResponse] = Field(description="Every folder, by name; build the tree.")


class CreateFolderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    parent_id: uuid.UUID | None = None


class UpdateFolderRequest(BaseModel):
    """Rename or move a folder. `parent_id: null` moves it to the top level."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    parent_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class DeleteFolderParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: FolderDeleteMode = Field(
        description="`parent`: notes and subfolders move up a level. `inbox` or `trash`: the "
        "folder and its subfolders are deleted and all their notes go to the Inbox or the trash."
    )


class AttachmentResponse(BaseModel):
    id: uuid.UUID
    note_id: uuid.UUID
    filename: str
    content_type: str = Field(description="Decided by Orbit from the file, not the upload.")
    size_bytes: int
    created_at: datetime

    @classmethod
    def of(cls, attachment: Attachment) -> "AttachmentResponse":
        return cls(
            id=attachment.id,
            note_id=attachment.note_id,
            filename=attachment.filename,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            created_at=attachment.created_at,
        )


class AttachmentListResponse(BaseModel):
    attachments: list[AttachmentResponse]
    max_bytes: int = Field(description="The largest file this server accepts.")


def _file_name(value: str) -> str:
    value = single_line(value)
    if "/" in value or "\\" in value or value in {".", ".."}:
        raise ValueError("must be a file name, not a path")
    return value


class UploadAttachmentParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
        AfterValidator(_file_name),
    ]
