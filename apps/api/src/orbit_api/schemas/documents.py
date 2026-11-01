"""Document, folder, category, version, renewal, link, and export models.

Lists return `DocumentSummaryResponse`, which leaves out sensitive details (the reference
number, amount, notes, and custom fields); only a single document's response includes them.
"""

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import Name, SearchText, TimeZoneName, multi_line, single_line
from orbit_api.services.documents.expiry import expiry_status
from orbit_api.services.documents.models import (
    MAX_CUSTOM_FIELDS,
    MAX_REMINDER_DAYS,
    MAX_TAGS,
    REMINDER_DAYS_LIMIT,
    TAG_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    CategoryIcon,
    CategoryUsage,
    CustomField,
    Document,
    DocumentChanges,
    DocumentCounts,
    DocumentDetails,
    DocumentDraft,
    DocumentOverview,
    DocumentRenewal,
    DocumentSort,
    DocumentState,
    DocumentVersion,
    ExpiryStatus,
    FileKind,
    FolderDeleteMode,
    FolderUsage,
    LinkedRecord,
    LinkKind,
    ReminderSettings,
    RenewalDraft,
)
from orbit_api.services.documents.service import DocumentDetail, ExportSelection
from orbit_api.services.finance.money import MAX_AMOUNT, Currency
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.sorting import SortOrder

PAGE_MAX_SIZE = 100
EXPORT_MAX_DOCUMENTS = 500

Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=TITLE_MAX_LENGTH),
    AfterValidator(single_line),
]
Description = Annotated[str, StringConstraints(max_length=2000), AfterValidator(multi_line)]
LongNotes = Annotated[str, StringConstraints(max_length=10_000), AfterValidator(multi_line)]
ShortText = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(single_line)
]
Reference = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=100), AfterValidator(single_line)
]
VersionNote = Annotated[str, StringConstraints(max_length=500), AfterValidator(multi_line)]
CategoryName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
    AfterValidator(single_line),
]
TagName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=TAG_MAX_LENGTH),
    AfterValidator(single_line),
]
DocumentAmount = Annotated[
    int, Field(ge=0, le=MAX_AMOUNT, description="Minor units: ₹12.50 is 1250.")
]
ReminderDay = Annotated[int, Field(ge=0, le=REMINDER_DAYS_LIMIT)]


def _blank_to_none(value: str | None) -> str | None:
    return value or None


OptionalText = Annotated[ShortText | None, AfterValidator(_blank_to_none)]
OptionalReference = Annotated[Reference | None, AfterValidator(_blank_to_none)]


class DocumentCustomField(BaseModel):
    """A labelled detail the fixed fields don't cover, such as "Policy type"."""

    model_config = ConfigDict(extra="forbid")

    label: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
        AfterValidator(single_line),
    ]
    value: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=500), AfterValidator(single_line)
    ]

    def to_field(self) -> CustomField:
        return CustomField(self.label, self.value)


def _unique_days(days: list[int]) -> list[int]:
    if len(set(days)) != len(days):
        raise ValueError("reminder days must be different")
    return sorted(days, reverse=True)


ReminderDays = Annotated[
    list[ReminderDay], Field(max_length=MAX_REMINDER_DAYS), AfterValidator(_unique_days)
]


# Responses


class DocumentFileResponse(BaseModel):
    version_id: uuid.UUID
    filename: str = Field(description="The original file name, as uploaded.")
    extension: str
    content_type: str = Field(description="Detected from the file, not from the upload.")
    size_bytes: int
    uploaded_at: datetime


