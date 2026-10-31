"""Notes, folders, tags, links, and attachments. Every query is filtered by workspace, so callers
cannot reach other workspaces' rows.

Search is a case-insensitive substring match per word (`ILIKE`, with `%`, `_`, and `\\` matched
literally) over the title, the derived plain text, tag names, and the folder's name. Each word must
match somewhere. It can't use an index and scans one workspace's notes, which is fine at personal
scale; PostgreSQL full-text search or SQLite FTS5 can replace this function without changing the
service if that changes.
"""

import uuid
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import (
    ColumnElement,
    and_,
    case,
    delete,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    NoteAttachmentModel,
    NoteFolderModel,
    NoteLinkModel,
    NoteModel,
    NoteTagAssignmentModel,
    NoteTagModel,
    NoteTaskLinkModel,
    TaskModel,
)
from orbit_api.repositories.tasks import SqlTaskRepository, to_task
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.notes.attachments import AttachmentService, AttachmentStore
from orbit_api.services.notes.models import (
    Attachment,
    Folder,
    FolderUsage,
    Note,
    NoteConnections,
    NoteCounts,
    NoteNotFoundError,
    NoteQuery,
    NoteRef,
    NoteType,
    Tag,
    TagUsage,
)
from orbit_api.services.notes.service import NoteService, search_terms
from orbit_api.services.tasks.models import Task
from orbit_api.utils.changes import UNSET
from orbit_api.utils.text_search import LIKE_ESCAPE, contains_pattern


def _to_note(model: NoteModel) -> Note:
    return Note(
        id=model.id,
        workspace_id=model.workspace_id,
        folder_id=model.folder_id,
        # The table's CHECK constraint limits `note_type` to these values.
        note_type=cast(NoteType, model.note_type),
        title=model.title,
        content=model.content,
        content_format=model.content_format,
        plain_text=model.plain_text,
        journal_date=model.journal_date,
        is_pinned=model.is_pinned,
        is_favorite=model.is_favorite,
        archived_at=model.archived_at,
        trashed_at=model.trashed_at,
        revision=model.revision,
        created_at=model.created_at,
        updated_at=model.updated_at,
        last_opened_at=model.last_opened_at,
    )


