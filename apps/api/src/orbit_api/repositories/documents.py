"""SQLAlchemy storage for documents: the `DocumentStore` protocol. Every query is filtered by the
workspace the caller authorized."""

import uuid
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, cast

from sqlalchemy import (
    ColumnElement,
    and_,
    case,
    delete,
    exists,
    false,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from orbit_api.db.models.calendar import CalendarEventModel
from orbit_api.db.models.commitments import FinanceLoanModel, FinanceRecurringPaymentModel
from orbit_api.db.models.documents import (
    DocumentCategoryModel,
    DocumentFolderModel,
    DocumentLinkModel,
    DocumentModel,
    DocumentRenewalModel,
    DocumentTagModel,
    DocumentVersionModel,
)
from orbit_api.db.models.finance import FinanceTransactionModel
from orbit_api.db.models.investments import (
    FinanceAssetModel,
    FinanceDepositModel,
    FinanceHoldingModel,
)
from orbit_api.db.models.notes import NoteAttachmentModel, NoteModel
from orbit_api.db.models.tasks import TaskModel
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.documents.models import (
    EXPIRING_SOON_DAYS,
    FILE_KINDS,
    RENEWAL_WINDOW_DAYS,
    Category,
    CategoryIcon,
    CategoryUsage,
    CustomField,
    Document,
    DocumentCounts,
    DocumentDetails,
    DocumentFile,
    DocumentQuery,
    DocumentRenewal,
    DocumentState,
    DocumentVersion,
    Folder,
    FolderUsage,
    LinkedRecord,
    LinkKind,
    LinkTarget,
    ReminderSettings,
)
from orbit_api.services.documents.service import (
    DocumentReminders,
    DocumentService,
    FileStore,
    normalize_name,
)
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now
from orbit_api.utils.text_search import LIKE_ESCAPE, contains_pattern

MAX_SEARCH_WORDS = 8
type _Column = ColumnElement[Any] | InstrumentedAttribute[Any]
D = DocumentModel
V = DocumentVersionModel
L = DocumentLinkModel

_LINK_COLUMNS: dict[LinkKind, InstrumentedAttribute[uuid.UUID | None]] = {
    "note": L.note_id,
    "task": L.task_id,
    "event": L.calendar_event_id,
    "transaction": L.finance_transaction_id,
    "loan": L.finance_loan_id,
    "recurring_payment": L.finance_recurring_payment_id,
    "deposit": L.finance_deposit_id,
    "holding": L.finance_holding_id,
    "asset": L.finance_asset_id,
}


def _to_document(model: DocumentModel, tags: Sequence[str]) -> Document:
    file = None
    if model.current_version_id is not None:
        file = DocumentFile(
            version_id=model.current_version_id,
            filename=model.file_name or "",
            extension=model.file_extension or "",
            content_type=model.file_content_type or "application/octet-stream",
            size_bytes=model.file_size or 0,
            uploaded_at=model.file_uploaded_at or model.created_at,
        )
    return Document(
        id=model.id,
        workspace_id=model.workspace_id,
        title=model.title,
        folder_id=model.folder_id,
        category_id=model.category_id,
        details=DocumentDetails(
            description=model.description,
            reference_number=model.reference_number,
            issuing_authority=model.issuing_authority,
            provider=model.provider,
            issue_date=model.issue_date,
            effective_date=model.effective_date,
            expiry_date=model.expiry_date,
            renewal_date=model.renewal_date,
            review_date=model.review_date,
            amount=model.amount,
            currency=model.currency,
            notes=model.notes,
            custom_fields=tuple(
                CustomField(label=str(item["label"]), value=str(item["value"]))
                for item in model.custom_fields
            ),
        ),
        reminders=ReminderSettings(
            days=tuple(int(day) for day in model.reminder_days),
            time_of_day=model.reminder_time,
            timezone=model.timezone,
        ),
        is_favorite=model.is_favorite,
        archived_at=model.archived_at,
        trashed_at=model.trashed_at,
        file=file,
        version_count=model.version_count,
        tags=tuple(tags),
        created_at=model.created_at,
        updated_at=model.updated_at,
        last_opened_at=model.last_opened_at,
    )


def _fields(document: Document) -> dict[str, Any]:
    details = document.details
    file = document.file
    return {
        "folder_id": document.folder_id,
        "category_id": document.category_id,
        "title": document.title,
        "description": details.description,
        "reference_number": details.reference_number,
        "issuing_authority": details.issuing_authority,
        "provider": details.provider,
        "issue_date": details.issue_date,
        "effective_date": details.effective_date,
        "expiry_date": details.expiry_date,
        "renewal_date": details.renewal_date,
        "review_date": details.review_date,
        "amount": details.amount,
        "currency": details.currency,
        "notes": details.notes,
        "custom_fields": [{"label": f.label, "value": f.value} for f in details.custom_fields],
        "is_favorite": document.is_favorite,
        "archived_at": document.archived_at,
        "trashed_at": document.trashed_at,
        "reminder_days": list(document.reminders.days),
        "reminder_time": document.reminders.time_of_day,
        "timezone": document.reminders.timezone,
        "current_version_id": file.version_id if file else None,
        "file_name": file.filename if file else None,
        "file_extension": file.extension if file else None,
        "file_content_type": file.content_type if file else None,
        "file_size": file.size_bytes if file else None,
        "file_uploaded_at": file.uploaded_at if file else None,
        "version_count": document.version_count,
        "updated_at": document.updated_at,
        "last_opened_at": document.last_opened_at,
    }


def _to_version(model: DocumentVersionModel) -> DocumentVersion:
    return DocumentVersion(
        id=model.id,
        workspace_id=model.workspace_id,
        document_id=model.document_id,
        number=model.number,
        blob_id=model.blob_id,
        filename=model.filename,
        extension=model.extension,
        content_type=model.content_type,
        size_bytes=model.size_bytes,
        sha256=model.sha256,
        note=model.note,
        restored_from=model.restored_from,
        uploaded_at=model.uploaded_at,
    )


def _to_folder(model: DocumentFolderModel) -> Folder:
    return Folder(
        model.id,
        model.workspace_id,
        model.parent_id,
        model.name,
        model.created_at,
        model.updated_at,
    )


def _to_category(model: DocumentCategoryModel) -> Category:
    return Category(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        # The service only stores known icons.
        icon=cast(CategoryIcon, model.icon),
        position=model.position,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_renewal(model: DocumentRenewalModel) -> DocumentRenewal:
    return DocumentRenewal(
        id=model.id,
        workspace_id=model.workspace_id,
        document_id=model.document_id,
        previous_issue_date=model.previous_issue_date,
        previous_expiry_date=model.previous_expiry_date,
        previous_renewal_date=model.previous_renewal_date,
        issue_date=model.issue_date,
        expiry_date=model.expiry_date,
        renewal_date=model.renewal_date,
        note=model.note,
        renewed_at=model.renewed_at,
    )


def _state_condition(state: DocumentState) -> ColumnElement[bool]:
    match state:
        case "trashed":
            return D.trashed_at.is_not(None)
        case "archived":
            return and_(D.trashed_at.is_(None), D.archived_at.is_not(None))
        case "active":
            return and_(D.trashed_at.is_(None), D.archived_at.is_(None))


def _category_name() -> ColumnElement[str]:
    return (
        select(DocumentCategoryModel.name)
        .where(
            DocumentCategoryModel.id == D.category_id,
            DocumentCategoryModel.workspace_id == D.workspace_id,
        )
        .correlate(D)
        .scalar_subquery()
    )


def _folder_name() -> ColumnElement[str]:
    return (
        select(DocumentFolderModel.name)
        .where(
            DocumentFolderModel.id == D.folder_id,
            DocumentFolderModel.workspace_id == D.workspace_id,
        )
        .correlate(D)
        .scalar_subquery()
    )


def _matches(word: str) -> ColumnElement[bool]:
    """The word appears in the title, description, file name, issuer, provider, notes, a tag,
    the category, or the folder. Reference numbers are deliberately not searched."""
    pattern = contains_pattern(word)

    def like(column: ColumnElement[Any] | InstrumentedAttribute[Any]) -> ColumnElement[bool]:
        return column.ilike(pattern, escape=LIKE_ESCAPE)

    tag = exists().where(
        DocumentTagModel.document_id == D.id,
        DocumentTagModel.workspace_id == D.workspace_id,
        DocumentTagModel.name.ilike(pattern, escape=LIKE_ESCAPE),
    )
    return or_(
        like(D.title),
        like(D.description),
        like(D.file_name),
        like(D.issuing_authority),
        like(D.provider),
        like(D.notes),
        tag,
        like(_category_name()),
        like(_folder_name()),
    )


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def _filters(
    workspace_id: uuid.UUID, query: DocumentQuery, folder_ids: Sequence[uuid.UUID] | None
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [D.workspace_id == workspace_id]
    conditions.append(
        or_(*(_state_condition(state) for state in query.states)) if query.states else false()
    )
    if folder_ids is not None:
        conditions.append(D.folder_id.in_(folder_ids))
    elif query.folder_id is None:
        conditions.append(D.folder_id.is_(None))
    elif query.folder_id is not UNSET:
        conditions.append(D.folder_id == query.folder_id)
    if query.category_id is None:
        conditions.append(D.category_id.is_(None))
    elif query.category_id is not UNSET:
        conditions.append(D.category_id == query.category_id)
    if query.tag is not None:
        conditions.append(
            exists().where(
                DocumentTagModel.document_id == D.id,
                DocumentTagModel.workspace_id == D.workspace_id,
                DocumentTagModel.normalized_name == normalize_name(query.tag),
            )
        )
    if query.file_kind == "none":
        conditions.append(D.current_version_id.is_(None))
    elif query.file_kind is not None:
        conditions.append(D.file_extension.in_(sorted(FILE_KINDS[query.file_kind])))
    if query.favorite is not None:
        conditions.append(D.is_favorite == query.favorite)
    if query.created.start is not None:
        conditions.append(D.created_at >= _day_start(query.created.start))
    if query.created.end is not None:
        conditions.append(D.created_at < _day_start(query.created.end + timedelta(days=1)))
    for column, bounds in ((D.expiry_date, query.expiry), (D.renewal_date, query.renewal)):
        if bounds.start is not None:
            conditions.append(column >= bounds.start)
        if bounds.end is not None:
            conditions.append(column <= bounds.end)
    if query.linked is not None:
        column = _LINK_COLUMNS[query.linked.kind]
        conditions.append(
            exists().where(
                L.document_id == D.id, L.workspace_id == D.workspace_id, column == query.linked.id
            )
        )
    if query.search:
        words = query.search.split()[:MAX_SEARCH_WORDS]
        conditions.extend(_matches(word) for word in words)
    return conditions


def _ordering(query: DocumentQuery) -> list[ColumnElement[Any]]:
    descending = query.order == "desc"

    def direction(column: _Column) -> ColumnElement[Any]:
        return column.desc() if descending else column.asc()

    match query.sort:
        case "title":
            keys = [direction(func.lower(D.title))]
        case "created":
            keys = [direction(D.created_at)]
        case "updated":
            keys = [direction(D.updated_at)]
        case "recent":
            keys = [direction(func.coalesce(D.last_opened_at, D.updated_at))]
        case "expiry":
            # Documents without the value always come last.
            keys = [D.expiry_date.is_(None), direction(D.expiry_date)]
        case "size":
            keys = [D.file_size.is_(None), direction(D.file_size)]
        case "category":
            name = _category_name()
            keys = [name.is_(None), direction(func.lower(name)), func.lower(D.title).asc()]
    return [*keys, D.id.asc()]


class _Titles:
    """How to name records of one kind: (model, title, detail, created, extra filter)."""

    def __init__(
        self,
        model: Any,
        title: _Column,
        detail: _Column,
        created: _Column,
        visible: ColumnElement[bool] | None = None,
    ) -> None:
        self.model = model
        self.title = title
        self.detail = detail
        self.created = created
        self.visible = visible


def _titles(kind: LinkKind) -> _Titles:
    match kind:
        case "note":
            return _Titles(
                NoteModel,
                NoteModel.title,
                NoteModel.note_type,
                NoteModel.updated_at,
                NoteModel.trashed_at.is_(None),
            )
        case "task":
            return _Titles(TaskModel, TaskModel.title, TaskModel.status, TaskModel.created_at)
        case "event":
            return _Titles(
                CalendarEventModel,
                CalendarEventModel.title,
                CalendarEventModel.start_local,
                CalendarEventModel.start_at,
            )
        case "transaction":
            return _Titles(
                FinanceTransactionModel,
                FinanceTransactionModel.description,
                FinanceTransactionModel.occurred_on,
                FinanceTransactionModel.occurred_on,
            )
        case "loan":
            return _Titles(
                FinanceLoanModel,
                FinanceLoanModel.name,
                FinanceLoanModel.lender,
                FinanceLoanModel.created_at,
            )
        case "recurring_payment":
            return _Titles(
                FinanceRecurringPaymentModel,
                FinanceRecurringPaymentModel.name,
                FinanceRecurringPaymentModel.kind,
                FinanceRecurringPaymentModel.created_at,
            )
        case "deposit":
            return _Titles(
                FinanceDepositModel,
                FinanceDepositModel.name,
                FinanceDepositModel.kind,
                FinanceDepositModel.created_at,
            )
        case "holding":
            return _Titles(
                FinanceHoldingModel,
                FinanceHoldingModel.name,
                FinanceHoldingModel.kind,
                FinanceHoldingModel.created_at,
            )
        case "asset":
            return _Titles(
                FinanceAssetModel,
                FinanceAssetModel.name,
                FinanceAssetModel.category,
                FinanceAssetModel.created_at,
            )


_DETAILS: dict[str, str] = {
    "note": "Note",
    "quick": "Quick note",
    "journal": "Journal entry",
    "open": "Open",
    "completed": "Completed",
    "subscription": "Subscription",
    "bill": "Bill",
    "fixed": "Fixed deposit",
    "recurring": "Recurring deposit",
    "mutual_fund": "Mutual fund",
    "stock": "Stock",
    "etf": "ETF",
}


def _describe(kind: LinkKind, title: str, detail: object) -> tuple[str, str]:
    if not title:
        title = {"note": "Untitled", "transaction": "Transaction"}.get(kind, "Untitled")
    if isinstance(detail, datetime):
        text = detail.date().isoformat()
    elif isinstance(detail, date):
        text = detail.isoformat()
    else:
        raw = str(detail or "")
        text = _DETAILS.get(raw, raw.replace("_", " ").capitalize())
    return title, text


class SqlDocumentStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # Documents

    async def add(self, document: Document) -> None:
        self._session.add(
            DocumentModel(
                id=document.id,
                workspace_id=document.workspace_id,
                created_at=document.created_at,
                **_fields(document),
            )
        )
        await flush(self._session)
        await self._set_tags(document)

    async def get(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document | None:
        model = await self._model(workspace_id, document_id)
        if model is None:
            return None
        tags = await self._tags_of(workspace_id, [model.id])
        return _to_document(model, tags.get(model.id, []))

    async def save(self, document: Document) -> None:
        await self._session.execute(
            update(D)
            .where(D.workspace_id == document.workspace_id, D.id == document.id)
            .values(**_fields(document))
        )
        await self._set_tags(document)

    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery, folder_ids: Sequence[uuid.UUID] | None
    ) -> tuple[list[Document], int]:
        conditions = _filters(workspace_id, query, folder_ids)
        total = await self._session.scalar(select(func.count()).select_from(D).where(*conditions))
        models = list(
            await self._session.scalars(
                select(D)
                .where(*conditions)
                .order_by(*_ordering(query))
                .limit(query.limit)
                .offset(query.offset)
            )
        )
        tags = await self._tags_of(workspace_id, [m.id for m in models])
        return [_to_document(m, tags.get(m.id, [])) for m in models], total or 0

    async def counts(self, workspace_id: uuid.UUID, today: date) -> DocumentCounts:
        active = _state_condition("active")

        def count(*conditions: ColumnElement[bool]) -> ColumnElement[int]:
            return func.coalesce(func.sum(case((and_(*conditions), 1), else_=0)), 0)

        def expiring(days: int) -> ColumnElement[int]:
            return count(
                active, D.expiry_date >= today, D.expiry_date <= today + timedelta(days=days)
            )

        row = (
            await self._session.execute(
                select(
                    count(active),
                    count(active, D.is_favorite.is_(True)),
                    count(active, D.folder_id.is_(None)),
                    count(active, D.category_id.is_(None)),
                    count(active, D.current_version_id.is_(None)),
                    expiring(7),
                    expiring(EXPIRING_SOON_DAYS),
                    expiring(90),
                    count(active, D.expiry_date < today),
                    count(
                        active,
                        D.renewal_date >= today,
                        D.renewal_date <= today + timedelta(days=RENEWAL_WINDOW_DAYS),
                    ),
                    count(_state_condition("archived")),
                    count(_state_condition("trashed")),
                ).where(D.workspace_id == workspace_id)
            )
        ).one()
        total_bytes = await self._session.scalar(
            select(func.coalesce(func.sum(V.size_bytes), 0)).where(V.workspace_id == workspace_id)
        )
        values = [int(value or 0) for value in row]
        return DocumentCounts(*values, total_bytes=int(total_bytes or 0))

    async def mark_opened(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, at: datetime
    ) -> None:
        await self._session.execute(
            update(D)
            .where(D.workspace_id == workspace_id, D.id == document_id)
            .values(last_opened_at=at)
        )

    async def delete(self, workspace_id: uuid.UUID, document_ids: Sequence[uuid.UUID]) -> None:
        if document_ids:
            await self._session.execute(
                delete(D).where(D.workspace_id == workspace_id, D.id.in_(document_ids))
            )

    async def trashed_ids(self, workspace_id: uuid.UUID) -> list[uuid.UUID]:
        return list(
            await self._session.scalars(
                select(D.id).where(D.workspace_id == workspace_id, D.trashed_at.is_not(None))
            )
        )

    async def move_documents(
        self,
        workspace_id: uuid.UUID,
        folder_ids: Sequence[uuid.UUID],
        to_folder: uuid.UUID | None,
    ) -> None:
        if folder_ids:
            await self._session.execute(
                update(D)
                .where(D.workspace_id == workspace_id, D.folder_id.in_(folder_ids))
                .values(folder_id=to_folder)
            )

    async def clear_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None:
        await self._session.execute(
            update(D)
            .where(D.workspace_id == workspace_id, D.category_id == category_id)
            .values(category_id=None)
        )

    async def tags(self, workspace_id: uuid.UUID) -> list[tuple[str, int]]:
        rows = await self._session.execute(
            select(func.min(DocumentTagModel.name), func.count())
            .join(D, and_(D.id == DocumentTagModel.document_id, D.workspace_id == workspace_id))
            .where(DocumentTagModel.workspace_id == workspace_id, D.trashed_at.is_(None))
            .group_by(DocumentTagModel.normalized_name)
            .order_by(func.min(DocumentTagModel.normalized_name))
        )
        return [(str(name), int(total)) for name, total in rows]

    # Versions

    async def add_version(self, version: DocumentVersion) -> None:
        self._session.add(
            DocumentVersionModel(
                id=version.id,
                workspace_id=version.workspace_id,
                document_id=version.document_id,
                number=version.number,
                blob_id=version.blob_id,
                filename=version.filename,
                extension=version.extension,
                content_type=version.content_type,
                size_bytes=version.size_bytes,
                sha256=version.sha256,
                note=version.note,
                restored_from=version.restored_from,
                uploaded_at=version.uploaded_at,
            )
        )
        await flush(self._session)

    async def versions(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID
    ) -> list[DocumentVersion]:
        return (await self.versions_of(workspace_id, [document_id])).get(document_id, [])

    async def versions_of(
        self, workspace_id: uuid.UUID, document_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[DocumentVersion]]:
        result: dict[uuid.UUID, list[DocumentVersion]] = {}
        if not document_ids:
            return result
        models = await self._session.scalars(
            select(V)
            .where(V.workspace_id == workspace_id, V.document_id.in_(document_ids))
            .order_by(V.document_id, V.number.desc())
        )
        for model in models:
            result.setdefault(model.document_id, []).append(_to_version(model))
        return result

    async def delete_version(self, workspace_id: uuid.UUID, version_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(V).where(V.workspace_id == workspace_id, V.id == version_id)
        )

    async def blobs_in_use(
        self, workspace_id: uuid.UUID, blob_ids: Sequence[uuid.UUID]
    ) -> set[uuid.UUID]:
        if not blob_ids:
            return set()
        return set(
            await self._session.scalars(
                select(V.blob_id)
                .where(V.workspace_id == workspace_id, V.blob_id.in_(blob_ids))
                .distinct()
            )
        )

    # Folders

    async def add_folder(self, folder: Folder) -> None:
        self._session.add(
            DocumentFolderModel(
                id=folder.id,
                workspace_id=folder.workspace_id,
                parent_id=folder.parent_id,
                name=folder.name,
                created_at=folder.created_at,
                updated_at=folder.updated_at,
            )
        )
        await flush(self._session)

    async def get_folder(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> Folder | None:
        model = await self._session.scalar(
            select(DocumentFolderModel).where(
                DocumentFolderModel.workspace_id == workspace_id,
                DocumentFolderModel.id == folder_id,
            )
        )
        return _to_folder(model) if model else None

    async def folders(self, workspace_id: uuid.UUID) -> list[FolderUsage]:
        counts = (
            select(D.folder_id, func.count().label("total"))
            .where(D.workspace_id == workspace_id, D.trashed_at.is_(None))
            .group_by(D.folder_id)
            .subquery()
        )
        rows = await self._session.execute(
            select(DocumentFolderModel, counts.c.total)
            .outerjoin(counts, counts.c.folder_id == DocumentFolderModel.id)
            .where(DocumentFolderModel.workspace_id == workspace_id)
            .order_by(func.lower(DocumentFolderModel.name), DocumentFolderModel.id)
        )
        return [FolderUsage(_to_folder(model), int(total or 0)) for model, total in rows]

    async def save_folder(self, folder: Folder) -> None:
        await self._session.execute(
            update(DocumentFolderModel)
            .where(
                DocumentFolderModel.workspace_id == folder.workspace_id,
                DocumentFolderModel.id == folder.id,
            )
            .values(name=folder.name, parent_id=folder.parent_id, updated_at=folder.updated_at)
        )

    async def reparent_folders(
        self, workspace_id: uuid.UUID, parent_id: uuid.UUID, new_parent: uuid.UUID | None
    ) -> None:
        await self._session.execute(
            update(DocumentFolderModel)
            .where(
                DocumentFolderModel.workspace_id == workspace_id,
                DocumentFolderModel.parent_id == parent_id,
            )
            .values(parent_id=new_parent)
        )

    async def delete_folder(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(DocumentFolderModel).where(
                DocumentFolderModel.workspace_id == workspace_id,
                DocumentFolderModel.id == folder_id,
            )
        )
        await flush(self._session)

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[CategoryUsage]:
        counts = (
            select(D.category_id, func.count().label("total"))
            .where(D.workspace_id == workspace_id, D.trashed_at.is_(None))
            .group_by(D.category_id)
            .subquery()
        )
        rows = await self._session.execute(
            select(DocumentCategoryModel, counts.c.total)
            .outerjoin(counts, counts.c.category_id == DocumentCategoryModel.id)
            .where(DocumentCategoryModel.workspace_id == workspace_id)
            .order_by(DocumentCategoryModel.position, DocumentCategoryModel.id)
        )
        return [CategoryUsage(_to_category(model), int(total or 0)) for model, total in rows]

    async def add_category(self, category: Category) -> None:
        self._session.add(
            DocumentCategoryModel(
                id=category.id,
                workspace_id=category.workspace_id,
                name=category.name,
                normalized_name=normalize_name(category.name),
                icon=category.icon,
                position=category.position,
                created_at=category.created_at,
                updated_at=category.updated_at,
            )
        )
        await flush(self._session)

    async def get_category(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID
    ) -> Category | None:
        model = await self._session.scalar(
            select(DocumentCategoryModel).where(
                DocumentCategoryModel.workspace_id == workspace_id,
                DocumentCategoryModel.id == category_id,
            )
        )
        return _to_category(model) if model else None

    async def save_category(self, category: Category) -> None:
        await self._session.execute(
            update(DocumentCategoryModel)
            .where(
                DocumentCategoryModel.workspace_id == category.workspace_id,
                DocumentCategoryModel.id == category.id,
            )
            .values(
                name=category.name,
                normalized_name=normalize_name(category.name),
                icon=category.icon,
                updated_at=category.updated_at,
            )
        )
        await flush(self._session)

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(DocumentCategoryModel).where(
                DocumentCategoryModel.workspace_id == workspace_id,
                DocumentCategoryModel.id == category_id,
            )
        )

    # Renewals

    async def add_renewal(self, renewal: DocumentRenewal) -> None:
        self._session.add(
            DocumentRenewalModel(
                id=renewal.id,
                workspace_id=renewal.workspace_id,
                document_id=renewal.document_id,
                previous_issue_date=renewal.previous_issue_date,
                previous_expiry_date=renewal.previous_expiry_date,
                previous_renewal_date=renewal.previous_renewal_date,
                issue_date=renewal.issue_date,
                expiry_date=renewal.expiry_date,
                renewal_date=renewal.renewal_date,
                note=renewal.note,
                renewed_at=renewal.renewed_at,
            )
        )
        await flush(self._session)

    async def renewals(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID
    ) -> list[DocumentRenewal]:
        models = await self._session.scalars(
            select(DocumentRenewalModel)
            .where(
                DocumentRenewalModel.workspace_id == workspace_id,
                DocumentRenewalModel.document_id == document_id,
            )
            .order_by(DocumentRenewalModel.renewed_at.desc(), DocumentRenewalModel.id)
        )
        return [_to_renewal(model) for model in models]

    # Links

    async def target_exists(self, workspace_id: uuid.UUID, target: LinkTarget) -> bool:
        titles = _titles(target.kind)
        model = titles.model
        found = await self._session.scalar(
            select(model.id).where(model.workspace_id == workspace_id, model.id == target.id)
        )
        return found is not None

    async def add_link(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, target: LinkTarget, at: datetime
    ) -> None:
        column = _LINK_COLUMNS[target.kind]
        existing = await self._session.scalar(
            select(L.id).where(
                L.workspace_id == workspace_id, L.document_id == document_id, column == target.id
            )
        )
        if existing is not None:
            return
        link = DocumentLinkModel(
            id=uuid.uuid4(), workspace_id=workspace_id, document_id=document_id, created_at=at
        )
        setattr(link, column.key, target.id)
        self._session.add(link)
        await flush(self._session)

    async def remove_link(
        self, workspace_id: uuid.UUID, document_id: uuid.UUID, target: LinkTarget
    ) -> None:
        column = _LINK_COLUMNS[target.kind]
        await self._session.execute(
            delete(L).where(
                L.workspace_id == workspace_id, L.document_id == document_id, column == target.id
            )
        )

    async def links(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> list[LinkedRecord]:
        rows = list(
            await self._session.scalars(
                select(L).where(L.workspace_id == workspace_id, L.document_id == document_id)
            )
        )
        wanted: dict[LinkKind, dict[uuid.UUID, datetime]] = {}
        for row in rows:
            for kind, column in _LINK_COLUMNS.items():
                value = getattr(row, column.key)
                if value is not None:
                    wanted.setdefault(kind, {})[value] = row.created_at
        records: list[LinkedRecord] = []
        for kind, ids in wanted.items():
            titles = _titles(kind)
            found = await self._session.execute(
                select(titles.model.id, titles.title, titles.detail).where(
                    titles.model.workspace_id == workspace_id, titles.model.id.in_(list(ids))
                )
            )
            for record_id, title, detail in found:
                name, text = _describe(kind, title, detail)
                records.append(LinkedRecord(kind, record_id, name, text, ids[record_id]))
        records.sort(key=lambda record: (record.linked_at, str(record.id)), reverse=True)
        return records

    async def candidates(
        self, workspace_id: uuid.UUID, kind: LinkKind, search: str | None, limit: int
    ) -> list[LinkedRecord]:
        titles = _titles(kind)
        conditions: list[ColumnElement[bool]] = [titles.model.workspace_id == workspace_id]
        if titles.visible is not None:
            conditions.append(titles.visible)
        if search:
            conditions.extend(
                titles.title.ilike(contains_pattern(word), escape=LIKE_ESCAPE)
                for word in search.split()[:MAX_SEARCH_WORDS]
            )
        rows = await self._session.execute(
            select(titles.model.id, titles.title, titles.detail, titles.created)
            .where(*conditions)
            .order_by(titles.created.desc(), titles.model.id)
            .limit(limit)
        )
        result: list[LinkedRecord] = []
        for record_id, title, detail, created in rows:
            name, text = _describe(kind, title, detail)
            at = (
                created
                if isinstance(created, datetime)
                else datetime.combine(created, time.min, tzinfo=UTC)
            )
            result.append(LinkedRecord(kind, record_id, name, text, at))
        return result

    # Helpers

    async def _model(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> DocumentModel | None:
        return await self._session.scalar(
            select(D).where(D.workspace_id == workspace_id, D.id == document_id)
        )

    async def _tags_of(
        self, workspace_id: uuid.UUID, document_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[str]]:
        result: dict[uuid.UUID, list[str]] = {}
        if not document_ids:
            return result
        rows = await self._session.execute(
            select(DocumentTagModel.document_id, DocumentTagModel.name)
            .where(
                DocumentTagModel.workspace_id == workspace_id,
                DocumentTagModel.document_id.in_(document_ids),
            )
            .order_by(DocumentTagModel.normalized_name)
        )
        for document_id, name in rows:
            result.setdefault(document_id, []).append(name)
        return result

    async def _set_tags(self, document: Document) -> None:
        current = await self._tags_of(document.workspace_id, [document.id])
        if current.get(document.id, []) == sorted(document.tags, key=normalize_name):
            return
        await self._session.execute(
            delete(DocumentTagModel).where(
                DocumentTagModel.workspace_id == document.workspace_id,
                DocumentTagModel.document_id == document.id,
            )
        )
        for tag in document.tags:
            self._session.add(
                DocumentTagModel(
                    document_id=document.id,
                    workspace_id=document.workspace_id,
                    name=tag,
                    normalized_name=normalize_name(tag),
                )
            )
        await flush(self._session)


def build_document_service(
    session: AsyncSession, files: FileStore, clock: Callable[[], datetime] = utc_now
) -> DocumentService:
    return DocumentService(
        SqlDocumentStore(session),
        files,
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        SqlTransaction(session),
        clock,
    )


def build_document_reminders(
    session: AsyncSession, clock: Callable[[], datetime] = utc_now
) -> DocumentReminders:
    """Document reminders sharing `session`'s transaction, for the reminder worker."""
    return DocumentReminders(
        SqlDocumentStore(session),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        clock,
    )


async def referenced_blob_ids(session: AsyncSession) -> set[uuid.UUID]:
    """Every file the attachment store should keep, across workspaces: note attachments and
    document versions. Used only by the worker's sweep of unreferenced files."""
    attachments = await session.scalars(select(NoteAttachmentModel.id))
    blobs = await session.scalars(select(V.blob_id).distinct())
    return set(attachments) | set(blobs)
