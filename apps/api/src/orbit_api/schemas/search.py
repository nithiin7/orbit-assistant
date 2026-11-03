"""Search across modules: the grouped search, universal search, and search history."""

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)

from orbit_api.schemas.common import Name
from orbit_api.services.search.history import RecentSearch, SavedSearch
from orbit_api.services.search.models import SearchGroup, SearchHit, SearchModule, SearchResults
from orbit_api.services.search.universal_models import (
    MAX_SEARCH_LIMIT,
    MAX_SEARCH_OFFSET,
    EntityType,
    HabitKindFilter,
    MatchKind,
    SearchFilters,
    SearchSort,
    TaskPriorityFilter,
    TaskStatusFilter,
    TransactionTypeFilter,
    UniversalHit,
    UniversalModule,
    UniversalQuery,
    UniversalResults,
)

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


# Universal search


class SearchFilterFields(BaseModel):
    """Filters shared by universal search and saved searches. Type-specific filters (dates,
    task status and priority, document category, transaction type, habit kind) limit results to
    the record types that have them."""

    model_config = ConfigDict(extra="forbid")

    module: list[UniversalModule] = Field(
        default_factory=list[UniversalModule], description="Repeat to search only some modules."
    )
    type: list[EntityType] = Field(
        default_factory=list[EntityType], description="Repeat to search only some record types."
    )
    date_from: date | None = Field(
        default=None, description="The record's own date: due date, event, transaction, …"
    )
    date_to: date | None = None
    updated_from: date | None = Field(default=None, description="UTC day.")
    updated_to: date | None = None
    created_from: date | None = Field(default=None, description="UTC day.")
    created_to: date | None = None
    task_status: TaskStatusFilter | None = None
    task_priority: list[TaskPriorityFilter] = Field(default_factory=list[TaskPriorityFilter])
    document_category: uuid.UUID | None = None
    transaction_type: list[TransactionTypeFilter] = Field(
        default_factory=list[TransactionTypeFilter]
    )
    habit_kind: list[HabitKindFilter] = Field(default_factory=list[HabitKindFilter])
    include_archived: bool = Field(
        default=False, description="Also search archived records. Trashed ones never are."
    )
    sort: SearchSort = Field(
        default="relevance", description="Best match first, or most recently updated first."
    )

    @model_validator(mode="after")
    def _ranges(self) -> Self:
        for start, end in (
            (self.date_from, self.date_to),
            (self.updated_from, self.updated_to),
            (self.created_from, self.created_to),
        ):
            if start is not None and end is not None and start > end:
                raise ValueError("A date range must not end before it starts.")
        return self

    def to_filters(self) -> SearchFilters:
        return SearchFilters(
            modules=tuple(dict.fromkeys(self.module)),
            types=tuple(dict.fromkeys(self.type)),
            date_from=self.date_from,
            date_to=self.date_to,
            updated_from=self.updated_from,
            updated_to=self.updated_to,
            created_from=self.created_from,
            created_to=self.created_to,
            task_status=self.task_status,
            task_priorities=tuple(dict.fromkeys(self.task_priority)),
            document_category_id=self.document_category,
            transaction_types=tuple(dict.fromkeys(self.transaction_type)),
            habit_kinds=tuple(dict.fromkeys(self.habit_kind)),
            include_archived=self.include_archived,
        )


class UniversalSearchParams(SearchFilterFields):
    q: Query = Field(description="Text to find; at least 2 characters.")
    offset: int = Field(default=0, ge=0, le=MAX_SEARCH_OFFSET)
    limit: int = Field(default=20, ge=1, le=MAX_SEARCH_LIMIT)

    def to_query(self) -> UniversalQuery:
        return UniversalQuery(
            text=self.q,
            filters=self.to_filters(),
            sort=self.sort,
            offset=self.offset,
            limit=self.limit,
        )


class SearchDetailResponse(BaseModel):
    key: str = Field(description="What the value is: status, folder, category, location, …")
    value: str


