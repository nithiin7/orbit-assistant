"""Bookmark models."""

import uuid
from datetime import datetime
from typing import Annotated, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import multi_line, single_line
from orbit_api.services.bookmarks.models import (
    MAX_TAG_LENGTH,
    MAX_TAGS,
    MAX_TITLE_LENGTH,
    MAX_URL_LENGTH,
    Bookmark,
    BookmarkChanges,
    BookmarkCollection,
    BookmarkDraft,
    BookmarkKind,
    BookmarkStatus,
    CollectionChanges,
    CollectionColor,
    CollectionOverview,
)
from orbit_api.utils.changes import UNSET


def web_url(value: str) -> str:
    """Only `http` and `https` URLs with a host, so a saved link can never run script."""
    if any(c.isspace() for c in value):
        raise ValueError("must not contain spaces")
    try:
        parts = urlsplit(value)
        host = parts.hostname
    except ValueError:
        raise ValueError("must be a valid web address") from None
    if parts.scheme.lower() not in ("http", "https") or not host:
        raise ValueError("must be a web address starting with http:// or https://")
    return value


Url = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_URL_LENGTH),
    AfterValidator(single_line),
    AfterValidator(web_url),
]
Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TITLE_LENGTH),
    AfterValidator(single_line),
]
Note = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=1000), AfterValidator(multi_line)
]
Tag = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TAG_LENGTH),
    AfterValidator(single_line),
]
Tags = Annotated[list[Tag], Field(max_length=MAX_TAGS)]
CollectionName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
    AfterValidator(single_line),
]


class BookmarkResponse(BaseModel):
    id: uuid.UUID
    collection_id: uuid.UUID | None = Field(description="The collection it's in, if any.")
    url: str
    title: str
    note: str = Field(description="What the page is for. Empty when not given.")
    kind: BookmarkKind
    status: BookmarkStatus = Field(
        description="`reference`: kept to come back to; `later`: to read or watch; `done`."
    )
    tags: list[str]
    pinned: bool
    open_count: int = Field(description="How many times it was opened from Orbit.")
    last_opened_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, bookmark: Bookmark) -> "BookmarkResponse":
        return cls(
            id=bookmark.id,
            collection_id=bookmark.collection_id,
            url=bookmark.url,
            title=bookmark.title,
            note=bookmark.note,
            kind=bookmark.kind,
            status=bookmark.status,
            tags=list(bookmark.tags),
            pinned=bookmark.pinned,
            open_count=bookmark.open_count,
            last_opened_at=bookmark.last_opened_at,
            created_at=bookmark.created_at,
            updated_at=bookmark.updated_at,
        )


class BookmarksResponse(BaseModel):
    bookmarks: list[BookmarkResponse] = Field(description="Every bookmark, newest first.")


class CreateBookmarkRequest(BaseModel):
    """Save a URL. Without a title, kind, or status, they're worked out from the URL alone; the
    page itself is never fetched."""

    model_config = ConfigDict(extra="forbid")

    url: Url
    title: Title | None = None
    note: Note = ""
    kind: BookmarkKind | None = None
    status: BookmarkStatus | None = None
    tags: Tags = Field(default_factory=list[Tag])
    pinned: bool = False
    collection_id: uuid.UUID | None = Field(default=None, description="A collection here.")

    def to_draft(self) -> BookmarkDraft:
        return BookmarkDraft(
            url=self.url,
            title=self.title,
            note=self.note,
            kind=self.kind,
            status=self.status,
            tags=tuple(self.tags),
            pinned=self.pinned,
            collection_id=self.collection_id,
        )


class UpdateBookmarkRequest(BaseModel):
    """Change some of a bookmark's fields. Omitted fields keep their values; `collection_id:
    null` takes it out of its collection."""

    model_config = ConfigDict(extra="forbid")

    url: Url | None = None
    title: Title | None = None
    note: Note | None = None
    kind: BookmarkKind | None = None
    status: BookmarkStatus | None = None
    tags: Tags | None = None
    pinned: bool | None = None
    collection_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set - {"collection_id"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> BookmarkChanges:
        return BookmarkChanges(
            url=self.url if self.url is not None else UNSET,
            title=self.title if self.title is not None else UNSET,
            note=self.note if self.note is not None else UNSET,
            kind=self.kind if self.kind is not None else UNSET,
            status=self.status if self.status is not None else UNSET,
            tags=tuple(self.tags) if self.tags is not None else UNSET,
            pinned=self.pinned if self.pinned is not None else UNSET,
            collection_id=self.collection_id if "collection_id" in self.model_fields_set else UNSET,
        )


class BookmarkCollectionResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: CollectionColor
    position: int = Field(description="Collections are shown in this order.")
    bookmarks: int = Field(description="Bookmarks in the collection.")

    @classmethod
    def of(cls, collection: BookmarkCollection, bookmarks: int) -> "BookmarkCollectionResponse":
        return cls(
            id=collection.id,
            name=collection.name,
            color=collection.color,
            position=collection.position,
            bookmarks=bookmarks,
        )

    @classmethod
    def of_overview(cls, overview: CollectionOverview) -> "BookmarkCollectionResponse":
        return cls.of(overview.collection, overview.bookmarks)


class BookmarkCollectionsResponse(BaseModel):
    collections: list[BookmarkCollectionResponse]


class CreateBookmarkCollectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CollectionName
    color: CollectionColor = "blue"


class UpdateBookmarkCollectionRequest(BaseModel):
    """Rename or recolor a collection. Omitted fields keep their values."""

    model_config = ConfigDict(extra="forbid")

    name: CollectionName | None = None
    color: CollectionColor | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> CollectionChanges:
        return CollectionChanges(
            name=self.name if self.name is not None else UNSET,
            color=self.color if self.color is not None else UNSET,
        )
