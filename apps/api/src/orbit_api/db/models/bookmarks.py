"""Bookmarks: saved web pages, videos, and reels, shown as "Saved" in the app."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

BOOKMARK_COLLECTION_COLORS = (
    "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"
)


class BookmarkCollectionModel(Base):
    """A named, colored group of bookmarks in one workspace, such as Work tools or Recipes. A
    bookmark is in at most one collection. Deleting the workspace deletes its collections."""

    __tablename__ = "bookmark_collections"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 50", name="name_length"),
        CheckConstraint(f"color IN {BOOKMARK_COLLECTION_COLORS}", name="color"),
        # The target of `bookmarks`' composite foreign key, which keeps a bookmark in the same
        # workspace as its collection.
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("workspace_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    # Whitespace collapsed and case-folded, so "Recipes" and "recipes" are one collection.
    normalized_name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class BookmarkModel(Base):
    """A saved URL in one workspace. Deleting the workspace deletes its bookmarks."""

    __tablename__ = "bookmarks"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('link', 'article', 'video', 'reel', 'repo', 'tool')", name="kind"
        ),
        CheckConstraint("status IN ('reference', 'later', 'done')", name="status"),
        CheckConstraint("length(url) BETWEEN 1 AND 2048", name="url_length"),
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("length(note) <= 1000", name="note_length"),
        CheckConstraint("open_count >= 0", name="open_count_positive"),
        # No ON DELETE action: deleting a collection clears it from its bookmarks first.
        ForeignKeyConstraint(
            ["collection_id", "workspace_id"],
            ["bookmark_collections.id", "bookmark_collections.workspace_id"],
            name="fk_bookmarks_collection",
        ),
        Index("ix_bookmarks_workspace_collection", "workspace_id", "collection_id"),
        Index("ix_bookmarks_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    collection_id: Mapped[uuid.UUID | None]
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String(200))
    # What the page is for, in the user's words.
    note: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    # A list of tag names.
    tags: Mapped[list[Any]] = mapped_column(JSON)
    pinned: Mapped[bool]
    open_count: Mapped[int] = mapped_column(Integer)
    last_opened_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    # Set by the service on edits only (no `onupdate`): opening a bookmark isn't editing it.
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