class UniversalSearchHitResponse(BaseModel):
    module: UniversalModule
    entity_type: EntityType
    id: uuid.UUID
    title: str = Field(description="May be empty (an untitled note, a measurement).")
    snippet: str = Field(description="Text around the match; may be empty.")
    matched_fields: list[str] = Field(description="Fields that matched a word of the query.")
    match: MatchKind = Field(description="The ranking tier the record matched in.")
    score: int
    active: bool = Field(description="Not completed, archived, cancelled, or disabled.")
    status: str
    details: list[SearchDetailResponse]
    day: date | None = Field(
        description="The record's own date; a recurring event's next occurrence."
    )
    starts_at: datetime | None = Field(description="A timed event's local wall-clock start.")
    all_day: bool
    parent_id: uuid.UUID | None = Field(description="A parent record, such as a holding's account.")
    updated_at: datetime

    @classmethod
    def of(cls, hit: UniversalHit) -> "UniversalSearchHitResponse":
        return cls(
            module=hit.module,
            entity_type=hit.entity_type,
            id=hit.id,
            title=hit.title,
            snippet=hit.snippet,
            matched_fields=list(hit.matched_fields),
            match=hit.match,
            score=hit.score,
            active=hit.active,
            status=hit.status,
            details=[SearchDetailResponse(key=d.key, value=d.value) for d in hit.details],
            day=hit.day,
            starts_at=hit.starts_at,
            all_day=hit.all_day,
            parent_id=hit.parent_id,
            updated_at=hit.updated_at,
        )


class SearchFacetResponse(BaseModel):
    module: UniversalModule
    total: int = Field(description="Matches under every filter except the module filter.")
    unavailable: bool


class UniversalSearchResponse(BaseModel):
    query: str
    sort: SearchSort
    offset: int
    limit: int
    total: int = Field(description="Matches in the chosen modules.")
    has_more: bool
    hits: list[UniversalSearchHitResponse]
    facets: list[SearchFacetResponse] = Field(description="Every module, in a fixed order.")
    unavailable: list[UniversalModule] = Field(description="Modules that couldn't be searched.")

    @classmethod
    def of(cls, results: UniversalResults) -> "UniversalSearchResponse":
        return cls(
            query=results.query,
            sort=results.sort,
            offset=results.offset,
            limit=results.limit,
            total=results.total,
            has_more=results.has_more,
            hits=[UniversalSearchHitResponse.of(hit) for hit in results.hits],
            facets=[
                SearchFacetResponse(module=f.module, total=f.total, unavailable=f.unavailable)
                for f in results.facets
            ],
            unavailable=results.unavailable,
        )


# Recent and saved searches


class RecentSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: Query


class RecentSearchResponse(BaseModel):
    id: uuid.UUID
    query: str
    used_at: datetime

    @classmethod
    def of(cls, search: RecentSearch) -> "RecentSearchResponse":
        return cls(id=search.id, query=search.query, used_at=search.used_at)


class RecentSearchListResponse(BaseModel):
    searches: list[RecentSearchResponse] = Field(description="Most recent first.")


class SavedSearchFilters(SearchFilterFields):
    """A saved search's filters: the same as the search's own."""


class SavedSearchCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    query: Query
    filters: SavedSearchFilters


class SavedSearchUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    query: Query | None = None
    filters: SavedSearchFilters | None = None


class SavedSearchResponse(BaseModel):
    id: uuid.UUID
    name: str
    query: str
    filters: SavedSearchFilters
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, search: SavedSearch) -> "SavedSearchResponse":
        try:
            filters = SavedSearchFilters.model_validate(dict(search.filters))
        # Filters saved by an older version that no longer validate fall back to none, so one
        # stale search can't break the list.
        except ValidationError:
            filters = SavedSearchFilters()
        return cls(
            id=search.id,
            name=search.name,
            query=search.query,
            filters=filters,
            created_at=search.created_at,
            updated_at=search.updated_at,
        )


class SavedSearchListResponse(BaseModel):
    searches: list[SavedSearchResponse] = Field(description="By name.")
