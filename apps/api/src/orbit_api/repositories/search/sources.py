"""The SQL behind universal search: one declarative `EntitySource` per searchable record type,
and one query builder shared by all of them.

A source says where its records live (the table and its joins), how they are scoped (the
workspace, and for personal modules the user), which fields are searched and in which role
(title, metadata, description, content), which fields may be previewed in a snippet, its date,
when a record counts as active or archived, and which type-specific filters it supports.
`search_source` turns that into a single query per type:

- every word of the query must appear in some field (an escaped, case-insensitive `LIKE`, the
  same matching as the modules' own searches, so it runs unchanged on SQLite and PostgreSQL);
- the match tier and score come from the ranking strategy, as `CASE` expressions, so rows are
  sorted and limited in the database;
- `COUNT(*) OVER ()` gives the total in the same query, so there is no second count query.

There is no search index: queries read the live tables in the request's transaction, so results
can never be stale. Snippets are cut in Python from the few rows returned.
"""

import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal

from sqlalchemy import (
    ColumnElement,
    FromClause,
    Select,
    SQLColumnExpression,
    and_,
    case,
    false,
    func,
    label,
    literal,
    not_,
    or_,
    select,
)
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.services.notes.service import excerpt
from orbit_api.services.search.ranking import RankingStrategy
from orbit_api.services.search.universal_models import (
    EntityType,
    MatchKind,
    SearchDetail,
    SearchFilters,
    SearchScope,
    SourcePage,
    SpecificFilter,
    UniversalHit,
    UniversalModule,
    UniversalQuery,
)
from orbit_api.utils.text_search import LIKE_ESCAPE, contains_pattern, escape_like, prefix_pattern

Text = SQLColumnExpression[str] | SQLColumnExpression[str | None]
# Takes an escaped LIKE pattern and returns whether the row matches it.
Matcher = Callable[[str], ColumnElement[bool]]
FieldRole = Literal["metadata", "description", "content"]
Row = RowMapping
# Any select statement; joins only add FROM clauses.
AnySelect = Select[*tuple[Any, ...]]


def like(column: Text) -> Matcher:
    """Case-insensitive `LIKE` on a column (`ILIKE` on PostgreSQL)."""
    return lambda pattern: column.ilike(pattern, escape=LIKE_ESCAPE)


@dataclass(frozen=True, slots=True)
class SearchField:
    """A searched field besides the title. `preview` is the text a snippet may show; fields that
    could expose sensitive details (finance notes, document issuers) leave it unset, so a match
    names the field but shows nothing from it."""

    name: str
    role: FieldRole
    match: Matcher
    preview: Text | None = None


def text_field(name: str, role: FieldRole, column: Text, *, preview: bool = True) -> SearchField:
    return SearchField(name, role, like(column), column if preview else None)


@dataclass(frozen=True, slots=True)
class Description:
    """What a hit shows besides its title and snippet, read from a source's extra columns."""

    details: tuple[SearchDetail, ...] = ()
    day: date | None = None
    starts_at: datetime | None = None
    all_day: bool = False
    parent_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class DescribeContext:
    """What describing a row may depend on besides the row: the filters' date window (a
    recurring event shows its first occurrence in it) and today's UTC date."""

    today: date
    date_from: date | None
    date_to: date | None


def details(*pairs: tuple[str, object]) -> tuple[SearchDetail, ...]:
    """Detail facts, skipping empty values."""
    return tuple(SearchDetail(key, str(value)) for key, value in pairs if value not in (None, ""))


def _no_description(_row: Row, _context: DescribeContext) -> Description:
    return Description()


DateRange = Callable[[date | None, date | None], ColumnElement[bool]]


