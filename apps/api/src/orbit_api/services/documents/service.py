"""Documents: the personal vault. Folders, categories, documents and their metadata, file
versions, tags, renewals, links to other modules, expiry reminders, and export.

Every method takes a `workspace_id` that the caller has already authorized (`WorkspaceDep`), and
the store filters every query by it, so an ID from another workspace behaves like a missing one.

- **Files** live in the attachment store, never in the database. A version names its file by a
  server-generated blob ID. Uploads write the file first and the metadata second; if the
  metadata can't be saved, the file is deleted again. Files are deleted only after the
  metadata that referenced them is gone, and only when no other version still uses them.
- **Versions** are numbered; the highest is current. Restoring an earlier version adds a new
  version that reuses its blob, and uploading bytes a version of the same document already has
  reuses that blob too, so nothing is stored twice.
- **Trash** is a timestamp. Trashed documents are read-only, and only they can be deleted
  permanently. Archived documents stay editable but send no reminders.
- **Reminders**: each document manages at most one reminder (`Reminder.commitment` with kind
  `document`) in the existing reminder system, pointed at its next expiry, renewal, or review
  alert in the same transaction as every change. The existing worker delivers it and calls
  `after_delivery`, which moves it to the following alert.
"""

import hashlib
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Protocol

from orbit_api.services.documents.expiry import next_alert, reminder_target
from orbit_api.services.documents.models import (
    ACCEPTED_EXTENSIONS,
    DEFAULT_CATEGORIES,
    FILENAME_MAX_LENGTH,
    MAX_CATEGORIES,
    MAX_FOLDER_DEPTH,
    RENEWAL_WINDOW_DAYS,
    Category,
    CategoryIcon,
    CategoryNameTakenError,
    CategoryNotFoundError,
    CategoryUsage,
    DateRange,
    Document,
    DocumentChanges,
    DocumentCounts,
    DocumentDetails,
    DocumentDraft,
    DocumentFile,
    DocumentNotFoundError,
    DocumentNotTrashedError,
    DocumentOverview,
    DocumentQuery,
    DocumentReadOnlyError,
    DocumentRenewal,
    DocumentVersion,
    FileMissingError,
    FileRejectedError,
    Folder,
    FolderDeleteMode,
    FolderMoveError,
    FolderNotFoundError,
    FolderUsage,
    InvalidDocumentError,
    LinkedRecord,
    LinkedRecordNotFoundError,
    LinkKind,
    LinkTarget,
    ReminderSettings,
    RenewalDraft,
    TooManyCategoriesError,
    VersionNotFoundError,
)
from orbit_api.services.reminders.managed import ReminderStore, point_reminder
from orbit_api.services.reminders.models import CommitmentLink, Reminder
from orbit_api.services.reminders.service import OccurrenceScheduler
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.clock import utc_now
from orbit_api.utils.file_types import FileTypeError, detect_file_type, extension_of


def normalize_name(name: str) -> str:
    return " ".join(name.split()).casefold()


def clean_tags(tags: Sequence[str]) -> tuple[str, ...]:
    """Tags trimmed and single-spaced, without blanks or case-insensitive duplicates, in
    their first spelling and order."""
    seen: set[str] = set()
    cleaned: list[str] = []
    for tag in tags:
        name = " ".join(tag.split())
        key = name.casefold()
        if name and key not in seen:
            seen.add(key)
            cleaned.append(name)
    return tuple(cleaned)


def clean_filename(filename: str) -> str:
    """The name to show and export: the last path segment only, so a name can never act as a
    path, without control characters, and no longer than the column allows."""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in name if c.isprintable()).strip().lstrip(".")
    if not name:
        raise FileRejectedError("The file needs a name.")
    if len(name) > FILENAME_MAX_LENGTH:
        extension = extension_of(name)
        keep = FILENAME_MAX_LENGTH - len(extension) - 1
        name = f"{name[:keep]}.{extension}" if extension else name[:FILENAME_MAX_LENGTH]
    return name


