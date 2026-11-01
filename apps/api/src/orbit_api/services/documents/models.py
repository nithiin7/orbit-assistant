"""Document, folder, category, version, renewal, and link types, and the errors the service
raises."""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Final, Literal

from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.sorting import SortOrder

TITLE_MAX_LENGTH: Final = 200
FILENAME_MAX_LENGTH: Final = 255
MAX_FOLDER_DEPTH: Final = 8
MAX_CATEGORIES: Final = 50
MAX_TAGS: Final = 20
TAG_MAX_LENGTH: Final = 50
MAX_CUSTOM_FIELDS: Final = 20
MAX_REMINDER_DAYS: Final = 6
REMINDER_DAYS_LIMIT: Final = 365
DEFAULT_REMINDER_DAYS: Final[tuple[int, ...]] = (30, 7, 0)
DEFAULT_REMINDER_TIME: Final = time(9, 0)
# "Expiring soon" in counts and statuses, unless a view asks for another window.
EXPIRING_SOON_DAYS: Final = 30
RENEWAL_WINDOW_DAYS: Final = 90

# The file types documents accept, by extension.
ACCEPTED_EXTENSIONS: Final = frozenset(
    {"pdf", "jpg", "jpeg", "png", "webp", "docx", "xlsx", "pptx", "txt", "csv"}
)

DocumentState = Literal["active", "archived", "trashed"]
# Derived from the expiry date and today: `none` without one, `expired` before today,
# `expiring` within `EXPIRING_SOON_DAYS`, else `valid`.
ExpiryStatus = Literal["none", "valid", "expiring", "expired"]
DocumentSort = Literal["title", "created", "updated", "recent", "expiry", "size", "category"]
# Groups of file types for filtering; `none` is a document without a file.
FileKind = Literal["pdf", "image", "text", "office", "none"]
FolderDeleteMode = Literal["parent", "unfiled", "folder"]
LinkKind = Literal[
    "note",
    "task",
    "event",
    "transaction",
    "loan",
    "recurring_payment",
    "deposit",
    "holding",
    "asset",
]
CategoryIcon = Literal[
    "id-card",
    "briefcase",
    "wallet",
    "receipt",
    "landmark",
    "shield",
    "car",
    "home",
    "heart-pulse",
    "graduation-cap",
    "file-text",
    "plane",
    "badge-check",
    "folder",
]

FILE_KINDS: Final[dict[FileKind, frozenset[str]]] = {
    "pdf": frozenset({"pdf"}),
    "image": frozenset({"jpg", "jpeg", "png", "webp"}),
    "text": frozenset({"txt", "csv"}),
    "office": frozenset({"docx", "xlsx", "pptx"}),
    "none": frozenset(),
}

DEFAULT_CATEGORIES: Final[tuple[tuple[str, CategoryIcon], ...]] = (
    ("Identity Documents", "id-card"),
    ("Employment", "briefcase"),
    ("Salary & Payslips", "wallet"),
    ("Tax & Compliance", "landmark"),
    ("Banking", "landmark"),
    ("Insurance", "shield"),
    ("Vehicle Documents", "car"),
    ("Property", "home"),
    ("Medical Records", "heart-pulse"),
    ("Education & Certificates", "graduation-cap"),
    ("Receipts & Invoices", "receipt"),
    ("Warranties", "badge-check"),
    ("Travel", "plane"),
    ("Other", "folder"),
)


@dataclass(frozen=True, slots=True)
class CustomField:
    label: str
    value: str


@dataclass(frozen=True, slots=True)
class DocumentFile:
    """The current version's file, as copied onto the document for listing."""

    version_id: uuid.UUID
    filename: str
    extension: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime


@dataclass(frozen=True, slots=True)
class DocumentDetails:
    """The metadata a user maintains, separate from the file."""

    description: str = ""
    reference_number: str | None = None
    issuing_authority: str | None = None
    provider: str | None = None
    issue_date: date | None = None
    effective_date: date | None = None
    expiry_date: date | None = None
    renewal_date: date | None = None
    review_date: date | None = None
    amount: int | None = None
    currency: str | None = None
    notes: str = ""
    custom_fields: tuple[CustomField, ...] = ()


@dataclass(frozen=True, slots=True)
class ReminderSettings:
    """Days before each tracked date (expiry, renewal, review) to remind; empty turns
    reminders off."""

    days: tuple[int, ...] = DEFAULT_REMINDER_DAYS
    time_of_day: time = DEFAULT_REMINDER_TIME
    timezone: str = "UTC"


@dataclass(frozen=True, slots=True)
class Document:
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None
    category_id: uuid.UUID | None
    details: DocumentDetails
    reminders: ReminderSettings
    is_favorite: bool
    archived_at: datetime | None
    trashed_at: datetime | None
    file: DocumentFile | None
    version_count: int
    tags: tuple[str, ...]
    created_at: datetime
    updated_at: datetime
    last_opened_at: datetime | None

    @property
    def state(self) -> DocumentState:
        if self.trashed_at is not None:
            return "trashed"
        if self.archived_at is not None:
            return "archived"
        return "active"


@dataclass(frozen=True, slots=True)
class DocumentVersion:
    id: uuid.UUID
    workspace_id: uuid.UUID
    document_id: uuid.UUID
    number: int
    # The file's name in the attachment store; restored versions share their source's.
    blob_id: uuid.UUID
    filename: str
    extension: str
    content_type: str
    size_bytes: int
    sha256: str
    note: str
    restored_from: int | None
    uploaded_at: datetime