class _DocumentFields(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None = Field(description="`null` for unfiled documents.")
    category_id: uuid.UUID | None = Field(description="`null` for unclassified documents.")
    description: str
    issuing_authority: str | None
    provider: str | None
    issue_date: date | None
    expiry_date: date | None
    renewal_date: date | None
    review_date: date | None
    expiry_status: ExpiryStatus = Field(
        description="From the expiry date and today in the user's time zone: `expiring` "
        "within 30 days."
    )
    is_favorite: bool
    state: DocumentState
    archived_at: datetime | None
    trashed_at: datetime | None
    file: DocumentFileResponse | None = Field(
        description="The current version's file; `null` for a document without one."
    )
    version_count: int
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    last_opened_at: datetime | None

    @staticmethod
    def _fields(document: Document, today: date) -> dict[str, object]:
        details = document.details
        file = document.file
        return {
            "id": document.id,
            "workspace_id": document.workspace_id,
            "title": document.title,
            "folder_id": document.folder_id,
            "category_id": document.category_id,
            "description": details.description,
            "issuing_authority": details.issuing_authority,
            "provider": details.provider,
            "issue_date": details.issue_date,
            "expiry_date": details.expiry_date,
            "renewal_date": details.renewal_date,
            "review_date": details.review_date,
            "expiry_status": expiry_status(details.expiry_date, today),
            "is_favorite": document.is_favorite,
            "state": document.state,
            "archived_at": document.archived_at,
            "trashed_at": document.trashed_at,
            "file": (
                DocumentFileResponse(
                    version_id=file.version_id,
                    filename=file.filename,
                    extension=file.extension,
                    content_type=file.content_type,
                    size_bytes=file.size_bytes,
                    uploaded_at=file.uploaded_at,
                )
                if file
                else None
            ),
            "version_count": document.version_count,
            "tags": list(document.tags),
            "created_at": document.created_at,
            "updated_at": document.updated_at,
            "last_opened_at": document.last_opened_at,
        }


class DocumentSummaryResponse(_DocumentFields):
    """A document in a list, without its sensitive details."""

    @classmethod
    def of(cls, document: Document, today: date) -> "DocumentSummaryResponse":
        return cls.model_validate(cls._fields(document, today))


class DocumentResponse(_DocumentFields):
    """A single document with all its details."""

    reference_number: str | None = Field(
        description="A document number or reference. Sensitive: returned only here, never in "
        "lists, search results, or reminders."
    )
    effective_date: date | None
    amount: int | None = Field(description="Minor units, with `currency`.")
    currency: Currency | None
    notes: str
    custom_fields: list[DocumentCustomField]
    reminder_days: list[int] = Field(
        description="Days before the expiry, renewal, and review dates to remind; 0 is the day."
    )
    reminder_time: time
    timezone: str

    @classmethod
    def of(cls, document: Document, today: date) -> "DocumentResponse":
        details = document.details
        return cls.model_validate(
            {
                **cls._fields(document, today),
                "reference_number": details.reference_number,
                "effective_date": details.effective_date,
                "amount": details.amount,
                "currency": details.currency,
                "notes": details.notes,
                "custom_fields": [
                    DocumentCustomField(label=f.label, value=f.value) for f in details.custom_fields
                ],
                "reminder_days": list(document.reminders.days),
                "reminder_time": document.reminders.time_of_day,
                "timezone": document.reminders.timezone,
            }
        )


class DocumentVersionResponse(BaseModel):
    id: uuid.UUID
    number: int
    filename: str
    extension: str
    content_type: str
    size_bytes: int
    sha256: str = Field(description="SHA-256 of the file, to verify a download.")
    note: str
    restored_from: int | None = Field(description="The version this one restored, if any.")
    uploaded_at: datetime
    is_current: bool

    @classmethod
    def of(cls, version: DocumentVersion, current: bool) -> "DocumentVersionResponse":
        return cls(
            id=version.id,
            number=version.number,
            filename=version.filename,
            extension=version.extension,
            content_type=version.content_type,
            size_bytes=version.size_bytes,
            sha256=version.sha256,
            note=version.note,
            restored_from=version.restored_from,
            uploaded_at=version.uploaded_at,
            is_current=current,
        )


class DocumentRenewalResponse(BaseModel):
    id: uuid.UUID
    previous_issue_date: date | None
    previous_expiry_date: date | None
    previous_renewal_date: date | None
    issue_date: date | None
    expiry_date: date | None
    renewal_date: date | None
    note: str
    renewed_at: datetime

    @classmethod
    def of(cls, renewal: DocumentRenewal) -> "DocumentRenewalResponse":
        return cls(
            id=renewal.id,
            previous_issue_date=renewal.previous_issue_date,
            previous_expiry_date=renewal.previous_expiry_date,
            previous_renewal_date=renewal.previous_renewal_date,
            issue_date=renewal.issue_date,
            expiry_date=renewal.expiry_date,
            renewal_date=renewal.renewal_date,
            note=renewal.note,
            renewed_at=renewal.renewed_at,
        )


class DocumentLinkResponse(BaseModel):
    kind: LinkKind = Field(
        description="`note`, `task`, `event` (calendar), or a finance `transaction`, `loan`, "
        "`recurring_payment` (subscription or bill), `deposit`, `holding`, or `asset`."
    )
    id: uuid.UUID
    title: str
    detail: str = Field(description="A short description, such as a date or a kind.")
    linked_at: datetime

    @classmethod
    def of(cls, record: LinkedRecord) -> "DocumentLinkResponse":
        return cls(
            kind=record.kind,
            id=record.id,
            title=record.title,
            detail=record.detail,
            linked_at=record.linked_at,
        )


class DocumentDetailResponse(BaseModel):
    document: DocumentResponse
    versions: list[DocumentVersionResponse] = Field(description="Newest first.")
    renewals: list[DocumentRenewalResponse] = Field(description="Newest first.")
    links: list[DocumentLinkResponse]
    next_reminder_at: datetime | None = Field(
        description="When the next expiry, renewal, or review reminder fires."
    )

    @classmethod
    def of(cls, detail: DocumentDetail, today: date) -> "DocumentDetailResponse":
        current = detail.versions[0].id if detail.versions else None
        return cls(
            document=DocumentResponse.of(detail.document, today),
            versions=[DocumentVersionResponse.of(v, v.id == current) for v in detail.versions],
            renewals=[DocumentRenewalResponse.of(r) for r in detail.renewals],
            links=[DocumentLinkResponse.of(link) for link in detail.links],
            next_reminder_at=detail.next_reminder_at,
        )


class DocumentListResponse(BaseModel):
    documents: list[DocumentSummaryResponse]
    total: int


class DocumentCountsResponse(BaseModel):
    all: int = Field(description="Active documents (not archived or trashed).")
    favorites: int
    unfiled: int
    unclassified: int
    without_file: int
    expiring_7: int
    expiring_30: int
    expiring_90: int
    expired: int
    renewals: int = Field(description="Renewal dates in the next 90 days.")
    archived: int
    trashed: int
    total_bytes: int = Field(description="Stored size of every version, before deduplication.")

    @classmethod
    def of(cls, counts: DocumentCounts) -> "DocumentCountsResponse":
        return cls(
            all=counts.all,
            favorites=counts.favorites,
            unfiled=counts.unfiled,
            unclassified=counts.unclassified,
            without_file=counts.without_file,
            expiring_7=counts.expiring_7,
            expiring_30=counts.expiring_30,
            expiring_90=counts.expiring_90,
            expired=counts.expired,
            renewals=counts.renewals,
            archived=counts.archived,
            trashed=counts.trashed,
            total_bytes=counts.total_bytes,
        )


class DocumentCategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    icon: CategoryIcon
    position: int
    document_count: int = Field(description="Documents not in the trash.")

    @classmethod
    def of(cls, usage: CategoryUsage) -> "DocumentCategoryResponse":
        category = usage.category
        return cls(
            id=category.id,
            name=category.name,
            icon=category.icon,
            position=category.position,
            document_count=usage.document_count,
        )


class DocumentCategoryListResponse(BaseModel):
    categories: list[DocumentCategoryResponse]


class DocumentOverviewResponse(BaseModel):
    counts: DocumentCountsResponse
    recently_added: list[DocumentSummaryResponse]
    recently_updated: list[DocumentSummaryResponse]
    favorites: list[DocumentSummaryResponse]
    expiring: list[DocumentSummaryResponse] = Field(description="Expiring in the next 90 days.")
    expired: list[DocumentSummaryResponse]
    categories: list[DocumentCategoryResponse]

    @classmethod
    def of(cls, overview: DocumentOverview, today: date) -> "DocumentOverviewResponse":
        def summaries(items: list[Document]) -> list[DocumentSummaryResponse]:
            return [DocumentSummaryResponse.of(item, today) for item in items]

        return cls(
            counts=DocumentCountsResponse.of(overview.counts),
            recently_added=summaries(overview.recently_added),
            recently_updated=summaries(overview.recently_updated),
            favorites=summaries(overview.favorites),
            expiring=summaries(overview.expiring),
            expired=summaries(overview.expired),
            categories=[DocumentCategoryResponse.of(usage) for usage in overview.categories],
        )


class DocumentFolderResponse(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    document_count: int = Field(description="Documents directly in the folder, not trashed.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, usage: FolderUsage) -> "DocumentFolderResponse":
        folder = usage.folder
        return cls(
            id=folder.id,
            parent_id=folder.parent_id,
            name=folder.name,
            document_count=usage.document_count,
            created_at=folder.created_at,
            updated_at=folder.updated_at,
        )


class DocumentFolderListResponse(BaseModel):
    folders: list[DocumentFolderResponse] = Field(
        description="Every folder, flat; build the tree from `parent_id`."
    )


class DocumentTagResponse(BaseModel):
    name: str
    document_count: int


class DocumentTagListResponse(BaseModel):
    tags: list[DocumentTagResponse]


class DocumentLinkCandidatesResponse(BaseModel):
    records: list[DocumentLinkResponse] = Field(
        description="Records that can be linked; `linked_at` is when each was created."
    )


class DocumentSettingsResponse(BaseModel):
    max_bytes: int = Field(description="The largest file the server accepts.")
    accepted_extensions: list[str]


class EmptyDocumentTrashResponse(BaseModel):
    deleted: int


# Requests


class DocumentListParams(BaseModel):
    """Filters, search, sorting, and paging. Date windows (`expires_within`, `expired`,
    `renewal_within`) count from today in the user's time zone."""

    model_config = ConfigDict(extra="forbid")

    state: DocumentState | Literal["any"] = Field(
        default="active", description="`any` is everything except the trash."
    )
    folder_id: uuid.UUID | None = None
    include_subfolders: bool = Field(default=False, description="With `folder_id`.")
    unfiled: bool = Field(default=False, description="Only documents in no folder.")
    category_id: uuid.UUID | None = None
    unclassified: bool = Field(default=False, description="Only documents without a category.")
    tag: TagName | None = None
    file_kind: FileKind | None = Field(
        default=None, description="`pdf`, `image`, `text`, `office`, or `none` (no file)."
    )
    favorite: bool | None = None
    added_from: date | None = None
    added_to: date | None = None
    expires_from: date | None = None
    expires_to: date | None = None
    expires_within: int | None = Field(
        default=None, ge=0, le=3650, description="Expiring between today and this many days."
    )
    expired: bool = Field(default=False, description="Only documents whose expiry has passed.")
    renewal_within: int | None = Field(
        default=None, ge=0, le=3650, description="Renewal dates between today and this many days."
    )
    linked_kind: LinkKind | None = None
    linked_id: uuid.UUID | None = Field(
        default=None, description="With `linked_kind`: documents linked to that record."
    )
    q: SearchText = Field(
        default=None,
        description="Words that must each appear in the title, description, file name, issuer, "
        "provider, notes, a tag, the category, or the folder (case-insensitive). Reference "
        "numbers are not searched.",
    )
    sort: DocumentSort = "updated"
    order: SortOrder | None = Field(
        default=None, description="Newest or largest first by default; names and expiry ascending."
    )
    limit: int = Field(default=50, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.unfiled and self.folder_id is not None:
            raise ValueError("use either unfiled or folder_id, not both")
        if self.unclassified and self.category_id is not None:
            raise ValueError("use either unclassified or category_id, not both")
        if (self.linked_kind is None) != (self.linked_id is None):
            raise ValueError("linked_kind and linked_id go together")
        return self


class CreateDocumentRequest(BaseModel):
    """A document without a file (upload one later as its first version)."""

    model_config = ConfigDict(extra="forbid")

    title: Title
    folder_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    description: Description = ""
    reference_number: OptionalReference = None
    issuing_authority: OptionalText = None
    provider: OptionalText = None
    issue_date: date | None = None
    effective_date: date | None = None
    expiry_date: date | None = None
    renewal_date: date | None = None
    review_date: date | None = None
    amount: DocumentAmount | None = None
    currency: Currency | None = None
    notes: LongNotes = ""
    custom_fields: list[DocumentCustomField] = Field(
        default_factory=list[DocumentCustomField], max_length=MAX_CUSTOM_FIELDS
    )
    tags: list[TagName] = Field(default_factory=list[str], max_length=MAX_TAGS)
    is_favorite: bool = False
    reminder_days: ReminderDays | None = Field(
        default=None, description="Omit for the defaults: 30 and 7 days before, and on the day."
    )
    reminder_time: time | None = Field(default=None, description="09:00 by default.")
    timezone: TimeZoneName | None = Field(
        default=None, description="For reminders; the user's time zone by default."
    )

    def to_draft(self, default_timezone: str | None) -> DocumentDraft:
        settings = ReminderSettings(timezone=self.timezone or default_timezone or "UTC")
        if self.reminder_days is not None:
            settings = ReminderSettings(
                tuple(self.reminder_days), settings.time_of_day, settings.timezone
            )
        if self.reminder_time is not None:
            settings = ReminderSettings(settings.days, self.reminder_time, settings.timezone)
        return DocumentDraft(
            title=self.title,
            folder_id=self.folder_id,
            category_id=self.category_id,
            details=DocumentDetails(
                description=self.description,
                reference_number=self.reference_number,
                issuing_authority=self.issuing_authority,
                provider=self.provider,
                issue_date=self.issue_date,
                effective_date=self.effective_date,
                expiry_date=self.expiry_date,
                renewal_date=self.renewal_date,
                review_date=self.review_date,
                amount=self.amount,
                currency=self.currency,
                notes=self.notes,
                custom_fields=tuple(f.to_field() for f in self.custom_fields),
            ),
            reminders=settings,
            tags=tuple(self.tags),
            is_favorite=self.is_favorite,
        )


_NULLABLE = frozenset(
    {
        "folder_id",
        "category_id",
        "reference_number",
        "issuing_authority",
        "provider",
        "issue_date",
        "effective_date",
        "expiry_date",
        "renewal_date",
        "review_date",
        "amount",
        "currency",
    }
)


class UpdateDocumentRequest(BaseModel):
    """Change some of a document's fields. Omitted fields keep their values; `null` clears the
    optional ones (`folder_id: null` makes it unfiled)."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    folder_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    is_favorite: bool | None = None
    archived: bool | None = None
    description: Description | None = None
    reference_number: OptionalReference = None
    issuing_authority: OptionalText = None
    provider: OptionalText = None
    issue_date: date | None = None
    effective_date: date | None = None
    expiry_date: date | None = None
    renewal_date: date | None = None
    review_date: date | None = None
    amount: DocumentAmount | None = None
    currency: Currency | None = None
    notes: LongNotes | None = None
    custom_fields: list[DocumentCustomField] | None = Field(
        default=None, max_length=MAX_CUSTOM_FIELDS
    )
    tags: list[TagName] | None = Field(default=None, max_length=MAX_TAGS)
    reminder_days: ReminderDays | None = None
    reminder_time: time | None = None
    timezone: TimeZoneName | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set - _NULLABLE:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> DocumentChanges:
        provided = self.model_fields_set

        def given[T](name: str, value: T) -> Change[T]:
            return value if name in provided else UNSET

        def required[T](value: T | None) -> Change[T]:
            # Checked in `_check_fields`: a provided non-nullable field is never `None`.
            return UNSET if value is None else value

        return DocumentChanges(
            title=required(self.title),
            folder_id=given("folder_id", self.folder_id),
            category_id=given("category_id", self.category_id),
            is_favorite=required(self.is_favorite),
            archived=required(self.archived),
            description=required(self.description),
            reference_number=given("reference_number", self.reference_number),
            issuing_authority=given("issuing_authority", self.issuing_authority),
            provider=given("provider", self.provider),
            issue_date=given("issue_date", self.issue_date),
            effective_date=given("effective_date", self.effective_date),
            expiry_date=given("expiry_date", self.expiry_date),
            renewal_date=given("renewal_date", self.renewal_date),
            review_date=given("review_date", self.review_date),
            amount=given("amount", self.amount),
            currency=given("currency", self.currency),
            notes=required(self.notes),
            custom_fields=(
                UNSET
                if self.custom_fields is None
                else tuple(f.to_field() for f in self.custom_fields)
            ),
            tags=UNSET if self.tags is None else tuple(self.tags),
            reminder_days=UNSET if self.reminder_days is None else tuple(self.reminder_days),
            reminder_time=required(self.reminder_time),
            timezone=required(self.timezone),
        )


class UploadDocumentParams(BaseModel):
    """The request body is the file itself."""

    model_config = ConfigDict(extra="forbid")

    filename: Annotated[str, StringConstraints(min_length=1, max_length=1000)] = Field(
        description="The file's name (a name, not a path). Its extension decides the type."
    )
    title: Title | None = Field(default=None, description="The file's name by default.")
    folder_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None


class UploadVersionParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    note: Annotated[str, StringConstraints(max_length=500)] = Field(
        default="", description="What changed, for the version history."
    )


class RenewDocumentRequest(BaseModel):
    """The new dates. The old ones are kept in the renewal history."""

    model_config = ConfigDict(extra="forbid")

    expiry_date: date | None = Field(description="The new expiry date, or `null` for none.")
    issue_date: date | None = Field(default=None, description="Omit to keep the current one.")
    renewal_date: date | None = Field(default=None, description="Omit to keep the current one.")
    note: VersionNote = ""

    def to_draft(self) -> RenewalDraft:
        provided = self.model_fields_set
        return RenewalDraft(
            expiry_date=self.expiry_date,
            issue_date=self.issue_date if "issue_date" in provided else UNSET,
            renewal_date=self.renewal_date if "renewal_date" in provided else UNSET,
            note=self.note,
        )


class CreateDocumentFolderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    parent_id: uuid.UUID | None = None


class UpdateDocumentFolderRequest(BaseModel):
    """Rename, move (`parent_id: null` moves it to the top level), or both."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    parent_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class DeleteDocumentFolderParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    documents: FolderDeleteMode = Field(
        description="`parent` moves the folder's documents and subfolders up a level; "
        "`unfiled` deletes its subfolders too and leaves every document inside unfiled; "
        "`folder` does the same but moves them to `target_id`."
    )
    target_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if (self.documents == "folder") != (self.target_id is not None):
            raise ValueError("target_id is required with documents=folder, and only then")
        return self


class CreateDocumentCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName
    icon: CategoryIcon = "folder"


class UpdateDocumentCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName | None = None
    icon: CategoryIcon | None = None


class DocumentLinkCandidatesParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: LinkKind
    q: SearchText = None
    limit: int = Field(default=20, ge=1, le=50)


class ExportDocumentsRequest(BaseModel):
    """Choose documents, a folder (with its subfolders), or a category; with none of them,
    every document that isn't in the trash."""

    model_config = ConfigDict(extra="forbid")

    document_ids: list[uuid.UUID] = Field(
        default_factory=list[uuid.UUID], max_length=EXPORT_MAX_DOCUMENTS
    )
    folder_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    include_versions: bool = Field(default=False, description="Earlier versions as well.")

    @model_validator(mode="after")
    def _check(self) -> Self:
        chosen = sum(
            (bool(self.document_ids), self.folder_id is not None, self.category_id is not None)
        )
        if chosen > 1:
            raise ValueError("choose documents, a folder, or a category, not several")
        return self

    def to_selection(self) -> ExportSelection:
        return ExportSelection(
            document_ids=tuple(self.document_ids),
            folder_id=self.folder_id,
            category_id=self.category_id,
            include_versions=self.include_versions,
        )