@dataclass(frozen=True, slots=True)
class EntitySource:
    module: UniversalModule
    entity_type: EntityType
    table: FromClause | type[Any]
    id: SQLColumnExpression[uuid.UUID]
    title: Text
    updated_at: SQLColumnExpression[datetime]
    created_at: SQLColumnExpression[datetime]
    # The record's status as the module names it, shown to the person.
    status: SQLColumnExpression[str] | ColumnElement[str]
    # Every condition that limits rows to what the person may see. Required: a source can't
    # be declared without its scope.
    scope: Callable[[SearchScope], Sequence[ColumnElement[bool]]]
    fields: tuple[SearchField, ...] = ()
    # Not completed, cancelled, archived, or disabled. Inactive records rank slightly lower.
    active: ColumnElement[bool] | SQLColumnExpression[bool] = field(
        default_factory=lambda: literal(True)
    )
    # Archived records are only searched with `include_archived`.
    archived: ColumnElement[bool] | None = None
    # Outer joins for metadata (folders, categories), applied to the select.
    joins: Callable[[AnySelect], AnySelect] = lambda statement: statement
    # The record's own date. `date_range` replaces the default `day BETWEEN from AND to`.
    day: SQLColumnExpression[date] | SQLColumnExpression[date | None] | None = None
    date_range: DateRange | None = None
    filters: Mapping[SpecificFilter, Callable[[SearchFilters], ColumnElement[bool]]] = field(
        default_factory=dict[SpecificFilter, Callable[[SearchFilters], ColumnElement[bool]]]
    )
    # Extra labelled columns for `describe`.
    columns: Mapping[str, SQLColumnExpression[Any] | ColumnElement[Any]] = field(
        default_factory=dict[str, SQLColumnExpression[Any] | ColumnElement[Any]]
    )
    describe: Callable[[Row, DescribeContext], Description] = _no_description

    def supports(self, filters: SearchFilters) -> bool:
        """Whether this source can satisfy the filters at all."""
        if filters.types and self.entity_type not in filters.types:
            return False
        supported = set(self.filters)
        if self.day is not None or self.date_range is not None:
            supported.add("date")
        return filters.specific() <= supported

    def in_dates(self, start: date | None, end: date | None) -> ColumnElement[bool]:
        if self.date_range is not None:
            return self.date_range(start, end)
        if self.day is None:
            return false()
        conditions: list[ColumnElement[bool]] = []
        if start is not None:
            conditions.append(self.day >= start)
        if end is not None:
            conditions.append(self.day <= end)
        return and_(*conditions)


def day_start(day: date) -> datetime:
    """Midnight UTC at the start of `day`."""
    return datetime.combine(day, time(), UTC)