def title_from_filename(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    title = " ".join(stem.replace("_", " ").split()).strip()
    return (title or filename)[:200]


class DocumentStore(Protocol):
    """Storage for one workspace's documents and everything that belongs to them."""

    # Documents

    async def add(self, document: Document) -> None: ...

    async def get(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document | None: ...

    async def save(self, document: Document) -> None:
        """Save the document's fields and replace its tags."""
        ...

    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery, folder_ids: Sequence[uuid.UUID] | None
    ) -> tuple[list[Document], int]:
        """Documents matching `query`; `folder_ids`, when given, replaces its folder filter."""
        ...

    async def counts(self, workspace_id: uuid.UUID, today: date) -> DocumentCounts: ...

    async def mark_opened(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, at: datetime
    ) -> None: ...

    async def delete(self, workspace_id: uuid.UUID, document_ids: Sequence[uuid.UUID]) -> None:
        """Delete these documents (with their versions, tags, renewals, and links)."""
        ...

    async def trashed_ids(self, workspace_id: uuid.UUID) -> list[uuid.UUID]: ...

    async def move_documents(
        self,
        workspace_id: uuid.UUID,
        folder_ids: Sequence[uuid.UUID],
        to_folder: uuid.UUID | None,
    ) -> None:
        """Move every document in `folder_ids`, whatever its state, to `to_folder`."""
        ...

    async def clear_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None: ...

    async def tags(self, workspace_id: uuid.UUID) -> list[tuple[str, int]]:
        """Tag names with how many documents not in the trash use them."""
        ...

    # Versions

    async def add_version(self, version: DocumentVersion) -> None: ...

    async def versions(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID
    ) -> list[DocumentVersion]:
        """Newest first."""
        ...

    async def versions_of(
        self, workspace_id: uuid.UUID, document_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[DocumentVersion]]:
        """Each document's versions, newest first."""
        ...

    async def delete_version(self, workspace_id: uuid.UUID, version_id: uuid.UUID) -> None: ...

    async def blobs_in_use(
        self, workspace_id: uuid.UUID, blob_ids: Sequence[uuid.UUID]
    ) -> set[uuid.UUID]:
        """Which of these blobs a version still references."""
        ...

    # Folders

    async def add_folder(self, folder: Folder) -> None: ...

    async def get_folder(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> Folder | None: ...

    async def folders(self, workspace_id: uuid.UUID) -> list[FolderUsage]: ...

    async def save_folder(self, folder: Folder) -> None: ...

    async def reparent_folders(
        self, workspace_id: uuid.UUID, parent_id: uuid.UUID, new_parent: uuid.UUID | None
    ) -> None: ...

    async def delete_folder(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> None:
        """Delete the folder and, by cascade, its subfolders."""
        ...

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[CategoryUsage]: ...

    async def add_category(self, category: Category) -> None: ...

    async def get_category(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID
    ) -> Category | None: ...

    async def save_category(self, category: Category) -> None: ...

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None: ...

    # Renewals

    async def add_renewal(self, renewal: DocumentRenewal) -> None: ...

    async def renewals(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID
    ) -> list[DocumentRenewal]:
        """Newest first."""
        ...

    # Links

    async def target_exists(self, workspace_id: uuid.UUID, target: LinkTarget) -> bool: ...

    async def add_link(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, target: LinkTarget, at: datetime
    ) -> None:
        """Link them, doing nothing if they already are."""
        ...

    async def remove_link(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, target: LinkTarget
    ) -> None: ...

    async def links(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> list[LinkedRecord]:
        """Linked records with their current titles, newest link first."""
        ...

    async def candidates(
        self, workspace_id: uuid.UUID, kind: LinkKind, search: str | None, limit: int
    ) -> list[LinkedRecord]:
        """Records of `kind` that could be linked, for a picker (`linked_at` is when they
        were created)."""
        ...


class FileStore(Protocol):
    """Where file bytes live: the attachment store, by workspace and blob ID."""

    async def write(self, workspace_id: uuid.UUID, blob_id: uuid.UUID, data: bytes, /) -> None: ...

    async def locate(self, workspace_id: uuid.UUID, blob_id: uuid.UUID, /) -> Path | None: ...

    async def delete(self, workspace_id: uuid.UUID, blob_ids: Sequence[uuid.UUID], /) -> None: ...


@dataclass(frozen=True, slots=True)
class DocumentDetail:
    document: Document
    versions: list[DocumentVersion]
    renewals: list[DocumentRenewal]
    links: list[LinkedRecord]
    next_reminder_at: datetime | None


@dataclass(frozen=True, slots=True)
class ExportItem:
    document: Document
    # Newest first: only the current version unless every version was asked for.
    files: list[tuple[DocumentVersion, Path]]


@dataclass(frozen=True, slots=True)
class ExportBundle:
    items: list[ExportItem]
    folders: list[Folder]
    categories: list[Category]


@dataclass(frozen=True, slots=True)
class ExportSelection:
    """What to export: these documents, a folder (with its subfolders), a category, or, when
    nothing is set, every document that isn't in the trash."""

    document_ids: tuple[uuid.UUID, ...] = ()
    folder_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    include_versions: bool = False


class DocumentReminders:
    """Keeps each document's managed reminder pointed at its next alert."""

    def __init__(
        self,
        store: DocumentStore,
        reminders: ReminderStore,
        occurrences: OccurrenceScheduler,
        clock: Callable[[], datetime],
    ) -> None:
        self._store = store
        self._reminders = reminders
        self._occurrences = occurrences
        self._clock = clock

    async def sync(self, document: Document) -> None:
        now = self._clock()
        await point_reminder(
            self._reminders,
            self._occurrences,
            document.workspace_id,
            CommitmentLink(kind="document", id=document.id),
            reminder_target(document, now),
            now,
        )

    async def after_delivery(self, reminder: Reminder, now: datetime) -> None:
        """Point a delivered reminder at the document's next alert. Called by the reminder
        worker inside its delivery transaction, which commits."""
        link = reminder.commitment
        if link is None or link.kind != "document":
            return
        document = await self._store.get(reminder.workspace_id, link.id)
        if document is not None:
            await point_reminder(
                self._reminders,
                self._occurrences,
                document.workspace_id,
                link,
                reminder_target(document, now),
                now,
            )


class DocumentService:
    def __init__(
        self,
        store: DocumentStore,
        files: FileStore,
        reminders: ReminderStore,
        occurrences: OccurrenceScheduler,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._files = files
        self._transaction = transaction
        self._clock = clock
        self.reminders = DocumentReminders(store, reminders, occurrences, clock)

    # Documents

    async def create(
        self, workspace_id: uuid.UUID, draft: DocumentDraft, *, default_timezone: str | None
    ) -> Document:
        """A document without a file, to track a record that hasn't been uploaded (yet)."""
        document = await self._new(workspace_id, draft, default_timezone)
        await self._store.add(document)
        await self.reminders.sync(document)
        await self._transaction.commit()
        return document

    async def upload(
        self,
        workspace_id: uuid.UUID,
        filename: str,
        data: bytes,
        draft: DocumentDraft | None = None,
        *,
        default_timezone: str | None,
    ) -> Document:
        """A new document holding this file as version 1. The title defaults to the file's
        name."""
        name = clean_filename(filename)
        file_type = self._check_file(name, data)
        draft = draft or DocumentDraft(title=title_from_filename(name))
        document = await self._new(workspace_id, draft, default_timezone)
        version = self._version(document, 1, uuid.uuid4(), name, file_type, data)
        document = self._with_version(document, version)
        await self._files.write(workspace_id, version.blob_id, data)
        try:
            await self._store.add(document)
            await self._store.add_version(version)
            await self.reminders.sync(document)
            await self._transaction.commit()
        except BaseException:
            await self._transaction.rollback()
            await self._files.delete(workspace_id, [version.blob_id])
            raise
        return document

    async def get(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document:
        document = await self._store.get(workspace_id, document_id)
        if document is None:
            raise DocumentNotFoundError
        return document

    async def detail(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> DocumentDetail:
        document = await self.get(workspace_id, document_id)
        alert = next_alert(document, self._clock())
        return DocumentDetail(
            document=document,
            versions=await self._store.versions(workspace_id, document_id),
            renewals=await self._store.renewals(workspace_id, document_id),
            links=await self._store.links(workspace_id, document_id),
            next_reminder_at=alert.at if alert else None,
        )

    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]:
        folder_ids: list[uuid.UUID] | None = None
        if query.include_subfolders and isinstance(query.folder_id, uuid.UUID):
            folder_ids = await self._subtree(workspace_id, query.folder_id)
        return await self._store.find(workspace_id, query, folder_ids)

    async def counts(self, workspace_id: uuid.UUID, today: date) -> DocumentCounts:
        return await self._store.counts(workspace_id, today)

    async def overview(self, workspace_id: uuid.UUID, today: date) -> DocumentOverview:
        async def top(query: DocumentQuery) -> list[Document]:
            items, _ = await self._store.find(workspace_id, replace(query, limit=5), None)
            return items

        return DocumentOverview(
            counts=await self._store.counts(workspace_id, today),
            recently_added=await top(DocumentQuery(sort="created")),
            recently_updated=await top(DocumentQuery(sort="updated")),
            favorites=await top(DocumentQuery(favorite=True, sort="updated")),
            expiring=await top(
                DocumentQuery(
                    expiry=DateRange(today, today + timedelta(days=90)),
                    sort="expiry",
                    order="asc",
                )
            ),
            expired=await top(
                DocumentQuery(
                    expiry=DateRange(None, today - timedelta(days=1)), sort="expiry", order="desc"
                )
            ),
            categories=await self.categories(workspace_id),
        )

    async def update(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, changes: DocumentChanges
    ) -> Document:
        document = await self._editable(workspace_id, document_id)
        updated = await self._apply(document, changes)
        if updated == document:
            return document
        updated = replace(updated, updated_at=self._clock())
        await self._store.save(updated)
        await self.reminders.sync(updated)
        await self._transaction.commit()
        return updated

    async def mark_opened(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> None:
        await self.get(workspace_id, document_id)
        await self._store.mark_opened(workspace_id, document_id, self._clock())
        await self._transaction.commit()

    async def trash(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document:
        document = await self.get(workspace_id, document_id)
        if document.trashed_at is not None:
            return document
        now = self._clock()
        updated = replace(document, trashed_at=now, updated_at=now)
        await self._store.save(updated)
        await self.reminders.sync(updated)
        await self._transaction.commit()
        return updated

    async def restore(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document:
        """Out of the trash, back where it was (archived documents stay archived)."""
        document = await self.get(workspace_id, document_id)
        if document.trashed_at is None:
            return document
        updated = replace(document, trashed_at=None, updated_at=self._clock())
        await self._store.save(updated)
        await self.reminders.sync(updated)
        await self._transaction.commit()
        return updated

    async def delete(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> None:
        """Permanent: the document, its versions, and their files. Only from the trash."""
        document = await self.get(workspace_id, document_id)
        if document.trashed_at is None:
            raise DocumentNotTrashedError
        await self._delete(workspace_id, [document_id])

    async def empty_trash(self, workspace_id: uuid.UUID) -> int:
        ids = await self._store.trashed_ids(workspace_id)
        await self._delete(workspace_id, ids)
        return len(ids)

    async def tags(self, workspace_id: uuid.UUID) -> list[tuple[str, int]]:
        return await self._store.tags(workspace_id)

    # Versions

    async def add_version(
        self,
        workspace_id: uuid.UUID,
        document_id: uuid.UUID,
        filename: str,
        data: bytes,
        note: str = "",
    ) -> Document:
        """Store a new file as the current version; earlier versions are kept. Bytes another
        version of this document already has are not stored again."""
        document = await self._editable(workspace_id, document_id)
        name = clean_filename(filename)
        file_type = self._check_file(name, data)
        digest = hashlib.sha256(data).hexdigest()
        versions = await self._store.versions(workspace_id, document_id)
        current = versions[0] if versions else None
        if current is not None and current.sha256 == digest and current.filename == name:
            return document
        same = next((v for v in versions if v.sha256 == digest), None)
        blob_id = same.blob_id if same is not None else uuid.uuid4()
        number = (current.number if current else 0) + 1
        version = replace(
            self._version(document, number, blob_id, name, file_type, data), note=note
        )
        updated = self._with_version(document, version)
        if same is None:
            await self._files.write(workspace_id, blob_id, data)
        try:
            await self._store.add_version(version)
            await self._store.save(updated)
            await self._transaction.commit()
        except BaseException:
            await self._transaction.rollback()
            if same is None:
                await self._files.delete(workspace_id, [blob_id])
            raise
        return updated

    async def restore_version(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, version_id: uuid.UUID
    ) -> Document:
        """Make an earlier version current again by adding a copy of it as the newest version
        (sharing its file), so no version is lost."""
        document = await self._editable(workspace_id, document_id)
        versions = await self._store.versions(workspace_id, document_id)
        source = next((v for v in versions if v.id == version_id), None)
        if source is None:
            raise VersionNotFoundError
        if source.id == versions[0].id:
            return document
        now = self._clock()
        version = replace(
            source,
            id=uuid.uuid4(),
            number=versions[0].number + 1,
            note="",
            restored_from=source.number,
            uploaded_at=now,
        )
        updated = self._with_version(document, version)
        await self._store.add_version(version)
        await self._store.save(updated)
        await self._transaction.commit()
        return updated

    async def delete_version(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, version_id: uuid.UUID
    ) -> None:
        """Delete an earlier version. The current version can't be deleted; replace or restore
        another first. Its file goes only if no other version shares it."""
        document = await self._editable(workspace_id, document_id)
        versions = await self._store.versions(workspace_id, document_id)
        version = next((v for v in versions if v.id == version_id), None)
        if version is None:
            raise VersionNotFoundError
        if version.id == versions[0].id:
            raise InvalidDocumentError("The current version can't be deleted.")
        await self._store.delete_version(workspace_id, version_id)
        await self._store.save(
            replace(document, version_count=len(versions) - 1, updated_at=self._clock())
        )
        await self._transaction.commit()
        if not await self._store.blobs_in_use(workspace_id, [version.blob_id]):
            await self._files.delete(workspace_id, [version.blob_id])

    async def open_file(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, version_id: uuid.UUID | None
    ) -> tuple[DocumentVersion, Path]:
        """A version's file (the current one by default), for download or preview."""
        await self.get(workspace_id, document_id)
        versions = await self._store.versions(workspace_id, document_id)
        if version_id is None:
            version = versions[0] if versions else None
        else:
            version = next((v for v in versions if v.id == version_id), None)
        if version is None:
            raise VersionNotFoundError
        path = await self._files.locate(workspace_id, version.blob_id)
        if path is None:
            raise FileMissingError
        return version, path

    # Renewals

    async def renew(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, draft: RenewalDraft
    ) -> Document:
        """Record a renewal: the new dates replace the old ones, which are kept in the renewal
        history, and reminders move to the new dates."""
        document = await self._editable(workspace_id, document_id)
        details = document.details
        now = self._clock()
        issue = details.issue_date if draft.issue_date is UNSET else draft.issue_date
        renewal_date = details.renewal_date if draft.renewal_date is UNSET else draft.renewal_date
        _check_dates(issue, draft.expiry_date)
        await self._store.add_renewal(
            DocumentRenewal(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                document_id=document_id,
                previous_issue_date=details.issue_date,
                previous_expiry_date=details.expiry_date,
                previous_renewal_date=details.renewal_date,
                issue_date=issue,
                expiry_date=draft.expiry_date,
                renewal_date=renewal_date,
                note=draft.note,
                renewed_at=now,
            )
        )
        updated = replace(
            document,
            details=replace(
                details, issue_date=issue, expiry_date=draft.expiry_date, renewal_date=renewal_date
            ),
            updated_at=now,
        )
        await self._store.save(updated)
        await self.reminders.sync(updated)
        await self._transaction.commit()
        return updated

    # Links

    async def link(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, target: LinkTarget
    ) -> None:
        await self.get(workspace_id, document_id)
        if not await self._store.target_exists(workspace_id, target):
            raise LinkedRecordNotFoundError
        try:
            await self._store.add_link(workspace_id, document_id, target, self._clock())
            await self._transaction.commit()
        except ConflictError:
            # Linked concurrently: the link exists either way.
            await self._transaction.rollback()

    async def unlink(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, target: LinkTarget
    ) -> None:
        await self.get(workspace_id, document_id)
        await self._store.remove_link(workspace_id, document_id, target)
        await self._transaction.commit()

    async def links(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> list[LinkedRecord]:
        await self.get(workspace_id, document_id)
        return await self._store.links(workspace_id, document_id)

    async def candidates(
        self, workspace_id: uuid.UUID, kind: LinkKind, search: str | None, limit: int
    ) -> list[LinkedRecord]:
        return await self._store.candidates(workspace_id, kind, search, limit)

    # Folders

    async def folders(self, workspace_id: uuid.UUID) -> list[FolderUsage]:
        return await self._store.folders(workspace_id)

    async def create_folder(
        self, workspace_id: uuid.UUID, name: str, parent_id: uuid.UUID | None
    ) -> Folder:
        if parent_id is not None:
            await self._get_folder(workspace_id, parent_id)
            if len(await self._ancestors(workspace_id, parent_id)) + 1 >= MAX_FOLDER_DEPTH:
                raise FolderMoveError
        now = self._clock()
        folder = Folder(uuid.uuid4(), workspace_id, parent_id, name, now, now)
        await self._store.add_folder(folder)
        await self._transaction.commit()
        return folder

    async def update_folder(
        self,
        workspace_id: uuid.UUID,
        folder_id: uuid.UUID,
        *,
        name: str | None = None,
        parent_id: Change[uuid.UUID | None] = UNSET,
    ) -> Folder:
        folder = await self._get_folder(workspace_id, folder_id)
        updated = folder if name is None else replace(folder, name=name)
        if parent_id is not UNSET and parent_id != folder.parent_id:
            await self._check_move(workspace_id, folder, parent_id)
            updated = replace(updated, parent_id=parent_id)
        if updated == folder:
            return folder
        updated = replace(updated, updated_at=self._clock())
        await self._store.save_folder(updated)
        await self._transaction.commit()
        return updated

    async def delete_folder(
        self,
        workspace_id: uuid.UUID,
        folder_id: uuid.UUID,
        mode: FolderDeleteMode,
        target_id: uuid.UUID | None = None,
    ) -> None:
        """Delete a folder without deleting documents. `parent` moves its documents and
        subfolders up a level; `unfiled` and `folder` delete its subfolders too, moving every
        document inside to no folder or to `target_id`."""
        folder = await self._get_folder(workspace_id, folder_id)
        if mode == "parent":
            await self._store.move_documents(workspace_id, [folder.id], folder.parent_id)
            await self._store.reparent_folders(workspace_id, folder.id, folder.parent_id)
        else:
            subtree = await self._subtree(workspace_id, folder.id)
            destination: uuid.UUID | None = None
            if mode == "folder":
                if target_id is None:
                    raise InvalidDocumentError("Choose the folder to move the documents to.")
                await self._get_folder(workspace_id, target_id)
                if target_id in subtree:
                    raise FolderMoveError
                destination = target_id
            await self._store.move_documents(workspace_id, subtree, destination)
        await self._store.delete_folder(workspace_id, folder.id)
        await self._transaction.commit()

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[CategoryUsage]:
        """The workspace's categories, creating the defaults the first time."""
        categories = await self._store.categories(workspace_id)
        if categories:
            return categories
        now = self._clock()
        try:
            for position, (name, icon) in enumerate(DEFAULT_CATEGORIES):
                await self._store.add_category(
                    Category(uuid.uuid4(), workspace_id, name, icon, position, now, now)
                )
            await self._transaction.commit()
        except ConflictError:
            # A concurrent first request created them.
            await self._transaction.rollback()
        return await self._store.categories(workspace_id)

    async def create_category(
        self, workspace_id: uuid.UUID, name: str, icon: CategoryIcon
    ) -> Category:
        existing = [usage.category for usage in await self.categories(workspace_id)]
        if len(existing) >= MAX_CATEGORIES:
            raise TooManyCategoriesError
        if any(normalize_name(c.name) == normalize_name(name) for c in existing):
            raise CategoryNameTakenError
        now = self._clock()
        position = max((c.position for c in existing), default=-1) + 1
        category = Category(uuid.uuid4(), workspace_id, name, icon, position, now, now)
        try:
            await self._store.add_category(category)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise CategoryNameTakenError from None
        return category

    async def update_category(
        self,
        workspace_id: uuid.UUID,
        category_id: uuid.UUID,
        *,
        name: str | None = None,
        icon: CategoryIcon | None = None,
    ) -> Category:
        category = await self._get_category(workspace_id, category_id)
        updated = replace(
            category,
            name=category.name if name is None else name,
            icon=category.icon if icon is None else icon,
        )
        if updated == category:
            return category
        if name is not None and normalize_name(name) != normalize_name(category.name):
            others = await self._store.categories(workspace_id)
            if any(normalize_name(u.category.name) == normalize_name(name) for u in others):
                raise CategoryNameTakenError
        updated = replace(updated, updated_at=self._clock())
        try:
            await self._store.save_category(updated)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise CategoryNameTakenError from None
        return updated

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None:
        """Its documents stay, unclassified."""
        await self._get_category(workspace_id, category_id)
        await self._store.clear_category(workspace_id, category_id)
        await self._store.delete_category(workspace_id, category_id)
        await self._transaction.commit()

    # Export

    async def export(self, workspace_id: uuid.UUID, selection: ExportSelection) -> ExportBundle:
        """Documents and the paths of their files, for an archive. Files missing from the
        store are left out (the metadata still lists them)."""
        if selection.document_ids:
            documents: list[Document] = []
            for document_id in dict.fromkeys(selection.document_ids):
                documents.append(await self.get(workspace_id, document_id))
        else:
            query = DocumentQuery(states=("active", "archived"), sort="title", order="asc")
            if selection.folder_id is not None:
                await self._get_folder(workspace_id, selection.folder_id)
                query = replace(query, folder_id=selection.folder_id, include_subfolders=True)
            if selection.category_id is not None:
                await self._get_category(workspace_id, selection.category_id)
                query = replace(query, category_id=selection.category_id)
            documents = await self._all(workspace_id, query)
        versions = await self._store.versions_of(workspace_id, [d.id for d in documents])
        items: list[ExportItem] = []
        for document in documents:
            chosen = versions.get(document.id, [])
            if not selection.include_versions:
                chosen = chosen[:1]
            files: list[tuple[DocumentVersion, Path]] = []
            for version in chosen:
                path = await self._files.locate(workspace_id, version.blob_id)
                if path is not None:
                    files.append((version, path))
            items.append(ExportItem(document, files))
        return ExportBundle(
            items=items,
            folders=[usage.folder for usage in await self._store.folders(workspace_id)],
            categories=[usage.category for usage in await self._store.categories(workspace_id)],
        )

    # Helpers

    async def _all(self, workspace_id: uuid.UUID, query: DocumentQuery) -> list[Document]:
        result: list[Document] = []
        offset = 0
        while True:
            page, total = await self.find(workspace_id, replace(query, limit=100, offset=offset))
            result.extend(page)
            offset += len(page)
            if not page or offset >= total:
                return result

    async def _new(
        self, workspace_id: uuid.UUID, draft: DocumentDraft, default_timezone: str | None
    ) -> Document:
        await self._check_references(workspace_id, draft.folder_id, draft.category_id)
        _check_details(draft.details)
        now = self._clock()
        return Document(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            title=draft.title,
            folder_id=draft.folder_id,
            category_id=draft.category_id,
            details=draft.details,
            reminders=draft.reminders or ReminderSettings(timezone=default_timezone or "UTC"),
            is_favorite=draft.is_favorite,
            archived_at=None,
            trashed_at=None,
            file=None,
            version_count=0,
            tags=clean_tags(draft.tags),
            created_at=now,
            updated_at=now,
            last_opened_at=None,
        )

    def _check_file(self, filename: str, data: bytes) -> str:
        """The detected content type; the declared one is never trusted."""
        try:
            return detect_file_type(filename, data, ACCEPTED_EXTENSIONS, strict=True).content_type
        except FileTypeError as error:
            raise FileRejectedError(str(error)) from None

    def _version(
        self,
        document: Document,
        number: int,
        blob_id: uuid.UUID,
        filename: str,
        content_type: str,
        data: bytes,
    ) -> DocumentVersion:
        return DocumentVersion(
            id=uuid.uuid4(),
            workspace_id=document.workspace_id,
            document_id=document.id,
            number=number,
            blob_id=blob_id,
            filename=filename,
            extension=extension_of(filename),
            content_type=content_type,
            size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
            note="",
            restored_from=None,
            uploaded_at=self._clock(),
        )

    def _with_version(self, document: Document, version: DocumentVersion) -> Document:
        return replace(
            document,
            file=DocumentFile(
                version_id=version.id,
                filename=version.filename,
                extension=version.extension,
                content_type=version.content_type,
                size_bytes=version.size_bytes,
                uploaded_at=version.uploaded_at,
            ),
            version_count=document.version_count + 1,
            updated_at=version.uploaded_at,
        )

    async def _editable(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document:
        document = await self.get(workspace_id, document_id)
        if document.trashed_at is not None:
            raise DocumentReadOnlyError
        return document

    async def _apply(self, document: Document, changes: DocumentChanges) -> Document:
        folder_id = document.folder_id if changes.folder_id is UNSET else changes.folder_id
        category_id = document.category_id if changes.category_id is UNSET else changes.category_id
        await self._check_references(
            document.workspace_id,
            folder_id if folder_id != document.folder_id else None,
            category_id if category_id != document.category_id else None,
        )
        details = document.details
        detail_changes = {
            name: value
            for name in (
                "description",
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
                "notes",
                "custom_fields",
            )
            if (value := getattr(changes, name)) is not UNSET
        }
        details = replace(details, **detail_changes)
        _check_details(details)
        settings = document.reminders
        if changes.reminder_days is not UNSET:
            settings = replace(settings, days=changes.reminder_days)
        if changes.reminder_time is not UNSET:
            settings = replace(settings, time_of_day=changes.reminder_time)
        if changes.timezone is not UNSET:
            settings = replace(settings, timezone=changes.timezone)
        archived_at = document.archived_at
        if changes.archived is not UNSET:
            if changes.archived and archived_at is None:
                archived_at = self._clock()
            elif not changes.archived:
                archived_at = None
        return replace(
            document,
            title=document.title if changes.title is UNSET else changes.title,
            folder_id=folder_id,
            category_id=category_id,
            details=details,
            reminders=settings,
            is_favorite=(
                document.is_favorite if changes.is_favorite is UNSET else changes.is_favorite
            ),
            archived_at=archived_at,
            tags=document.tags if changes.tags is UNSET else clean_tags(changes.tags),
        )

    async def _check_references(
        self, workspace_id: uuid.UUID, folder_id: uuid.UUID | None, category_id: uuid.UUID | None
    ) -> None:
        if folder_id is not None:
            await self._get_folder(workspace_id, folder_id)
        if category_id is not None:
            await self._get_category(workspace_id, category_id)

    async def _delete(self, workspace_id: uuid.UUID, document_ids: Sequence[uuid.UUID]) -> None:
        """Delete the metadata, commit, then delete the files nothing references any more."""
        if not document_ids:
            return
        versions = await self._store.versions_of(workspace_id, document_ids)
        blobs = list({v.blob_id for items in versions.values() for v in items})
        await self._store.delete(workspace_id, document_ids)
        await self._transaction.commit()
        in_use = await self._store.blobs_in_use(workspace_id, blobs)
        await self._files.delete(workspace_id, [b for b in blobs if b not in in_use])

    async def _get_folder(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> Folder:
        folder = await self._store.get_folder(workspace_id, folder_id)
        if folder is None:
            raise FolderNotFoundError
        return folder

    async def _get_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> Category:
        category = await self._store.get_category(workspace_id, category_id)
        if category is None:
            raise CategoryNotFoundError
        return category

    async def _parents(self, workspace_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID | None]:
        return {u.folder.id: u.folder.parent_id for u in await self._store.folders(workspace_id)}

    async def _ancestors(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> list[uuid.UUID]:
        parents = await self._parents(workspace_id)
        chain: list[uuid.UUID] = []
        current = parents.get(folder_id)
        while current is not None and current not in chain:
            chain.append(current)
            current = parents.get(current)
        return chain

    async def _subtree(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> list[uuid.UUID]:
        """The folder and every folder below it."""
        parents = await self._parents(workspace_id)
        children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
        for child, parent in parents.items():
            children.setdefault(parent, []).append(child)
        result: list[uuid.UUID] = []
        pending = [folder_id]
        while pending:
            current = pending.pop()
            if current in result:
                continue
            result.append(current)
            pending.extend(children.get(current, []))
        return result

    async def _check_move(
        self, workspace_id: uuid.UUID, folder: Folder, parent_id: uuid.UUID | None
    ) -> None:
        if parent_id is None:
            return
        await self._get_folder(workspace_id, parent_id)
        subtree = await self._subtree(workspace_id, folder.id)
        if parent_id in subtree:
            raise FolderMoveError
        parents = await self._parents(workspace_id)

        # Depth of the subtree below this folder, plus the new parent's depth.
        def depth(folder_id: uuid.UUID) -> int:
            level = 0
            current = parents.get(folder_id)
            while current is not None:
                level += 1
                current = parents.get(current)
            return level

        below = max(depth(f) for f in subtree) - depth(folder.id)
        if depth(parent_id) + 1 + below + 1 > MAX_FOLDER_DEPTH:
            raise FolderMoveError


def _check_dates(issue: date | None, expiry: date | None) -> None:
    if issue is not None and expiry is not None and expiry < issue:
        raise InvalidDocumentError("The expiry date can't be before the issue date.")


def _check_details(details: DocumentDetails) -> None:
    if details.amount is not None and details.currency is None:
        raise InvalidDocumentError("An amount needs a currency.")
    _check_dates(details.issue_date, details.expiry_date)


def renewal_window(today: date) -> DateRange:
    return DateRange(today, today + timedelta(days=RENEWAL_WINDOW_DAYS))
