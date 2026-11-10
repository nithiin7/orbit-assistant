"""Bookmark types: saved pages, videos, and reels, optionally grouped into collections."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from orbit_api.utils.changes import UNSET, Change

BookmarkKind = Literal["link", "article", "video", "reel", "repo", "tool"]
# `reference`: kept to come back to; `later`: to read or watch; `done`: read or watched.
BookmarkStatus = Literal["reference", "later", "done"]
CollectionColor = Literal["blue", "green", "amber", "rose", "violet", "teal", "orange", "slate"]

# A workspace's collections are few and meant to be scanned at a glance.
MAX_COLLECTIONS = 50
MAX_TAGS = 10
MAX_TAG_LENGTH = 30
MAX_URL_LENGTH = 2048
MAX_TITLE_LENGTH = 200


@dataclass(frozen=True, slots=True)
class Bookmark:
    id: uuid.UUID
    workspace_id: uuid.UUID
    collection_id: uuid.UUID | None
    url: str
    title: str
    # What the page is for, in the user's words.
    note: str
    kind: BookmarkKind
    status: BookmarkStatus
    tags: tuple[str, ...]
    pinned: bool
    open_count: int
    last_opened_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # The page's own description, from its preview.
    preview_description: str | None = None
    previewed_at: datetime | None = None
    image: "PreviewFile | None" = None
    icon: "PreviewFile | None" = None


@dataclass(frozen=True, slots=True)
class BookmarkDraft:
    """A new bookmark. A missing title, kind, or status is filled in from the URL."""

    url: str
    title: str | None = None
    note: str = ""
    kind: BookmarkKind | None = None
    status: BookmarkStatus | None = None
    tags: tuple[str, ...] = ()
    pinned: bool = False
    collection_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class BookmarkChanges:
    """A partial update. `UNSET` leaves a field as it is; `collection_id=None` takes the bookmark
    out of its collection."""

    url: Change[str] = UNSET
    title: Change[str] = UNSET
    note: Change[str] = UNSET
    kind: Change[BookmarkKind] = UNSET
    status: Change[BookmarkStatus] = UNSET
    tags: Change[tuple[str, ...]] = UNSET
    pinned: Change[bool] = UNSET
    collection_id: Change[uuid.UUID | None] = UNSET


@dataclass(frozen=True, slots=True)
class BookmarkCollection:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    color: CollectionColor
    # Collections are shown in this order: oldest first.
    position: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class CollectionOverview:
    collection: BookmarkCollection
    bookmarks: int


@dataclass(frozen=True, slots=True)
class CollectionChanges:
    name: Change[str] = UNSET
    color: Change[CollectionColor] = UNSET


class BookmarkNotFoundError(Exception):
    """The bookmark does not exist in this workspace."""


class DuplicateBookmarkError(Exception):
    """The workspace already has a bookmark with this URL."""

    def __init__(self, existing_id: uuid.UUID) -> None:
        super().__init__()
        self.existing_id = existing_id


class CollectionNotFoundError(Exception):
    """The collection does not exist in this workspace."""


class CollectionNameTakenError(Exception):
    """Another collection in the workspace has the same name, ignoring case and spacing."""


class TooManyCollectionsError(Exception):
    """The workspace already has `MAX_COLLECTIONS` collections."""


@dataclass(frozen=True, slots=True)
class PreviewFile:
    """A stored preview image or icon: its file in the attachment store, and its type."""

    id: uuid.UUID
    content_type: str


@dataclass(frozen=True, slots=True)
class FetchedPage:
    # Where the page ended up, after redirects.
    url: str
    html: str


class PreviewsOffError(Exception):
    """The workspace hasn't turned link previews on."""


class PreviewFetchError(Exception):
    """The page or image couldn't be fetched, or wasn't what was expected."""


class BlockedAddressError(PreviewFetchError):
    """The link points at a private, local, or otherwise non-public address, or a port other
    than 80 or 443, which previews never contact."""
