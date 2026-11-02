"""Search across modules: grouping, privacy, isolation, and failures."""

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.calendar.models import EventPage, EventQuery
from orbit_api.services.documents.models import Document, DocumentQuery
from orbit_api.services.finance.models import TransactionPage, TransactionQuery
from orbit_api.services.habits.models import Habit
from orbit_api.services.notes.models import NotePage, NoteQuery
from orbit_api.services.search.models import SEARCH_MODULES
from orbit_api.services.search.service import SearchService
from orbit_api.services.tasks.models import TaskPage, TaskQuery
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def personal(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    return personal(client, ada)


def post(client: TestClient, url: str, headers: Headers, body: Json) -> Json:
    response = client.post(url, json=body, headers=headers)
    assert response.status_code == 201, response.text
    result: Json = response.json()
    return result


def search(client: TestClient, ws: str, headers: Headers, q: str, **params: Any) -> Json:
    response = client.get(f"{ws}/search", params={"q": q, **params}, headers=headers)
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def groups(body: Json) -> dict[str, list[str]]:
    return {group["module"]: [hit["title"] for hit in group["hits"]] for group in body["groups"]}


def seed(client: TestClient, ws: str, headers: Headers) -> None:
    """One "garden" record in every module, and one unrelated record."""
    post(client, f"{ws}/tasks", headers, {"title": "Water the garden", "due_date": "2030-05-01"})
    post(client, f"{ws}/tasks", headers, {"title": "File taxes"})
    post(client, f"{ws}/notes", headers, {"title": "Garden plans", "note_type": "note"})
    post(
        client,
        f"{ws}/calendar/events",
        headers,
        {
            "title": "Garden club",
            "location": "Community hall",
            "start": "2030-05-02T18:00",
            "end": "2030-05-02T19:00",
            "timezone": "UTC",
        },
    )
    post(client, f"{ws}/documents", headers, {"title": "Garden shed warranty"})
    post(
        client,
        f"{ws}/habits",
        headers,
        {
            "name": "Garden for 10 minutes",
            "schedule": {"type": "daily"},
            "start_date": "2030-01-01",
            "timezone": "UTC",
        },
    )
    account = post(client, f"{ws}/finance/accounts", headers, {"name": "Wallet", "type": "cash"})
    post(
        client,
        f"{ws}/finance/transactions",
        headers,
        {
            "type": "expense",
            "amount": 123456,
            "occurred_on": "2030-04-01",
            "description": "Garden centre",
            "account_id": account["id"],
        },
    )


class TestSearchApi:
    def test_finds_records_in_every_module_grouped_in_order(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        seed(client, ws, ada)

        body = search(client, ws, ada, "garden")

        assert body["query"] == "garden"
        assert [group["module"] for group in body["groups"]] == list(SEARCH_MODULES)
        assert groups(body) == {
            "tasks": ["Water the garden"],
            "notes": ["Garden plans"],
            "events": ["Garden club"],
            "documents": ["Garden shed warranty"],
            "habits": ["Garden for 10 minutes"],
            "transactions": ["Garden centre"],
        }
        assert all(group["total"] == 1 for group in body["groups"])
        assert not any(group["unavailable"] for group in body["groups"])

    def test_hits_identify_records_without_amounts_or_metadata(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        seed(client, ws, ada)

        body = search(client, ws, ada, "garden")

        by_module = {group["module"]: group["hits"][0] for group in body["groups"]}
        assert by_module["tasks"]["day"] == "2030-05-01"
        assert by_module["tasks"]["status"] == "open"
        assert by_module["events"]["detail"] == "Community hall"
        assert by_module["events"]["starts_at"] == "2030-05-02T18:00:00"
        assert by_module["transactions"]["status"] == "expense"
        assert by_module["transactions"]["day"] == "2030-04-01"
        assert "123456" not in str(body)
        assert set(by_module["documents"]) == {
            "id",
            "title",
            "detail",
            "status",
            "day",
            "starts_at",
            "all_day",
        }

    def test_no_matches_gives_empty_groups(self, client: TestClient, ws: str, ada: Headers) -> None:
        seed(client, ws, ada)

        body = search(client, ws, ada, "zebra")

        assert all(group["hits"] == [] and group["total"] == 0 for group in body["groups"])
        assert len(body["groups"]) == len(SEARCH_MODULES)

    def test_limits_hits_but_counts_every_match(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        for number in range(4):
            post(client, f"{ws}/tasks", ada, {"title": f"Call plumber {number}"})

        body = search(client, ws, ada, "plumber", limit=2, module="tasks")

        assert [group["module"] for group in body["groups"]] == ["tasks"]
        assert len(body["groups"][0]["hits"]) == 2
        assert body["groups"][0]["total"] == 4

    @pytest.mark.parametrize(
        "params",
        [{"q": "a"}, {"q": ""}, {}, {"q": "garden", "limit": 50}, {"q": "garden", "module": "x"}],
    )
    def test_rejects_invalid_queries(
        self, client: TestClient, ws: str, ada: Headers, params: Json
    ) -> None:
        assert client.get(f"{ws}/search", params=params, headers=ada).status_code == 422

    def test_never_searches_another_users_workspace(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        seed(client, ws, ada)
        grace_ws = personal(client, grace)

        assert client.get(f"{ws}/search", params={"q": "garden"}, headers=grace).status_code == 404
        assert client.get(f"{ws}/search", params={"q": "garden"}).status_code == 401
        body = search(client, grace_ws, grace, "garden")
        assert all(group["hits"] == [] for group in body["groups"])


# The service, with fake modules


WS = uuid.uuid4()


class Empty:
    """Every module's search, finding nothing."""

    async def find(self, workspace_id: uuid.UUID, query: Any) -> Any:
        if isinstance(query, TaskQuery):
            return TaskPage(tasks=[], total=0)
        if isinstance(query, NoteQuery):
            return NotePage(items=[], total=0)
        if isinstance(query, DocumentQuery):
            return [], 0
        assert isinstance(query, TransactionQuery)
        return TransactionPage(transactions=[], total=0)

    async def find_events(self, workspace_id: uuid.UUID, query: EventQuery) -> EventPage:
        return EventPage(events=[], total=0)


class BrokenDocuments:
    async def find(
        self, workspace_id: uuid.UUID, query: DocumentQuery
    ) -> tuple[list[Document], int]:
        raise RuntimeError("the documents table is locked")


class NoHabits:
    async def search(self, workspace_id: uuid.UUID, text: str) -> list[Habit]:
        return []


class FakeTransaction:
    def __init__(self) -> None:
        self.rollbacks = 0

    async def commit(self) -> None:
        raise AssertionError("search never writes")

    async def rollback(self) -> None:
        self.rollbacks += 1


@pytest.mark.anyio
async def test_a_failing_module_is_unavailable_and_the_rest_answer() -> None:
    transaction = FakeTransaction()
    empty = Empty()
    service = SearchService(
        tasks=empty,
        notes=empty,
        events=empty,
        documents=BrokenDocuments(),
        habits=NoHabits(),
        transactions=empty,
        transaction=transaction,
    )

    results = await service.search(WS, "garden", 5)

    unavailable = [group.module for group in results.groups if group.unavailable]
    assert unavailable == ["documents"]
    assert [group.module for group in results.groups] == list(SEARCH_MODULES)
    assert transaction.rollbacks == 1