def _between(
    column: SQLColumnExpression[datetime], start: date | None, end: date | None
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []
    if start is not None:
        conditions.append(column >= day_start(start))
    if end is not None:
        conditions.append(column < day_start(end + timedelta(days=1)))
    return conditions


def _conditions(
    source: EntitySource, scope: SearchScope, query: UniversalQuery
) -> list[ColumnElement[bool]]:
    filters = query.filters
    conditions = list(source.scope(scope))
    if source.archived is not None and not filters.include_archived:
        conditions.append(not_(source.archived))
    title = like(source.title)
    for word in query.words:
        pattern = contains_pattern(word)
        conditions.append(or_(title(pattern), *(f.match(pattern) for f in source.fields)))
    if "date" in filters.specific():
        conditions.append(source.in_dates(filters.date_from, filters.date_to))
    conditions += _between(source.updated_at, filters.updated_from, filters.updated_to)
    conditions += _between(source.created_at, filters.created_from, filters.created_to)
    for name in filters.specific() - {"date"}:
        conditions.append(source.filters[name](filters))
    return conditions


def _tiers(
    source: EntitySource, query: UniversalQuery
) -> list[tuple[MatchKind, ColumnElement[bool]]]:
    """Each match tier's condition, best first; a row gets the first that holds."""
    phrase = query.phrase
    whole = contains_pattern(phrase)

    def any_role(role: FieldRole) -> ColumnElement[bool]:
        matches = [f.match(whole) for f in source.fields if f.role == role]
        return or_(*matches) if matches else false()

    title_words = and_(
        *(source.title.ilike(contains_pattern(w), escape=LIKE_ESCAPE) for w in query.words)
    )
    return [
        ("exact_title", source.title.ilike(escape_like(phrase), escape=LIKE_ESCAPE)),
        ("title_prefix", source.title.ilike(prefix_pattern(phrase), escape=LIKE_ESCAPE)),
        ("title_phrase", source.title.ilike(whole, escape=LIKE_ESCAPE)),
        ("title_words", title_words),
        ("metadata", any_role("metadata")),
        ("description", any_role("description")),
        ("content", any_role("content")),
    ]


def _snippet(source: EntitySource, row: Row, words: Sequence[str]) -> str:
    """Text around the match from the first previewable field that matched; otherwise the start
    of the first previewable description or content, for context."""
    previews = [(i, f) for i, f in enumerate(source.fields) if f.preview is not None]
    for index, _field in previews:
        text = row[f"t{index}"]
        if row[f"m{index}"] and text:
            return excerpt(text, words)
    for index, f in previews:
        text = row[f"t{index}"]
        if f.role != "metadata" and text:
            return excerpt(text)
    return ""


async def search_source(
    session: AsyncSession,
    source: EntitySource,
    scope: SearchScope,
    query: UniversalQuery,
    window: int,
    ranking: RankingStrategy,
    today: date,
) -> SourcePage:
    """The source's first `window` hits in ranking order and its total. Sources that can't
    satisfy the filters return nothing without querying."""
    if not source.supports(query.filters) or not query.words:
        return SourcePage(hits=[], total=0)
    conditions = _conditions(source, scope, query)

    if window == 0:
        matching = source.joins(select(source.id).select_from(source.table)).where(*conditions)
        total = await session.scalar(select(func.count()).select_from(matching.subquery()))
        return SourcePage(hits=[], total=total or 0)

    tiers = _tiers(source, query)
    kind = case(*((condition, literal(name)) for name, condition in tiers), else_=literal("spread"))
    weight = case(
        *((condition, ranking.weights[name]) for name, condition in tiers),
        else_=ranking.weights["spread"],
    )
    is_active = source.active
    score = weight - case((is_active, 0), else_=ranking.inactive_penalty)
    word_patterns = [contains_pattern(word) for word in query.words]

    columns: list[Any] = [
        label("id", source.id),
        label("title", source.title),
        label("updated_at", source.updated_at),
        label("status", source.status),
        label("active", is_active),
        label("kind", kind),
        label("m_title", or_(*(like(source.title)(p) for p in word_patterns))),
        label("total", func.count().over()),
    ]
    if source.day is not None:
        columns.append(label("day", source.day))
    for index, f in enumerate(source.fields):
        columns.append(label(f"m{index}", or_(*(f.match(p) for p in word_patterns))))
        columns.append(label(f"t{index}", f.preview if f.preview is not None else literal(None)))
    columns += [label(name, column) for name, column in source.columns.items()]

    order: list[Any] = (
        [score.desc(), source.updated_at.desc(), source.id]
        if query.sort == "relevance"
        else [source.updated_at.desc(), source.id]
    )
    statement = (
        source.joins(select(*columns).select_from(source.table))
        .where(*conditions)
        .order_by(*order)
        .limit(window)
    )
    rows = [row._mapping for row in await session.execute(statement)]  # pyright: ignore[reportPrivateUsage] -- `_mapping` is SQLAlchemy's public row-as-mapping API.
    context = DescribeContext(today, query.filters.date_from, query.filters.date_to)
    hits: list[UniversalHit] = []
    for row in rows:
        kind_name: MatchKind = row["kind"]
        active = bool(row["active"])
        described = source.describe(row, context)
        matched = ["title"] if row["m_title"] else []
        matched += [f.name for index, f in enumerate(source.fields) if row[f"m{index}"]]
        hits.append(
            UniversalHit(
                module=source.module,
                entity_type=source.entity_type,
                id=row["id"],
                title=row["title"] or "",
                snippet=_snippet(source, row, query.words),
                matched_fields=tuple(dict.fromkeys(matched)),
                match=kind_name,
                score=ranking.score(kind_name, active=active),
                active=active,
                status=row["status"] or "",
                details=described.details,
                day=described.day if described.day is not None else row.get("day"),
                starts_at=described.starts_at,
                all_day=described.all_day,
                parent_id=described.parent_id,
                updated_at=_utc(row["updated_at"]),
            )
        )
    return SourcePage(hits=hits, total=rows[0]["total"] if rows else 0)


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
