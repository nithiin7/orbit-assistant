"""Search across modules, composed from each module's own search.

There is no search index. Each module answers with its existing case-insensitive substring
search (titles, descriptions, note text and tags, event places, transaction descriptions and
notes), and this service groups the first few hits by module. Document contents are never
searched, and hits leave out amounts and document metadata, so search reveals no more than a
record's title and the line that identifies it.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol

from orbit_api.services.calendar.models import EventPage, EventQuery
from orbit_api.services.documents.models import Document, DocumentQuery
from orbit_api.services.finance.models import TransactionPage, TransactionQuery
from orbit_api.services.habits.models import Habit
from orbit_api.services.notes.models import NotePage, NoteQuery
from orbit_api.services.search.models import (
    SEARCH_MODULES,
    SearchGroup,
    SearchHit,
    SearchModule,
    SearchResults,
)
from orbit_api.services.tasks.models import TaskPage, TaskQuery
from orbit_api.services.transactions import Transaction

logger = logging.getLogger(__name__)


class TaskSearch(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage: ...


class NoteSearch(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: NoteQuery) -> NotePage: ...


class EventSearch(Protocol):
    async def find_events(self, workspace_id: uuid.UUID, query: EventQuery) -> EventPage: ...


class DocumentSearch(Protocol):
    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]: ...


class HabitSearch(Protocol):
    async def search(self, workspace_id: uuid.UUID, text: str) -> list[Habit]: ...


class TransactionSearch(Protocol):
    async def find(self, workspace_id: uuid.UUID, query: TransactionQuery) -> TransactionPage: ...


class SearchService:
    def __init__(
        self,
        *,
        tasks: TaskSearch,
        notes: NoteSearch,
        events: EventSearch,
        documents: DocumentSearch,
        habits: HabitSearch,
        transactions: TransactionSearch,
        transaction: Transaction,
    ) -> None:
        self._tasks = tasks
        self._notes = notes
        self._events = events
        self._documents = documents
        self._habits = habits
        self._transactions = transactions
        self._transaction = transaction

    async def search(
        self,
        workspace_id: uuid.UUID,
        text: str,
        limit: int,
        modules: Sequence[SearchModule] | None = None,
    ) -> SearchResults:
        """Up to `limit` hits per module for `text`, in `SEARCH_MODULES` order. A module that
        fails is reported as unavailable; the others still answer."""
        wanted: list[SearchModule] = [
            module for module in SEARCH_MODULES if modules is None or module in modules
        ]
        searches: dict[SearchModule, Callable[[], Awaitable[tuple[list[SearchHit], int]]]] = {
            "tasks": lambda: self._search_tasks(workspace_id, text, limit),
            "notes": lambda: self._search_notes(workspace_id, text, limit),
            "events": lambda: self._search_events(workspace_id, text, limit),
            "documents": lambda: self._search_documents(workspace_id, text, limit),
            "habits": lambda: self._search_habits(workspace_id, text, limit),
            "transactions": lambda: self._search_transactions(workspace_id, text, limit),
        }
        groups: list[SearchGroup] = []
        # One at a time: the modules share the request's database session.
        for module in wanted:
            try:
                hits, total = await searches[module]()
            # A deliberate boundary: one module failing must not hide the others' results. The
            # error is logged, and the session rolled back so the next module can query.
            except Exception:
                logger.exception("Search in %r failed.", module)
                await self._transaction.rollback()
                groups.append(SearchGroup(module=module, hits=[], total=0, unavailable=True))
                continue
            groups.append(SearchGroup(module=module, hits=hits, total=total))
        return SearchResults(query=text, groups=groups)

    async def _search_tasks(
        self, workspace_id: uuid.UUID, text: str, limit: int
    ) -> tuple[list[SearchHit], int]:
        page = await self._tasks.find(
            workspace_id, TaskQuery(search=text, sort="due_date", limit=limit)
        )
        hits = [
            SearchHit(
                id=task.id, title=task.title, detail="", status=task.status, day=task.due_date
            )
            for task in page.tasks
        ]
        return hits, page.total

    async def _search_notes(
        self, workspace_id: uuid.UUID, text: str, limit: int
    ) -> tuple[list[SearchHit], int]:
        page = await self._notes.find(workspace_id, NoteQuery(search=text, limit=limit))
        hits = [
            SearchHit(
                id=item.note.id,
                title=item.note.title,
                detail=item.excerpt,
                status=item.note.note_type,
                day=item.note.journal_date,
            )
            for item in page.items
        ]
        return hits, page.total

    async def _search_events(
        self, workspace_id: uuid.UUID, text: str, limit: int
    ) -> tuple[list[SearchHit], int]:
        page = await self._events.find_events(workspace_id, EventQuery(search=text, limit=limit))
        hits = [
            SearchHit(
                id=event.id,
                title=event.title,
                detail=event.location,
                status=event.status,
                day=event.start.date(),
                starts_at=None if event.all_day else event.start,
                all_day=event.all_day,
            )
            for event in page.events
        ]
        return hits, page.total

    async def _search_documents(
        self, workspace_id: uuid.UUID, text: str, limit: int
    ) -> tuple[list[SearchHit], int]:
        documents, total = await self._documents.find(
            workspace_id,
            DocumentQuery(
                states=("active", "archived"), search=text, sort="title", order="asc", limit=limit
            ),
        )
        hits = [
            SearchHit(id=document.id, title=document.title, detail="", status=document.state)
            for document in documents
        ]
        return hits, total

    async def _search_habits(
        self, workspace_id: uuid.UUID, text: str, limit: int
    ) -> tuple[list[SearchHit], int]:
        habits = await self._habits.search(workspace_id, text)
        hits = [
            SearchHit(id=habit.id, title=habit.name, detail="", status=habit.status)
            for habit in habits[:limit]
        ]
        return hits, len(habits)

    async def _search_transactions(
        self, workspace_id: uuid.UUID, text: str, limit: int
    ) -> tuple[list[SearchHit], int]:
        page = await self._transactions.find(
            workspace_id, TransactionQuery(search=text, limit=limit)
        )
        hits = [
            SearchHit(
                id=item.id,
                title=item.description or item.type.capitalize(),
                detail="",
                status=item.type,
                day=item.occurred_on,
            )
            for item in page.transactions
        ]
        return hits, page.total
