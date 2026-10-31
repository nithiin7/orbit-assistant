"""Notes: capture, organize, connect, and find a workspace's notes.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. IDs from another workspace
behave exactly like IDs that don't exist, and the database's composite foreign keys refuse any
folder, tag, link, or task relationship that crosses workspaces.

- **Content** is the editor document (`content.py`); plain text and links to other notes are
  derived from it on every save. Links name notes by ID, so renaming a note never breaks them.
- **Revisions:** a title or content change bumps `revision`. A client that sends the revision it
  edited gets `RevisionConflictError` instead of overwriting a newer save.
- **Trash:** notes are moved to the trash first, and only trashed notes can be deleted for good.
- **Folders** form a tree. Moves that would put a folder inside itself are refused, and
  deleting a folder never silently deletes notes: the caller chooses where they go.
- **Journal:** one entry per day, found or created by date.
"""

import re
import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import date, datetime
from typing import Protocol

from orbit_api.services.notes.content import (
    CONTENT_FORMAT,
    EMPTY_DOCUMENT,
    NoteDocument,
    load_document,
)
from orbit_api.services.notes.models import (
    MAX_FOLDER_DEPTH,
    MAX_TAGS_PER_NOTE,
    TITLE_MAX_LENGTH,
    Folder,
    FolderDeleteMode,
    FolderMoveError,
    FolderNotFoundError,
    FolderUsage,
    JournalChangeError,
    LinkedTaskNotFoundError,
    Note,
    NoteChanges,
    NoteConnections,
    NoteCounts,
    NoteDetail,
    NoteDraft,
    NoteNotFoundError,
    NoteNotTrashedError,
    NotePage,
    NoteQuery,
    NoteSummary,
    NoteType,
    RevisionConflictError,
    Tag,
    TagNameTakenError,
    TagNotFoundError,
    TagUsage,
    TooManyTagsError,
)
from orbit_api.services.tasks.models import Task
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.clock import utc_now

EXCERPT_LENGTH = 180
_WHITESPACE = re.compile(r"\s+")


def normalize_tag_name(name: str) -> str:
    """The form tags are compared in: trimmed, single-spaced, and case-folded."""
    return _WHITESPACE.sub(" ", name).strip().casefold()


def clean_tag_name(name: str) -> str:
    """The form a tag is shown in: as typed, without extra spaces."""
    return _WHITESPACE.sub(" ", name).strip()


def search_terms(search: str | None) -> list[str]:
    """The words of a search, each of which must match. At most eight are used."""
    if not search:
        return []
    return [term for term in search.split() if term][:8]


def excerpt(text: str, terms: Sequence[str] = ()) -> str:
    """The start of `text`, or the text around the first of `terms` it contains, on one line."""
    flat = _WHITESPACE.sub(" ", text).strip()
    lowered = flat.casefold()
    positions = [p for p in (lowered.find(term.casefold()) for term in terms) if p >= 0]
    if not positions or min(positions) < EXCERPT_LENGTH // 2:
        return flat if len(flat) <= EXCERPT_LENGTH else flat[:EXCERPT_LENGTH].rstrip() + "…"
    start = min(positions) - EXCERPT_LENGTH // 3
    # Start at a word boundary.
    space = flat.find(" ", start)
    start = space + 1 if 0 <= space < min(positions) else start
    end = start + EXCERPT_LENGTH
    body = flat[start:end].strip()
    return "…" + body + ("…" if end < len(flat) else "")