@dataclass(frozen=True, slots=True)
class DocumentRenewal:
    id: uuid.UUID
    workspace_id: uuid.UUID
    document_id: uuid.UUID
    previous_issue_date: date | None
    previous_expiry_date: date | None
    previous_renewal_date: date | None
    issue_date: date | None
    expiry_date: date | None
    renewal_date: date | None
    note: str
    renewed_at: datetime


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
    # Documents directly in the folder that aren't in the trash.
    document_count: int


@dataclass(frozen=True, slots=True)
class Category:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    icon: CategoryIcon
    position: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class CategoryUsage:
    category: Category
    # Documents in the category that aren't in the trash.
    document_count: int


@dataclass(frozen=True, slots=True)
class LinkTarget:
    kind: LinkKind
    id: uuid.UUID


@dataclass(frozen=True, slots=True)
class LinkedRecord:
    """A linked record as shown beside a document: its current title and a short detail."""

    kind: LinkKind
    id: uuid.UUID
    title: str
    detail: str
    linked_at: datetime


@dataclass(frozen=True, slots=True)
class DocumentDraft:
    title: str
    folder_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    details: DocumentDetails = field(default_factory=DocumentDetails)
    reminders: ReminderSettings | None = None
    tags: tuple[str, ...] = ()
    is_favorite: bool = False


@dataclass(frozen=True, slots=True)
class DocumentChanges:
    title: Change[str] = UNSET
    folder_id: Change[uuid.UUID | None] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET
    is_favorite: Change[bool] = UNSET
    archived: Change[bool] = UNSET
    description: Change[str] = UNSET
    reference_number: Change[str | None] = UNSET
    issuing_authority: Change[str | None] = UNSET
    provider: Change[str | None] = UNSET
    issue_date: Change[date | None] = UNSET
    effective_date: Change[date | None] = UNSET
    expiry_date: Change[date | None] = UNSET
    renewal_date: Change[date | None] = UNSET
    review_date: Change[date | None] = UNSET
    amount: Change[int | None] = UNSET
    currency: Change[str | None] = UNSET
    notes: Change[str] = UNSET
    custom_fields: Change[tuple[CustomField, ...]] = UNSET
    tags: Change[tuple[str, ...]] = UNSET
    reminder_days: Change[tuple[int, ...]] = UNSET
    reminder_time: Change[time] = UNSET
    timezone: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class RenewalDraft:
    expiry_date: date | None
    issue_date: Change[date | None] = UNSET
    renewal_date: Change[date | None] = UNSET
    note: str = ""


@dataclass(frozen=True, slots=True)
class DateRange:
    """Inclusive bounds; either may be open."""

    start: date | None = None
    end: date | None = None


@dataclass(frozen=True, slots=True)
class DocumentQuery:
    states: tuple[DocumentState, ...] = ("active",)
    # `None` is unfiled; `UNSET` is any folder.
    folder_id: Change[uuid.UUID | None] = UNSET
    include_subfolders: bool = False
    # `None` is unclassified; `UNSET` is any category.
    category_id: Change[uuid.UUID | None] = UNSET
    tag: str | None = None
    file_kind: FileKind | None = None
    favorite: bool | None = None
    created: DateRange = DateRange()
    expiry: DateRange = DateRange()
    renewal: DateRange = DateRange()
    linked: LinkTarget | None = None
    search: str | None = None
    sort: DocumentSort = "updated"
    order: SortOrder = "desc"
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True, slots=True)
class DocumentCounts:
    all: int
    favorites: int
    unfiled: int
    unclassified: int
    without_file: int
    expiring_7: int
    expiring_30: int
    expiring_90: int
    expired: int
    renewals: int
    archived: int
    trashed: int
    total_bytes: int


@dataclass(frozen=True, slots=True)
class DocumentOverview:
    counts: DocumentCounts
    recently_added: list[Document]
    recently_updated: list[Document]
    favorites: list[Document]
    expiring: list[Document]
    expired: list[Document]
    categories: list[CategoryUsage]


@dataclass(frozen=True, slots=True)
class StoredFile:
    """A file to export or download: its version and where its bytes are."""

    version: DocumentVersion
    blob_id: uuid.UUID


class DocumentNotFoundError(Exception):
    pass


class FolderNotFoundError(Exception):
    pass


class CategoryNotFoundError(Exception):
    pass


class VersionNotFoundError(Exception):
    pass


class FileMissingError(Exception):
    """The metadata exists but its stored file doesn't (deleted outside Orbit)."""


class LinkedRecordNotFoundError(Exception):
    """The record to link doesn't exist in the document's workspace."""


class FolderMoveError(Exception):
    """A folder can't go inside itself or a subfolder, or nest deeper than allowed."""


class CategoryNameTakenError(Exception):
    pass


class TooManyCategoriesError(Exception):
    pass


class DocumentNotTrashedError(Exception):
    """Only documents in the trash can be deleted permanently."""


class DocumentReadOnlyError(Exception):
    """Documents in the trash can't be changed until they're restored."""


class InvalidDocumentError(ValueError):
    """A rule a request model can't check alone, such as an amount without a currency."""


class FileRejectedError(Exception):
    """The file's type isn't accepted, or its contents don't match its extension."""