def _to_folder(model: NoteFolderModel) -> Folder:
    return Folder(
        id=model.id,
        workspace_id=model.workspace_id,
        parent_id=model.parent_id,
        name=model.name,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_tag(model: NoteTagModel) -> Tag:
    return Tag(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        normalized_name=model.normalized_name,
        created_at=model.created_at,
    )


def _to_attachment(model: NoteAttachmentModel) -> Attachment:
    return Attachment(
        id=model.id,
        workspace_id=model.workspace_id,
        note_id=model.note_id,
        filename=model.filename,
        content_type=model.content_type,
        size_bytes=model.size_bytes,
        created_at=model.created_at,
    )


def _to_ref(model: NoteModel) -> NoteRef:
    return NoteRef(
        id=model.id,
        title=model.title,
        note_type=cast(NoteType, model.note_type),
        journal_date=model.journal_date,
        archived=model.archived_at is not None,
    )


def _is_active() -> ColumnElement[bool]:
    return and_(NoteModel.archived_at.is_(None), NoteModel.trashed_at.is_(None))


def _matches(term: str) -> ColumnElement[bool]:
    pattern = contains_pattern(term)
    tagged = exists().where(
        NoteTagAssignmentModel.note_id == NoteModel.id,
        NoteTagModel.id == NoteTagAssignmentModel.tag_id,
        NoteTagModel.name.ilike(pattern, escape=LIKE_ESCAPE),
    )
    in_folder = exists().where(
        NoteFolderModel.id == NoteModel.folder_id,
        NoteFolderModel.workspace_id == NoteModel.workspace_id,
        NoteFolderModel.name.ilike(pattern, escape=LIKE_ESCAPE),
    )
    return or_(
        NoteModel.title.ilike(pattern, escape=LIKE_ESCAPE),
        NoteModel.plain_text.ilike(pattern, escape=LIKE_ESCAPE),
        tagged,
        in_folder,
    )


def _filters(workspace_id: uuid.UUID, query: NoteQuery) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [NoteModel.workspace_id == workspace_id]
    match query.state:
        case "active":
            conditions.append(_is_active())
        case "archived":
            conditions += [NoteModel.archived_at.is_not(None), NoteModel.trashed_at.is_(None)]
        case "trashed":
            conditions.append(NoteModel.trashed_at.is_not(None))
    if query.folder_id is not UNSET:
        conditions.append(
            NoteModel.folder_id.is_(None)
            if query.folder_id is None
            else NoteModel.folder_id == query.folder_id
        )
    if query.note_types:
        conditions.append(NoteModel.note_type.in_(sorted(query.note_types)))
    if query.tag_id is not None:
        conditions.append(
            exists().where(
                NoteTagAssignmentModel.note_id == NoteModel.id,
                NoteTagAssignmentModel.tag_id == query.tag_id,
            )
        )
    if query.task_id is not None:
        conditions.append(
            exists().where(
                NoteTaskLinkModel.note_id == NoteModel.id,
                NoteTaskLinkModel.task_id == query.task_id,
            )
        )
    if query.favorite is not None:
        conditions.append(NoteModel.is_favorite.is_(query.favorite))
    if query.pinned is not None:
        conditions.append(NoteModel.is_pinned.is_(query.pinned))
    conditions += [_matches(term) for term in search_terms(query.search)]
    return conditions


def _ordering(query: NoteQuery) -> list[ColumnElement[Any]]:
    descending = query.order != "asc"
    order: list[ColumnElement[Any]] = []
    if query.pinned_first:
        order.append(NoteModel.is_pinned.desc())
    match query.sort:
        case "updated_at":
            column = NoteModel.updated_at
            order.append(column.desc() if descending else column.asc())
        case "created_at":
            column = NoteModel.created_at
            order.append(column.desc() if descending else column.asc())
        case "recent":
            opened = func.coalesce(NoteModel.last_opened_at, NoteModel.updated_at)
            order.append(opened.desc() if descending else opened.asc())
        case "journal_date":
            order += [
                NoteModel.journal_date.is_(None),
                NoteModel.journal_date.desc() if descending else NoteModel.journal_date.asc(),
            ]
        case "title":
            # A to Z by default; untitled notes last either way.
            title = func.lower(NoteModel.title)
            ascending = query.order != "desc"
            order += [NoteModel.title == "", title.asc() if ascending else title.desc()]
    order += [NoteModel.updated_at.desc(), NoteModel.id.asc()]
    return order


def _count(condition: ColumnElement[bool]) -> ColumnElement[int]:
    # COUNT skips the NULL that CASE yields for non-matching rows.
    return func.count(case((condition, 1)))


class SqlNoteRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, note: Note) -> None:
        self._session.add(
            NoteModel(
                id=note.id,
                workspace_id=note.workspace_id,
                folder_id=note.folder_id,
                note_type=note.note_type,
                title=note.title,
                content=note.content,
                content_format=note.content_format,
                plain_text=note.plain_text,
                journal_date=note.journal_date,
                is_pinned=note.is_pinned,
                is_favorite=note.is_favorite,
                archived_at=note.archived_at,
                trashed_at=note.trashed_at,
                revision=note.revision,
                created_at=note.created_at,
                updated_at=note.updated_at,
                last_opened_at=note.last_opened_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> Note | None:
        model = await self._get_model(workspace_id, note_id)
        return _to_note(model) if model else None

    async def exists(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> bool:
        found = await self._session.scalar(
            select(NoteModel.id).where(
                NoteModel.id == note_id, NoteModel.workspace_id == workspace_id
            )
        )
        return found is not None

    async def get_journal(self, workspace_id: uuid.UUID, entry_date: date) -> Note | None:
        model = await self._session.scalar(
            select(NoteModel).where(
                NoteModel.workspace_id == workspace_id, NoteModel.journal_date == entry_date
            )
        )
        return _to_note(model) if model else None

    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> tuple[list[Note], int]:
        conditions = _filters(workspace_id, query)
        total = await self._session.scalar(select(func.count()).where(*conditions))
        models = await self._session.scalars(
            select(NoteModel)
            .where(*conditions)
            .order_by(*_ordering(query))
            .limit(query.limit)
            .offset(query.offset)
        )
        return [_to_note(model) for model in models], total or 0

    async def save(self, note: Note) -> None:
        model = await self._get_model(note.workspace_id, note.id)
        if model is None:
            raise NoteNotFoundError
        model.folder_id = note.folder_id
        model.note_type = note.note_type
        model.title = note.title
        model.content = note.content
        model.content_format = note.content_format
        model.plain_text = note.plain_text
        model.journal_date = note.journal_date
        model.is_pinned = note.is_pinned
        model.is_favorite = note.is_favorite
        model.archived_at = note.archived_at
        model.trashed_at = note.trashed_at
        model.revision = note.revision
        model.updated_at = note.updated_at
        model.last_opened_at = note.last_opened_at
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]) -> int:
        """Delete these notes, if they are in the trash."""
        if not note_ids:
            return 0
        deleted = await self._session.scalars(
            delete(NoteModel)
            .where(
                NoteModel.workspace_id == workspace_id,
                NoteModel.id.in_(note_ids),
                NoteModel.trashed_at.is_not(None),
            )
            .returning(NoteModel.id)
        )
        return len(deleted.all())

    async def trashed_ids(self, workspace_id: uuid.UUID) -> list[uuid.UUID]:
        ids = await self._session.scalars(
            select(NoteModel.id).where(
                NoteModel.workspace_id == workspace_id, NoteModel.trashed_at.is_not(None)
            )
        )
        return list(ids)

    async def set_links(
        self, workspace_id: uuid.UUID, source_id: uuid.UUID, target_ids: frozenset[uuid.UUID]
    ) -> None:
        await self._session.execute(
            delete(NoteLinkModel).where(
                NoteLinkModel.workspace_id == workspace_id,
                NoteLinkModel.source_note_id == source_id,
            )
        )
        if not target_ids:
            return
        # Only targets in this workspace: a link to another workspace's note (or a deleted one)
        # stays in the text but relates nothing.
        await self._session.execute(
            insert(NoteLinkModel).from_select(
                ["source_note_id", "target_note_id", "workspace_id"],
                select(literal(source_id), NoteModel.id, NoteModel.workspace_id).where(
                    NoteModel.workspace_id == workspace_id,
                    NoteModel.id.in_(target_ids),
                    NoteModel.id != source_id,
                ),
            )
        )

    async def connections(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteConnections:
        not_trashed = NoteModel.trashed_at.is_(None)
        outgoing = await self._session.scalars(
            select(NoteModel)
            .join(NoteLinkModel, NoteLinkModel.target_note_id == NoteModel.id)
            .where(
                NoteLinkModel.workspace_id == workspace_id,
                NoteLinkModel.source_note_id == note_id,
                not_trashed,
            )
            .order_by(func.lower(NoteModel.title), NoteModel.id)
        )
        backlinks = await self._session.scalars(
            select(NoteModel)
            .join(NoteLinkModel, NoteLinkModel.source_note_id == NoteModel.id)
            .where(
                NoteLinkModel.workspace_id == workspace_id,
                NoteLinkModel.target_note_id == note_id,
                not_trashed,
            )
            .order_by(NoteModel.updated_at.desc(), NoteModel.id)
        )
        return NoteConnections(
            outgoing=[_to_ref(model) for model in outgoing],
            backlinks=[_to_ref(model) for model in backlinks],
        )

    async def task_ids(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[uuid.UUID]:
        ids = await self._session.scalars(
            select(NoteTaskLinkModel.task_id)
            .where(
                NoteTaskLinkModel.workspace_id == workspace_id,
                NoteTaskLinkModel.note_id == note_id,
            )
            .order_by(NoteTaskLinkModel.created_at, NoteTaskLinkModel.task_id)
        )
        return list(ids)

    async def tasks(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[Task]:
        models = await self._session.scalars(
            select(TaskModel)
            .join(NoteTaskLinkModel, NoteTaskLinkModel.task_id == TaskModel.id)
            .where(
                NoteTaskLinkModel.workspace_id == workspace_id,
                NoteTaskLinkModel.note_id == note_id,
            )
            .order_by(NoteTaskLinkModel.created_at, TaskModel.id)
        )
        return [to_task(model) for model in models]

    async def link_task(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, task_id: uuid.UUID, at: datetime
    ) -> None:
        linked = await self._session.scalar(
            select(NoteTaskLinkModel.task_id).where(
                NoteTaskLinkModel.note_id == note_id, NoteTaskLinkModel.task_id == task_id
            )
        )
        if linked is None:
            self._session.add(
                NoteTaskLinkModel(
                    note_id=note_id, task_id=task_id, workspace_id=workspace_id, created_at=at
                )
            )
            await flush(self._session)

    async def unlink_task(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, task_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.scalars(
            delete(NoteTaskLinkModel)
            .where(
                NoteTaskLinkModel.workspace_id == workspace_id,
                NoteTaskLinkModel.note_id == note_id,
                NoteTaskLinkModel.task_id == task_id,
            )
            .returning(NoteTaskLinkModel.task_id)
        )
        return deleted.first() is not None

    async def counts(self, workspace_id: uuid.UUID) -> NoteCounts:
        active = _is_active()
        row = (
            await self._session.execute(
                select(
                    _count(and_(active, NoteModel.note_type != "journal")),
                    _count(
                        and_(
                            active, NoteModel.folder_id.is_(None), NoteModel.note_type != "journal"
                        )
                    ),
                    _count(and_(active, NoteModel.is_favorite)),
                    _count(and_(active, NoteModel.is_pinned)),
                    _count(and_(active, NoteModel.note_type == "journal")),
                    _count(
                        and_(NoteModel.archived_at.is_not(None), NoteModel.trashed_at.is_(None))
                    ),
                    _count(NoteModel.trashed_at.is_not(None)),
                ).where(NoteModel.workspace_id == workspace_id)
            )
        ).one()
        return NoteCounts(
            all=row[0],
            inbox=row[1],
            favorites=row[2],
            pinned=row[3],
            journal=row[4],
            archived=row[5],
            trashed=row[6],
        )

    async def move_notes(
        self,
        workspace_id: uuid.UUID,
        folder_ids: Sequence[uuid.UUID],
        to_folder: uuid.UUID | None,
        trashed_at: datetime | None,
    ) -> None:
        in_folders = and_(
            NoteModel.workspace_id == workspace_id, NoteModel.folder_id.in_(folder_ids)
        )
        if trashed_at is not None:
            await self._session.execute(
                update(NoteModel)
                .where(in_folders, NoteModel.trashed_at.is_(None))
                .values(trashed_at=trashed_at, is_pinned=False)
            )
        await self._session.execute(update(NoteModel).where(in_folders).values(folder_id=to_folder))

    async def _get_model(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteModel | None:
        return await self._session.scalar(
            select(NoteModel).where(NoteModel.id == note_id, NoteModel.workspace_id == workspace_id)
        )


class SqlNoteFolderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, folder: Folder) -> None:
        self._session.add(
            NoteFolderModel(
                id=folder.id,
                workspace_id=folder.workspace_id,
                parent_id=folder.parent_id,
                name=folder.name,
                created_at=folder.created_at,
                updated_at=folder.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> Folder | None:
        model = await self._get_model(workspace_id, folder_id)
        return _to_folder(model) if model else None

    async def all(self, workspace_id: uuid.UUID) -> list[FolderUsage]:
        counts = (
            select(NoteModel.folder_id, func.count().label("notes"))
            .where(NoteModel.workspace_id == workspace_id, _is_active())
            .group_by(NoteModel.folder_id)
            .subquery()
        )
        rows = await self._session.execute(
            select(NoteFolderModel, func.coalesce(counts.c.notes, 0))
            .outerjoin(counts, counts.c.folder_id == NoteFolderModel.id)
            .where(NoteFolderModel.workspace_id == workspace_id)
            .order_by(func.lower(NoteFolderModel.name), NoteFolderModel.id)
        )
        return [FolderUsage(folder=_to_folder(model), note_count=count) for model, count in rows]

    async def save(self, folder: Folder) -> None:
        model = await self._get_model(folder.workspace_id, folder.id)
        if model is None:
            return
        model.name = folder.name
        model.parent_id = folder.parent_id
        model.updated_at = folder.updated_at
        await flush(self._session)

    async def reparent_children(
        self, workspace_id: uuid.UUID, folder_id: uuid.UUID, parent_id: uuid.UUID | None
    ) -> None:
        await self._session.execute(
            update(NoteFolderModel)
            .where(
                NoteFolderModel.workspace_id == workspace_id,
                NoteFolderModel.parent_id == folder_id,
            )
            .values(parent_id=parent_id)
        )

    async def delete(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(NoteFolderModel).where(
                NoteFolderModel.workspace_id == workspace_id, NoteFolderModel.id == folder_id
            )
        )
        await flush(self._session)

    async def _get_model(
        self, workspace_id: uuid.UUID, folder_id: uuid.UUID
    ) -> NoteFolderModel | None:
        return await self._session.scalar(
            select(NoteFolderModel).where(
                NoteFolderModel.id == folder_id, NoteFolderModel.workspace_id == workspace_id
            )
        )


class SqlNoteTagRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, tag: Tag) -> None:
        self._session.add(
            NoteTagModel(
                id=tag.id,
                workspace_id=tag.workspace_id,
                name=tag.name,
                normalized_name=tag.normalized_name,
                created_at=tag.created_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> Tag | None:
        model = await self._get_model(workspace_id, tag_id)
        return _to_tag(model) if model else None

    async def get_by_name(self, workspace_id: uuid.UUID, normalized_name: str) -> Tag | None:
        model = await self._session.scalar(
            select(NoteTagModel).where(
                NoteTagModel.workspace_id == workspace_id,
                NoteTagModel.normalized_name == normalized_name,
            )
        )
        return _to_tag(model) if model else None

    async def all(self, workspace_id: uuid.UUID) -> list[TagUsage]:
        active_uses = (
            select(NoteTagAssignmentModel.tag_id, func.count().label("notes"))
            .join(NoteModel, NoteModel.id == NoteTagAssignmentModel.note_id)
            .where(NoteTagAssignmentModel.workspace_id == workspace_id, _is_active())
            .group_by(NoteTagAssignmentModel.tag_id)
            .subquery()
        )
        rows = await self._session.execute(
            select(NoteTagModel, func.coalesce(active_uses.c.notes, 0))
            .outerjoin(active_uses, active_uses.c.tag_id == NoteTagModel.id)
            .where(NoteTagModel.workspace_id == workspace_id)
            .order_by(NoteTagModel.normalized_name)
        )
        return [TagUsage(tag=_to_tag(model), note_count=count) for model, count in rows]

    async def save(self, tag: Tag) -> None:
        model = await self._get_model(tag.workspace_id, tag.id)
        if model is None:
            return
        model.name = tag.name
        model.normalized_name = tag.normalized_name
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> bool:
        deleted = await self._session.scalars(
            delete(NoteTagModel)
            .where(NoteTagModel.workspace_id == workspace_id, NoteTagModel.id == tag_id)
            .returning(NoteTagModel.id)
        )
        return deleted.first() is not None

    async def for_notes(
        self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[Tag]]:
        if not note_ids:
            return {}
        rows = await self._session.execute(
            select(NoteTagAssignmentModel.note_id, NoteTagModel)
            .join(NoteTagModel, NoteTagModel.id == NoteTagAssignmentModel.tag_id)
            .where(
                NoteTagAssignmentModel.workspace_id == workspace_id,
                NoteTagAssignmentModel.note_id.in_(note_ids),
            )
            .order_by(NoteTagModel.normalized_name)
        )
        tags: dict[uuid.UUID, list[Tag]] = {}
        for note_id, model in rows:
            tags.setdefault(note_id, []).append(_to_tag(model))
        return tags

    async def assign(self, workspace_id: uuid.UUID, note_id: uuid.UUID, tag_id: uuid.UUID) -> None:
        assigned = await self._session.scalar(
            select(NoteTagAssignmentModel.tag_id).where(
                NoteTagAssignmentModel.note_id == note_id, NoteTagAssignmentModel.tag_id == tag_id
            )
        )
        if assigned is None:
            self._session.add(
                NoteTagAssignmentModel(note_id=note_id, tag_id=tag_id, workspace_id=workspace_id)
            )
            await flush(self._session)

    async def unassign(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, tag_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.scalars(
            delete(NoteTagAssignmentModel)
            .where(
                NoteTagAssignmentModel.workspace_id == workspace_id,
                NoteTagAssignmentModel.note_id == note_id,
                NoteTagAssignmentModel.tag_id == tag_id,
            )
            .returning(NoteTagAssignmentModel.tag_id)
        )
        return deleted.first() is not None

    async def copy_assignments(
        self, workspace_id: uuid.UUID, from_note: uuid.UUID, to_note: uuid.UUID
    ) -> None:
        await self._session.execute(
            insert(NoteTagAssignmentModel).from_select(
                ["note_id", "tag_id", "workspace_id"],
                select(
                    literal(to_note),
                    NoteTagAssignmentModel.tag_id,
                    NoteTagAssignmentModel.workspace_id,
                ).where(
                    NoteTagAssignmentModel.workspace_id == workspace_id,
                    NoteTagAssignmentModel.note_id == from_note,
                ),
            )
        )

    async def _get_model(self, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> NoteTagModel | None:
        return await self._session.scalar(
            select(NoteTagModel).where(
                NoteTagModel.id == tag_id, NoteTagModel.workspace_id == workspace_id
            )
        )


class SqlAttachmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, attachment: Attachment) -> None:
        self._session.add(
            NoteAttachmentModel(
                id=attachment.id,
                workspace_id=attachment.workspace_id,
                note_id=attachment.note_id,
                filename=attachment.filename,
                content_type=attachment.content_type,
                size_bytes=attachment.size_bytes,
                created_at=attachment.created_at,
            )
        )
        await flush(self._session)

    async def get(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> Attachment | None:
        model = await self._session.scalar(
            select(NoteAttachmentModel).where(
                NoteAttachmentModel.workspace_id == workspace_id,
                NoteAttachmentModel.note_id == note_id,
                NoteAttachmentModel.id == attachment_id,
            )
        )
        return _to_attachment(model) if model else None

    async def for_note(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[Attachment]:
        models = await self._session.scalars(
            select(NoteAttachmentModel)
            .where(
                NoteAttachmentModel.workspace_id == workspace_id,
                NoteAttachmentModel.note_id == note_id,
            )
            .order_by(NoteAttachmentModel.created_at, NoteAttachmentModel.id)
        )
        return [_to_attachment(model) for model in models]

    async def delete(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.scalars(
            delete(NoteAttachmentModel)
            .where(
                NoteAttachmentModel.workspace_id == workspace_id,
                NoteAttachmentModel.note_id == note_id,
                NoteAttachmentModel.id == attachment_id,
            )
            .returning(NoteAttachmentModel.id)
        )
        return deleted.first() is not None

    async def ids_for_notes(
        self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]
    ) -> list[uuid.UUID]:
        if not note_ids:
            return []
        ids = await self._session.scalars(
            select(NoteAttachmentModel.id).where(
                NoteAttachmentModel.workspace_id == workspace_id,
                NoteAttachmentModel.note_id.in_(note_ids),
            )
        )
        return list(ids)


def build_note_service(session: AsyncSession) -> NoteService:
    return NoteService(
        SqlNoteRepository(session),
        SqlNoteFolderRepository(session),
        SqlNoteTagRepository(session),
        SqlTaskRepository(session),
        SqlTransaction(session),
    )


def build_attachment_service(session: AsyncSession, store: AttachmentStore) -> AttachmentService:
    return AttachmentService(
        SqlAttachmentRepository(session),
        SqlNoteRepository(session),
        store,
        SqlTransaction(session),
    )
