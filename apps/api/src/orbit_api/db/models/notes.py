"""Notes: folders, notes (including quick notes and journal entries), tags, links between notes,
links to tasks, and attachment metadata.

Every table carries `workspace_id`, and every relationship between them is a composite foreign
key on `(id, workspace_id)`, so the database itself refuses a link, tag, or folder that crosses
workspaces.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class NoteFolderModel(Base):
    """A folder of notes, optionally inside another folder of the same workspace.

    Deleting a folder deletes its subfolders (the self-referencing key cascades), but never its
    notes: `notes.folder_id` has no `ON DELETE` action, so the service must first move the notes
    somewhere the user chose. Cycles are prevented by the service, which walks the ancestors.
    """

    __tablename__ = "note_folders"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="not_own_parent"),
        UniqueConstraint("id", "workspace_id"),
        ForeignKeyConstraint(
            ["parent_id", "workspace_id"],
            ["note_folders.id", "note_folders.workspace_id"],
            name="fk_note_folders_parent_id_note_folders",
            ondelete="CASCADE",
        ),
        Index("ix_note_folders_workspace_parent", "workspace_id", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column()
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class NoteModel(Base):
    """A note. `content` is the editor's document (ProseMirror JSON, the only copy of the text);
    `plain_text` is derived from it on every save for search and previews.

    `revision` counts changes to the title or content, so a client can say which version it
    edited and a stale save is refused instead of overwriting newer text.
    """

    __tablename__ = "notes"
    __table_args__ = (
        CheckConstraint("note_type IN ('note', 'quick', 'journal')", name="note_type"),
        CheckConstraint("length(title) <= 200", name="title_length"),
        CheckConstraint("length(content) <= 1000000", name="content_length"),
        CheckConstraint(
            "(note_type = 'journal') = (journal_date IS NOT NULL)", name="journal_date_matches_type"
        ),
        CheckConstraint("revision >= 1", name="revision_positive"),
        UniqueConstraint("id", "workspace_id"),
        # One journal entry per day in a workspace. Other notes have no date, and NULLs are
        # distinct on both databases.
        UniqueConstraint("workspace_id", "journal_date", name="uq_notes_workspace_journal_date"),
        ForeignKeyConstraint(
            ["folder_id", "workspace_id"],
            ["note_folders.id", "note_folders.workspace_id"],
            name="fk_notes_folder_id_note_folders",
        ),
        Index("ix_notes_workspace_updated_at", "workspace_id", "updated_at"),
        Index("ix_notes_workspace_folder", "workspace_id", "folder_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    folder_id: Mapped[uuid.UUID | None] = mapped_column()
    note_type: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    content_format: Mapped[str] = mapped_column(String(32))
    plain_text: Mapped[str] = mapped_column(Text)
    journal_date: Mapped[date | None] = mapped_column(Date)
    is_pinned: Mapped[bool] = mapped_column(Boolean)
    is_favorite: Mapped[bool] = mapped_column(Boolean)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    trashed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revision: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    last_opened_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class NoteTagModel(Base):
    """A tag, reusable across a workspace's notes. `normalized_name` (trimmed, single-spaced,
    case-folded) is unique, so "Work", "work ", and "WORK" are one tag."""

    __tablename__ = "note_tags"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 50", name="name_length"),
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("workspace_id", "normalized_name", name="uq_note_tags_workspace_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    normalized_name: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class NoteTagAssignmentModel(Base):
    """A tag on a note. Deleting either deletes the assignment."""

    __tablename__ = "note_tag_assignments"
    __table_args__ = (
        PrimaryKeyConstraint("note_id", "tag_id"),
        ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_note_tag_assignments_note_id_notes",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tag_id", "workspace_id"],
            ["note_tags.id", "note_tags.workspace_id"],
            name="fk_note_tag_assignments_tag_id_note_tags",
            ondelete="CASCADE",
        ),
        Index("ix_note_tag_assignments_tag_id", "tag_id"),
    )

    note_id: Mapped[uuid.UUID] = mapped_column()
    tag_id: Mapped[uuid.UUID] = mapped_column()
    workspace_id: Mapped[uuid.UUID] = mapped_column()


class NoteLinkModel(Base):
    """A link from one note's content to another note. Derived from the source's content on
    every save, never edited directly; one row per pair however often the link appears."""

    __tablename__ = "note_links"
    __table_args__ = (
        PrimaryKeyConstraint("source_note_id", "target_note_id"),
        CheckConstraint("source_note_id <> target_note_id", name="not_self"),
        ForeignKeyConstraint(
            ["source_note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_note_links_source_note_id_notes",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["target_note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_note_links_target_note_id_notes",
            ondelete="CASCADE",
        ),
        # Backlinks look links up by their target.
        Index("ix_note_links_target_note_id", "target_note_id"),
    )

    source_note_id: Mapped[uuid.UUID] = mapped_column()
    target_note_id: Mapped[uuid.UUID] = mapped_column()
    workspace_id: Mapped[uuid.UUID] = mapped_column()


class NoteTaskLinkModel(Base):
    """A task linked to a note. The task stays in `tasks`; this row only relates the two."""

    __tablename__ = "note_task_links"
    __table_args__ = (
        PrimaryKeyConstraint("note_id", "task_id"),
        ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_note_task_links_note_id_notes",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_note_task_links_task_id_tasks",
            ondelete="CASCADE",
        ),
        Index("ix_note_task_links_task_id", "task_id"),
    )

    note_id: Mapped[uuid.UUID] = mapped_column()
    task_id: Mapped[uuid.UUID] = mapped_column()
    workspace_id: Mapped[uuid.UUID] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class NoteAttachmentModel(Base):
    """A file attached to a note. Only metadata lives here; the bytes are in the attachment
    store (a directory on the API's machine), under the attachment's ID."""

    __tablename__ = "note_attachments"
    __table_args__ = (
        CheckConstraint("length(filename) BETWEEN 1 AND 255", name="filename_length"),
        CheckConstraint("size_bytes >= 0", name="size_not_negative"),
        ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_note_attachments_note_id_notes",
            ondelete="CASCADE",
        ),
        Index("ix_note_attachments_note_id", "note_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    note_id: Mapped[uuid.UUID] = mapped_column()
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
