"""Search across modules."""

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from orbit_api.services.search.models import SearchGroup, SearchHit, SearchModule, SearchResults

SEARCH_MAX_LIMIT = 10

Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]


class SearchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: Query = Field(description="Text to find; at least 2 characters.")
    limit: int = Field(default=5, ge=1, le=SEARCH_MAX_LIMIT, description="Hits per module.")
    module: list[SearchModule] = Field(
        default_factory=list[SearchModule],
        description="Repeat to search only some modules. Omit for all.",
    )


class SearchHitResponse(BaseModel):
    id: uuid.UUID
    title: str
    detail: str = Field(description="A note's excerpt or an event's place; may be empty.")
    status: str = Field(
        description="A task's or habit's status, a note's or transaction's type, an event's "
        "status, or a document's state."
    )
    day: date | None = Field(
        description="A task's due date, an event's first day, a transaction's date, or a "
        "journal entry's day."
    )
    starts_at: datetime | None = Field(
        description="A timed event's local start, as wall-clock time in its own time zone."
    )
    all_day: bool

    @classmethod
    def of(cls, hit: SearchHit) -> "SearchHitResponse":
        return cls(
            id=hit.id,
            title=hit.title,
            detail=hit.detail,
            status=hit.status,
            day=hit.day,
            starts_at=hit.starts_at,
            all_day=hit.all_day,
        )


class SearchGroupResponse(BaseModel):
    module: SearchModule
    hits: list[SearchHitResponse]
    total: int = Field(description="Every match in the module, beyond the hits returned.")
    unavailable: bool = Field(description="The module couldn't be searched just now.")

    @classmethod
    def of(cls, group: SearchGroup) -> "SearchGroupResponse":
        return cls(
            module=group.module,
            hits=[SearchHitResponse.of(hit) for hit in group.hits],
            total=group.total,
            unavailable=group.unavailable,
        )


class SearchResponse(BaseModel):
    query: str
    groups: list[SearchGroupResponse] = Field(
        description="One group per module searched, in a fixed order, even when empty."
    )

    @classmethod
    def of(cls, results: SearchResults) -> "SearchResponse":
        return cls(query=results.query, groups=[SearchGroupResponse.of(g) for g in results.groups])