class NoteRepository(Protocol):
    async def add(self, note: Note) -> None: ...

    async def get(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> Note | None:
        """The note, only if it belongs to `workspace_id`."""
        ...

    async def get_journal(self, workspace_id: uuid.UUID, entry_date: date) -> Note | None: ...

    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> tuple[list[Note], int]:
        """A page of matching notes and how many match in all."""
        ...

    async def save(self, note: Note) -> None:
        """Store an existing note's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]) -> int: ...

    async def trashed_ids(self, workspace_id: uuid.UUID) -> list[uuid.UUID]: ...

    async def set_links(
        self, workspace_id: uuid.UUID, source_id: uuid.UUID, target_ids: frozenset[uuid.UUID]
    ) -> None:
        """Replace the note's outgoing links with those of `target_ids` that exist in the
        workspace (other IDs are ignored)."""
        ...

    async def connections(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteConnections: ...

    async def task_ids(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[uuid.UUID]: ...

    async def tasks(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[Task]: ...

    async def link_task(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, task_id: uuid.UUID, at: datetime
    ) -> None:
        """Link the task; linking a linked task again changes nothing."""
        ...

    async def unlink_task(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, task_id: uuid.UUID
    ) -> bool: ...

    async def counts(self, workspace_id: uuid.UUID) -> NoteCounts: ...

    async def move_notes(
        self,
        workspace_id: uuid.UUID,
        folder_ids: Sequence[uuid.UUID],
        to_folder: uuid.UUID | None,
        trashed_at: datetime | None,
    ) -> None:
        """Move every note in `folder_ids` to `to_folder`, trashing active ones if `trashed_at`."""
        ...


class NoteFolderRepository(Protocol):
    async def add(self, folder: Folder) -> None: ...

    async def get(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> Folder | None: ...

    async def all(self, workspace_id: uuid.UUID) -> list[FolderUsage]: ...

    async def save(self, folder: Folder) -> None: ...

    async def reparent_children(
        self, workspace_id: uuid.UUID, folder_id: uuid.UUID, parent_id: uuid.UUID | None
    ) -> None: ...

    async def delete(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> None:
        """Delete the folder and, by cascade, its subfolders."""
        ...


class NoteTagRepository(Protocol):
    async def add(self, tag: Tag) -> None: ...

    async def get(self, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> Tag | None: ...

    async def get_by_name(self, workspace_id: uuid.UUID, normalized_name: str) -> Tag | None: ...

    async def all(self, workspace_id: uuid.UUID) -> list[TagUsage]: ...

    async def save(self, tag: Tag) -> None: ...

    async def delete(self, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> bool: ...

    async def for_notes(
        self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[Tag]]:
        """Each note's tags, by name."""
        ...

    async def assign(self, workspace_id: uuid.UUID, note_id: uuid.UUID, tag_id: uuid.UUID) -> None:
        """Tag the note; tagging it again changes nothing."""
        ...

    async def unassign(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, tag_id: uuid.UUID
    ) -> bool: ...

    async def copy_assignments(
        self, workspace_id: uuid.UUID, from_note: uuid.UUID, to_note: uuid.UUID
    ) -> None: ...


class TaskLookup(Protocol):
    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None: ...


class NoteService:
    def __init__(
        self,
        notes: NoteRepository,
        folders: NoteFolderRepository,
        tags: NoteTagRepository,
        tasks: TaskLookup,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._notes = notes
        self._folders = folders
        self._tags = tags
        self._tasks = tasks
        self._transaction = transaction
        self._clock = clock

    # Notes

    async def create(self, workspace_id: uuid.UUID, draft: NoteDraft) -> NoteDetail:
        if draft.folder_id is not None:
            await self._get_folder(workspace_id, draft.folder_id)
        if len({normalize_tag_name(name) for name in draft.tag_names}) > MAX_TAGS_PER_NOTE:
            raise TooManyTagsError
        note = self._new_note(
            workspace_id,
            title=draft.title,
            document=draft.document or EMPTY_DOCUMENT,
            note_type=draft.note_type,
            folder_id=draft.folder_id,
        )
        await self._notes.add(note)
        await self._notes.set_links(workspace_id, note.id, self._targets(note, draft.document))
        for name in draft.tag_names:
            tag = await self._get_or_create_tag(workspace_id, name)
            await self._tags.assign(workspace_id, note.id, tag.id)
        await self._transaction.commit()
        return await self.detail(workspace_id, note.id)

    async def get(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> Note:
        note = await self._notes.get(workspace_id, note_id)
        if note is None:
            raise NoteNotFoundError
        return note

    async def detail(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteDetail:
        note = await self.get(workspace_id, note_id)
        tags = await self._tags.for_notes(workspace_id, [note.id])
        return NoteDetail(
            note=note,
            tags=tags.get(note.id, []),
            task_ids=await self._notes.task_ids(workspace_id, note.id),
        )

    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> NotePage:
        notes, total = await self._notes.find(workspace_id, query)
        tags = await self._tags.for_notes(workspace_id, [note.id for note in notes])
        terms = search_terms(query.search)
        items = [
            NoteSummary(
                note=note, tags=tags.get(note.id, []), excerpt=excerpt(note.plain_text, terms)
            )
            for note in notes
        ]
        return NotePage(items=items, total=total)

    async def counts(self, workspace_id: uuid.UUID) -> NoteCounts:
        return await self._notes.counts(workspace_id)

    async def update(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, changes: NoteChanges
    ) -> NoteDetail:
        note = await self.get(workspace_id, note_id)
        edits_text = changes.title is not UNSET or changes.document is not UNSET
        if (
            edits_text
            and changes.expected_revision is not None
            and changes.expected_revision != note.revision
        ):
            raise RevisionConflictError(note)
        if changes.note_type is not UNSET and note.note_type == "journal":
            raise JournalChangeError
        if changes.folder_id is not UNSET and changes.folder_id is not None:
            await self._get_folder(workspace_id, changes.folder_id)

        now = self._clock()
        updated = note
        if changes.title is not UNSET:
            updated = replace(updated, title=changes.title)
        if changes.document is not UNSET:
            updated = replace(
                updated,
                content=changes.document.json,
                plain_text=changes.document.plain_text,
            )
        text_changed = updated.title != note.title or updated.content != note.content
        if text_changed:
            updated = replace(updated, revision=note.revision + 1, updated_at=now)
        if changes.folder_id is not UNSET:
            updated = replace(updated, folder_id=changes.folder_id)
        if changes.note_type is not UNSET:
            updated = replace(updated, note_type=changes.note_type)
        if changes.is_pinned is not UNSET:
            updated = replace(updated, is_pinned=changes.is_pinned)
        if changes.is_favorite is not UNSET:
            updated = replace(updated, is_favorite=changes.is_favorite)
        if changes.archived is not UNSET and changes.archived != (note.archived_at is not None):
            updated = replace(updated, archived_at=now if changes.archived else None)

        if updated == note:
            return await self.detail(workspace_id, note_id)
        await self._notes.save(updated)
        if changes.document is not UNSET:
            await self._notes.set_links(
                workspace_id, note.id, self._targets(updated, changes.document)
            )
        await self._transaction.commit()
        return await self.detail(workspace_id, note_id)

    async def mark_opened(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> None:
        """Record that the note was opened, for the Recent view. Not an edit."""
        note = await self.get(workspace_id, note_id)
        await self._notes.save(replace(note, last_opened_at=self._clock()))
        await self._transaction.commit()

    async def trash(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteDetail:
        note = await self.get(workspace_id, note_id)
        if note.trashed_at is None:
            await self._notes.save(replace(note, trashed_at=self._clock(), is_pinned=False))
            await self._transaction.commit()
        return await self.detail(workspace_id, note_id)

    async def restore(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteDetail:
        note = await self.get(workspace_id, note_id)
        if note.trashed_at is not None:
            await self._notes.save(replace(note, trashed_at=None))
            await self._transaction.commit()
        return await self.detail(workspace_id, note_id)

    async def delete_permanently(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> None:
        note = await self.get(workspace_id, note_id)
        if note.trashed_at is None:
            raise NoteNotTrashedError
        await self._notes.delete(workspace_id, [note_id])
        await self._transaction.commit()

    async def trashed_ids(self, workspace_id: uuid.UUID) -> list[uuid.UUID]:
        return await self._notes.trashed_ids(workspace_id)

    async def empty_trash(self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]) -> int:
        """Delete these trashed notes for good (the caller lists them first, to clean up their
        attachments afterwards). Notes restored meanwhile are skipped by the repository."""
        deleted = await self._notes.delete(workspace_id, note_ids)
        await self._transaction.commit()
        return deleted

    async def duplicate(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteDetail:
        """A copy in the same folder with the same tags. A journal entry's copy is an ordinary
        note, since each day has one entry. Linked tasks and attachments aren't copied."""
        source = await self.get(workspace_id, note_id)
        suffix = " (copy)"
        base = source.title or (f"Journal {source.journal_date}" if source.journal_date else "")
        title = base[: TITLE_MAX_LENGTH - len(suffix)] + suffix if base else ""
        document = load_document(source.content)
        copy = self._new_note(
            workspace_id,
            title=title,
            document=document,
            note_type="note" if source.note_type == "journal" else source.note_type,
            folder_id=source.folder_id,
        )
        await self._notes.add(copy)
        await self._notes.set_links(workspace_id, copy.id, self._targets(copy, document))
        await self._tags.copy_assignments(workspace_id, source.id, copy.id)
        await self._transaction.commit()
        return await self.detail(workspace_id, copy.id)

    # Links between notes

    async def connections(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> NoteConnections:
        await self.get(workspace_id, note_id)
        return await self._notes.connections(workspace_id, note_id)

    # Tasks

    async def tasks(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[Task]:
        await self.get(workspace_id, note_id)
        return await self._notes.tasks(workspace_id, note_id)

    async def link_task(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, task_id: uuid.UUID
    ) -> list[Task]:
        await self.get(workspace_id, note_id)
        if await self._tasks.get(workspace_id, task_id) is None:
            raise LinkedTaskNotFoundError
        await self._notes.link_task(workspace_id, note_id, task_id, self._clock())
        await self._transaction.commit()
        return await self._notes.tasks(workspace_id, note_id)

    async def unlink_task(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        await self.get(workspace_id, note_id)
        if await self._notes.unlink_task(workspace_id, note_id, task_id):
            await self._transaction.commit()

    # Journal

    async def journal_entry(self, workspace_id: uuid.UUID, entry_date: date) -> Note | None:
        return await self._notes.get_journal(workspace_id, entry_date)

    async def open_journal(
        self, workspace_id: uuid.UUID, entry_date: date
    ) -> tuple[NoteDetail, bool]:
        """The day's entry, created if there is none (and taken out of the trash if it was
        there). Reports whether it was created. Two concurrent first opens get the same entry."""
        existing = await self._notes.get_journal(workspace_id, entry_date)
        if existing is not None:
            if existing.trashed_at is not None:
                await self._notes.save(replace(existing, trashed_at=None))
                await self._transaction.commit()
            return await self.detail(workspace_id, existing.id), False
        note = replace(
            self._new_note(
                workspace_id,
                title="",
                document=EMPTY_DOCUMENT,
                note_type="journal",
                folder_id=None,
            ),
            journal_date=entry_date,
        )
        try:
            await self._notes.add(note)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            winner = await self._notes.get_journal(workspace_id, entry_date)
            if winner is None:
                raise
            return await self.detail(workspace_id, winner.id), False
        return await self.detail(workspace_id, note.id), True

    # Folders

    async def folders(self, workspace_id: uuid.UUID) -> list[FolderUsage]:
        return await self._folders.all(workspace_id)

    async def create_folder(
        self, workspace_id: uuid.UUID, name: str, parent_id: uuid.UUID | None
    ) -> Folder:
        if parent_id is not None:
            await self._get_folder(workspace_id, parent_id)
            if len(await self._ancestors(workspace_id, parent_id)) + 1 >= MAX_FOLDER_DEPTH:
                raise FolderMoveError
        now = self._clock()
        folder = Folder(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            parent_id=parent_id,
            name=name,
            created_at=now,
            updated_at=now,
        )
        await self._folders.add(folder)
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
        if parent_id is not UNSET:
            if parent_id is not None:
                await self._check_move(workspace_id, folder, parent_id)
            updated = replace(updated, parent_id=parent_id)
        if updated == folder:
            return folder
        updated = replace(updated, updated_at=self._clock())
        await self._folders.save(updated)
        await self._transaction.commit()
        return updated

    async def delete_folder(
        self, workspace_id: uuid.UUID, folder_id: uuid.UUID, mode: FolderDeleteMode
    ) -> None:
        folder = await self._get_folder(workspace_id, folder_id)
        if mode == "parent":
            # Only this folder goes; its notes and subfolders move up a level.
            await self._notes.move_notes(workspace_id, [folder.id], folder.parent_id, None)
            await self._folders.reparent_children(workspace_id, folder.id, folder.parent_id)
        else:
            # The folder and its subfolders go; all their notes move out first.
            subtree = await self._subtree(workspace_id, folder.id)
            trashed_at = self._clock() if mode == "trash" else None
            await self._notes.move_notes(workspace_id, subtree, None, trashed_at)
        await self._folders.delete(workspace_id, folder.id)
        await self._transaction.commit()

    # Tags

    async def tags(self, workspace_id: uuid.UUID) -> list[TagUsage]:
        return await self._tags.all(workspace_id)

    async def create_tag(self, workspace_id: uuid.UUID, name: str) -> Tag:
        normalized = normalize_tag_name(name)
        if await self._tags.get_by_name(workspace_id, normalized) is not None:
            raise TagNameTakenError
        tag = self._new_tag(workspace_id, name)
        try:
            await self._tags.add(tag)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise TagNameTakenError from None
        return tag

    async def rename_tag(self, workspace_id: uuid.UUID, tag_id: uuid.UUID, name: str) -> Tag:
        tag = await self._get_tag(workspace_id, tag_id)
        normalized = normalize_tag_name(name)
        other = await self._tags.get_by_name(workspace_id, normalized)
        if other is not None and other.id != tag.id:
            raise TagNameTakenError
        updated = replace(tag, name=clean_tag_name(name), normalized_name=normalized)
        if updated != tag:
            try:
                await self._tags.save(updated)
                await self._transaction.commit()
            except ConflictError:
                await self._transaction.rollback()
                raise TagNameTakenError from None
        return updated

    async def delete_tag(self, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> None:
        if not await self._tags.delete(workspace_id, tag_id):
            raise TagNotFoundError
        await self._transaction.commit()

    async def add_tag(self, workspace_id: uuid.UUID, note_id: uuid.UUID, name: str) -> list[Tag]:
        """Tag the note by name, creating the tag if the workspace has none by that name."""
        await self.get(workspace_id, note_id)
        current = (await self._tags.for_notes(workspace_id, [note_id])).get(note_id, [])
        normalized = normalize_tag_name(name)
        if any(tag.normalized_name == normalized for tag in current):
            return current
        if len(current) >= MAX_TAGS_PER_NOTE:
            raise TooManyTagsError
        tag = await self._get_or_create_tag(workspace_id, name)
        await self._tags.assign(workspace_id, note_id, tag.id)
        try:
            await self._transaction.commit()
        except ConflictError:
            # Someone created the same tag at the same moment; use theirs.
            await self._transaction.rollback()
            existing = await self._tags.get_by_name(workspace_id, normalized)
            if existing is None:
                raise
            await self._tags.assign(workspace_id, note_id, existing.id)
            await self._transaction.commit()
        return (await self._tags.for_notes(workspace_id, [note_id])).get(note_id, [])

    async def remove_tag(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, tag_id: uuid.UUID
    ) -> None:
        await self.get(workspace_id, note_id)
        if await self._tags.unassign(workspace_id, note_id, tag_id):
            await self._transaction.commit()

    # Helpers

    def _new_note(
        self,
        workspace_id: uuid.UUID,
        *,
        title: str,
        document: NoteDocument,
        note_type: NoteType,
        folder_id: uuid.UUID | None,
    ) -> Note:
        now = self._clock()
        return Note(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            folder_id=folder_id,
            note_type=note_type,
            title=title,
            content=document.json,
            content_format=CONTENT_FORMAT,
            plain_text=document.plain_text,
            journal_date=None,
            is_pinned=False,
            is_favorite=False,
            archived_at=None,
            trashed_at=None,
            revision=1,
            created_at=now,
            updated_at=now,
            last_opened_at=None,
        )

    def _new_tag(self, workspace_id: uuid.UUID, name: str) -> Tag:
        return Tag(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=clean_tag_name(name),
            normalized_name=normalize_tag_name(name),
            created_at=self._clock(),
        )

    @staticmethod
    def _targets(note: Note, document: NoteDocument | None) -> frozenset[uuid.UUID]:
        if document is None:
            return frozenset()
        return document.linked_note_ids - {note.id}

    async def _get_or_create_tag(self, workspace_id: uuid.UUID, name: str) -> Tag:
        existing = await self._tags.get_by_name(workspace_id, normalize_tag_name(name))
        if existing is not None:
            return existing
        tag = self._new_tag(workspace_id, name)
        await self._tags.add(tag)
        return tag

    async def _get_folder(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> Folder:
        folder = await self._folders.get(workspace_id, folder_id)
        if folder is None:
            raise FolderNotFoundError
        return folder

    async def _get_tag(self, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> Tag:
        tag = await self._tags.get(workspace_id, tag_id)
        if tag is None:
            raise TagNotFoundError
        return tag

    async def _ancestors(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> list[uuid.UUID]:
        """`folder_id`'s ancestors, nearest first. Stops at a cycle rather than looping."""
        by_id = {usage.folder.id: usage.folder for usage in await self._folders.all(workspace_id)}
        chain: list[uuid.UUID] = []
        current = by_id.get(folder_id)
        while current is not None and current.parent_id is not None:
            if current.parent_id in chain or len(chain) > MAX_FOLDER_DEPTH * 4:
                break
            chain.append(current.parent_id)
            current = by_id.get(current.parent_id)
        return chain

    async def _subtree(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> list[uuid.UUID]:
        """The folder and every folder below it."""
        children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
        for usage in await self._folders.all(workspace_id):
            children.setdefault(usage.folder.parent_id, []).append(usage.folder.id)
        found = [folder_id]
        index = 0
        while index < len(found):
            found.extend(child for child in children.get(found[index], []) if child not in found)
            index += 1
        return found

    async def _check_move(
        self, workspace_id: uuid.UUID, folder: Folder, new_parent: uuid.UUID
    ) -> None:
        """Refuse moving `folder` into itself, a subfolder, or deeper than allowed."""
        await self._get_folder(workspace_id, new_parent)
        subtree = await self._subtree(workspace_id, folder.id)
        if new_parent in subtree:
            raise FolderMoveError
        # Depth of the new parent plus the moved branch's own height.
        parent_depth = len(await self._ancestors(workspace_id, new_parent)) + 1
        height = await self._height(workspace_id, folder.id)
        if parent_depth + height > MAX_FOLDER_DEPTH:
            raise FolderMoveError

    async def _height(self, workspace_id: uuid.UUID, folder_id: uuid.UUID) -> int:
        """Levels in the branch rooted at `folder_id`, counting itself."""
        children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
        for usage in await self._folders.all(workspace_id):
            children.setdefault(usage.folder.parent_id, []).append(usage.folder.id)
        level, frontier = 0, [folder_id]
        while frontier and level <= MAX_FOLDER_DEPTH * 4:
            level += 1
            frontier = [child for node in frontier for child in children.get(node, [])]
        return level
