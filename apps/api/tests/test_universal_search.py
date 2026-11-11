"""Universal search: every module, ranking, filters, paging, privacy, isolation, freshness,
partial failures, and recent and saved searches."""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.repositories.search.providers import build_universal_search
from orbit_api.services.search.ranking import DEFAULT_RANKING, RankingStrategy
from orbit_api.services.search.universal import UniversalSearchService
from orbit_api.services.search.universal_models import (
    UNIVERSAL_MODULES,
    SearchScope,
    SourcePage,
    UniversalHit,
    UniversalModule,
    UniversalQuery,
)
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
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


def post(client: TestClient, url: str, headers: Headers, body: Json, code: int = 201) -> Json:
    response = client.post(url, json=body, headers=headers)
    assert response.status_code == code, response.text
    result: Json = response.json()
    return result


def search(client: TestClient, ws: str, headers: Headers, q: str, **params: Any) -> Json:
    response = client.get(f"{ws}/search/results", params={"q": q, **params}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    body: Json = response.json()
    return body


def found(body: Json) -> list[tuple[str, str]]:
    return [(hit["entity_type"], hit["title"]) for hit in body["hits"]]


def titles(body: Json) -> list[str]:
    return [hit["title"] for hit in body["hits"]]


def facets(body: Json) -> dict[str, int]:
    return {facet["module"]: facet["total"] for facet in body["facets"]}


def seed_everything(client: TestClient, ws: str, headers: Headers) -> None:
    """One "orchard" record of every searchable type."""
    fin = f"{ws}/finance"
    fit = f"{ws}/fitness"
    task = post(client, f"{ws}/tasks", headers, {"title": "Prune the orchard"})
    post(client, f"{ws}/notes", headers, {"title": "Orchard ideas", "text": "Apples and pears"})
    post(
        client,
        f"{ws}/calendar/events",
        headers,
        {
            "title": "Orchard walk",
            "start": "2030-05-02T18:00",
            "end": "2030-05-02T19:00",
            "timezone": "UTC",
        },
    )
    post(
        client,
        f"{ws}/reminders",
        headers,
        {
            "title": "Orchard spraying",
            "start_date": "2030-05-01",
            "time_of_day": "09:00",
            "timezone": "UTC",
            "task_id": task["id"],
        },
    )
    account = post(client, f"{fin}/accounts", headers, {"name": "Orchard fund", "type": "bank"})
    post(
        client,
        f"{fin}/transactions",
        headers,
        {
            "type": "expense",
            "amount": 987654,
            "occurred_on": "2030-04-01",
            "description": "Orchard supplies",
            "account_id": account["id"],
            "notes": "secret orchard memo",
        },
    )
    post(
        client,
        f"{fin}/loans",
        headers,
        {
            "name": "Orchard loan",
            "lender": "Farm bank",
            "loan_type": "other",
            "principal": 600000,
            "interest_rate_bps": 1200,
            "start_date": "2026-01-01",
            "tenure_months": 12,
            "first_payment_date": "2026-02-05",
        },
    )
    for kind in ("subscription", "bill"):
        post(
            client,
            f"{fin}/recurring-payments",
            headers,
            {
                "kind": kind,
                "name": f"Orchard {kind}",
                "provider": "Growers",
                "amount": 64900,
                "frequency": "monthly",
                "next_due_date": "2030-03-15",
            },
        )
    post(client, f"{fin}/assets", headers, {"name": "Orchard tractor", "category": "vehicle"})
    post(
        client,
        f"{fin}/budgets",
        headers,
        {
            "name": "Orchard budget",
            "scope": "overall",
            "amount": 5000000,
            "start_date": "2030-01-01",
        },
    )
    post(
        client,
        f"{fin}/savings-goals",
        headers,
        {
            "name": "Orchard expansion",
            "category": "other",
            "target_amount": 300000,
            "start_date": "2030-01-01",
        },
    )
    post(
        client,
        f"{ws}/habits",
        headers,
        {
            "name": "Orchard rounds",
            "schedule": {"type": "daily"},
            "start_date": "2030-01-01",
            "timezone": "UTC",
        },
    )
    post(client, f"{ws}/routines", headers, {"name": "Orchard morning"})
    post(client, f"{ws}/documents", headers, {"title": "Orchard deed", "tags": ["Land"]})
    exercise = post(
        client,
        f"{fit}/exercises",
        headers,
        {"name": "Orchard lift", "category": "strength", "exercise_type": "reps"},
    )
    post(
        client,
        f"{fit}/sessions/log",
        headers,
        {
            "name": "Orchard workout",
            "day": "2026-01-01",
            "started_at": "2026-01-01T08:00:00Z",
            "ended_at": "2026-01-01T09:00:00Z",
            "exercises": [
                {"exercise_id": exercise["id"], "sets": [{"reps": 5, "completed": True}]}
            ],
        },
    )
    post(
        client,
        f"{fit}/goals?date=2030-01-01",
        headers,
        {
            "name": "Orchard run",
            "category": "custom",
            "unit": "laps",
            "start_value": 0,
            "target_value": 10,
            "start_date": "2030-01-01",
        },
    )
    post(
        client,
        f"{fit}/measurements",
        headers,
        {"day": "2030-01-01", "weight_g": 81234, "note": "after orchard season"},
    )
    post(
        client,
        f"{ws}/watchlist/items",
        headers,
        {"kind": "movie", "title": "Orchard Nights", "platform": "Netflix", "notes": ""},
    )
    post(
        client,
        f"{ws}/bookmarks/items",
        headers,
        {"url": "https://example.com/orchard-guide", "title": "Orchard guide"},
    )
    post(
        client,
        f"{ws}/places/items",
        headers,
        {"name": "Orchard Road", "country_code": "SG", "status": "visited"},
    )


class TestModules:
    def test_finds_every_searchable_type(self, client: TestClient, ws: str, ada: Headers) -> None:
        seed_everything(client, ws, ada)

        body = search(client, ws, ada, "orchard", limit=50)

        types = {hit["entity_type"] for hit in body["hits"]}
        assert types == {
            "task",
            "note",
            "event",
            "reminder",
            "account",
            "transaction",
            "loan",
            "subscription",
            "bill",
            "asset",
            "budget",
            "savings_goal",
            "habit",
            "routine",
            "document",
            "exercise",
            "workout",
            "fitness_goal",
            "measurement",
            "watch_item",
            "bookmark",
            "place",
        }
        assert body["total"] == len(body["hits"])
        assert [f["module"] for f in body["facets"]] == list(UNIVERSAL_MODULES)
        assert body["unavailable"] == []
        assert facets(body)["finance"] == 9
        assert facets(body)["health"] == 4
        assert facets(body)["watchlist"] == 1
        assert facets(body)["bookmarks"] == 1
        assert facets(body)["places"] == 1

    def test_hits_never_carry_amounts_or_private_notes(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        seed_everything(client, ws, ada)

        raw = client.get(
            f"{ws}/search/results", params={"q": "orchard", "limit": 50}, headers=ada
        ).text

        for secret in ("987654", "600000", "64900", "5000000", "81234", "secret orchard memo"):
            assert secret not in raw

    def test_a_finance_note_match_names_the_field_without_showing_it(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        seed_everything(client, ws, ada)

        body = search(client, ws, ada, "memo")

        [hit] = body["hits"]
        assert hit["entity_type"] == "transaction"
        assert hit["matched_fields"] == ["notes"]
        assert hit["match"] == "description"
        assert "memo" not in hit["snippet"]
        assert {d["key"]: d["value"] for d in hit["details"]}["account"] == "Orchard fund"

    def test_note_content_snippet_and_tags(self, client: TestClient, ws: str, ada: Headers) -> None:
        long_text = "Intro line. " * 40 + "The quince tree needs pruning in March."
        post(
            client,
            f"{ws}/notes",
            ada,
            {"title": "Trees", "text": long_text, "tags": ["Fruit"]},
        )

        content = search(client, ws, ada, "quince")["hits"][0]
        tagged = search(client, ws, ada, "fruit")["hits"][0]

        assert content["match"] == "content"
        assert "quince tree" in content["snippet"]
        assert content["snippet"].startswith("…")
        assert tagged["matched_fields"] == ["tags"] and tagged["match"] == "metadata"

    def test_reminders_match_their_task(self, client: TestClient, ws: str, ada: Headers) -> None:
        task = post(client, f"{ws}/tasks", ada, {"title": "Renew passport"})
        post(
            client,
            f"{ws}/reminders",
            ada,
            {
                "title": "Call office",
                "start_date": "2030-05-01",
                "time_of_day": "09:00",
                "timezone": "UTC",
                "task_id": task["id"],
            },
        )

        body = search(client, ws, ada, "passport", module="reminders")

        [hit] = body["hits"]
        assert hit["title"] == "Call office"
        assert hit["matched_fields"] == ["task"]
        assert {"key": "task", "value": "Renew passport"} in hit["details"]

    def test_routines_match_their_steps(self, client: TestClient, ws: str, ada: Headers) -> None:
        post(
            client,
            f"{ws}/routines",
            ada,
            {"name": "Evening", "steps": [{"name": "Floss"}, {"name": "Journal"}]},
        )

        [hit] = search(client, ws, ada, "floss")["hits"]

        assert hit["entity_type"] == "routine" and hit["match"] == "content"


class TestEvents:
    def test_recurring_event_opens_its_next_occurrence(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        post(
            client,
            f"{ws}/calendar/events",
            ada,
            {
                "title": "Yoga class",
                "start": "2020-01-06T07:00",
                "end": "2020-01-06T08:00",
                "timezone": "UTC",
                "recurrence": {"frequency": "weekly", "weekdays": ["mon"]},
            },
        )

        [hit] = search(client, ws, ada, "yoga")["hits"]
        in_range = search(client, ws, ada, "yoga", date_from="2031-03-01")["hits"][0]

        today = datetime.now(UTC).date()
        next_day = date.fromisoformat(hit["day"])
        assert today <= next_day and next_day.weekday() == 0
        assert {"key": "repeats", "value": "yes"} in hit["details"]
        assert in_range["day"] == "2031-03-03"
        assert in_range["starts_at"] == "2031-03-03T07:00:00"

    def test_finds_a_series_by_a_changed_occurrence(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        cal = f"{ws}/calendar"
        event = post(
            client,
            f"{cal}/events",
            ada,
            {
                "title": "Standup",
                "start": "2030-01-14T09:00",
                "end": "2030-01-14T09:30",
                "timezone": "UTC",
                "recurrence": {"frequency": "daily"},
            },
        )
        response = client.patch(
            f"{cal}/events/{event['id']}/occurrences/2030-01-15T09:00",
            json={"scope": "this", "title": "Quarterly planning"},
            headers=ada,
        )
        assert response.status_code == 200, response.text

        [hit] = search(client, ws, ada, "quarterly")["hits"]

        assert hit["id"] == event["id"] and hit["matched_fields"] == ["occurrence"]

    def test_date_filter_uses_the_series_range(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        post(
            client,
            f"{ws}/calendar/events",
            ada,
            {
                "title": "Concert",
                "start": "2030-06-01T20:00",
                "end": "2030-06-01T22:00",
                "timezone": "UTC",
            },
        )

        assert titles(search(client, ws, ada, "concert", date_from="2030-06-01")) == ["Concert"]
        assert titles(search(client, ws, ada, "concert", date_to="2030-05-31")) == []
        assert titles(search(client, ws, ada, "concert", date_from="2030-06-02")) == []


class TestRanking:
    def test_tiers_order_results(self, client: TestClient, ws: str, ada: Headers) -> None:
        tasks = f"{ws}/tasks"
        # Created best-last, so recency alone would give the opposite order.
        post(client, f"{ws}/notes", ada, {"title": "Misc", "text": "about the kiln fire"})
        post(client, tasks, ada, {"title": "Glaze", "description": "kiln fire tonight"})
        post(client, tasks, ada, {"title": "Fire up the old kiln"})
        post(client, tasks, ada, {"title": "Big kiln fire log"})
        post(client, tasks, ada, {"title": "Kiln fire checklist"})
        post(client, tasks, ada, {"title": "Kiln Fire"})

        body = search(client, ws, ada, "kiln fire")

        assert [(h["title"], h["match"]) for h in body["hits"]] == [
            ("Kiln Fire", "exact_title"),
            ("Kiln fire checklist", "title_prefix"),
            ("Big kiln fire log", "title_phrase"),
            ("Fire up the old kiln", "title_words"),
            ("Glaze", "description"),
            ("Misc", "content"),
        ]
        scores = [hit["score"] for hit in body["hits"]]
        assert scores == sorted(scores, reverse=True)

    def test_metadata_ranks_above_description(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        post(client, f"{ws}/documents", ada, {"title": "Old deed", "description": "about kayak"})
        post(client, f"{ws}/documents", ada, {"title": "Receipt", "tags": ["kayak"]})

        assert titles(search(client, ws, ada, "kayak")) == ["Receipt", "Old deed"]

    def test_recency_breaks_ties_and_inactive_records_rank_lower(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        old = post(client, f"{ws}/tasks", ada, {"title": "Lantern repair"})
        post(client, f"{ws}/tasks", ada, {"title": "Lantern oil"})
        done = post(client, f"{ws}/tasks", ada, {"title": "Lantern wick"})
        assert client.post(f"{ws}/tasks/{done['id']}/complete", headers=ada).status_code == 200

        body = search(client, ws, ada, "lantern")

        assert titles(body) == ["Lantern oil", "Lantern repair", "Lantern wick"]
        assert body["hits"][2]["active"] is False
        assert body["hits"][2]["score"] == body["hits"][0]["score"] - 50
        by_recent = search(client, ws, ada, "lantern", sort="recent")
        assert titles(by_recent)[0] == "Lantern wick"
        assert old["id"] in [hit["id"] for hit in by_recent["hits"]]

    def test_every_word_must_match_somewhere(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        post(client, f"{ws}/tasks", ada, {"title": "Paint fence", "description": "blue"})
        post(client, f"{ws}/tasks", ada, {"title": "Paint door"})

        body = search(client, ws, ada, "paint blue")

        assert [(h["title"], h["match"]) for h in body["hits"]] == [("Paint fence", "spread")]

    def test_wildcards_are_literal(self, client: TestClient, ws: str, ada: Headers) -> None:
        post(client, f"{ws}/tasks", ada, {"title": "100% done"})
        post(client, f"{ws}/tasks", ada, {"title": "1000 things"})

        assert titles(search(client, ws, ada, "0%")) == ["100% done"]

    def test_custom_strategy_needs_every_weight(self) -> None:
        with pytest.raises(ValueError, match="every match kind"):
            RankingStrategy(weights={"exact_title": 1})


class TestFilters:
    def test_module_filter_keeps_facets_for_all_modules(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        seed_everything(client, ws, ada)

        body = search(client, ws, ada, "orchard", module="finance", limit=50)

        assert {hit["module"] for hit in body["hits"]} == {"finance"}
        assert body["total"] == 9
        assert facets(body)["tasks"] == 1 and facets(body)["health"] == 4

    def test_type_filter(self, client: TestClient, ws: str, ada: Headers) -> None:
        seed_everything(client, ws, ada)

        body = search(client, ws, ada, "orchard", type=["subscription", "bill"])

        assert sorted(found(body)) == [
            ("bill", "Orchard bill"),
            ("subscription", "Orchard subscription"),
        ]

    def test_task_filters_limit_results_to_tasks(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        tasks = f"{ws}/tasks"
        post(client, tasks, ada, {"title": "Mow lawn", "priority": "high"})
        post(client, tasks, ada, {"title": "Mow verge", "priority": "low"})
        done = post(client, tasks, ada, {"title": "Mow path", "priority": "high"})
        assert client.post(f"{tasks}/{done['id']}/complete", headers=ada).status_code == 200
        post(client, f"{ws}/notes", ada, {"title": "Mow schedule"})

        open_high = search(client, ws, ada, "mow", task_status="open", task_priority="high")
        high = search(client, ws, ada, "mow", task_priority="high")

        assert titles(open_high) == ["Mow lawn"]
        assert sorted(titles(high)) == ["Mow lawn", "Mow path"]
        assert facets(high)["notes"] == 0

    def test_date_filter_skips_types_without_dates(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        post(client, f"{ws}/tasks", ada, {"title": "Tax return", "due_date": "2030-04-10"})
        post(client, f"{ws}/tasks", ada, {"title": "Tax receipts", "due_date": "2030-06-10"})
        post(client, f"{ws}/finance/accounts", ada, {"name": "Tax savings", "type": "bank"})

        body = search(client, ws, ada, "tax", date_from="2030-04-01", date_to="2030-04-30")

        assert titles(body) == ["Tax return"]
        assert body["hits"][0]["day"] == "2030-04-10"

    def test_transaction_type_document_category_and_habit_kind(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        fin = f"{ws}/finance"
        account = post(client, f"{fin}/accounts", ada, {"name": "Main", "type": "bank"})
        for kind in ("income", "expense"):
            post(
                client,
                f"{fin}/transactions",
                ada,
                {
                    "type": kind,
                    "amount": 100,
                    "occurred_on": "2030-01-01",
                    "description": f"Cello {kind}",
                    "account_id": account["id"],
                },
            )
        categories = client.get(f"{ws}/document-categories", headers=ada).json()["categories"]
        category = categories[0]
        post(
            client, f"{ws}/documents", ada, {"title": "Cello papers", "category_id": category["id"]}
        )
        post(client, f"{ws}/documents", ada, {"title": "Cello manual"})
        for kind in ("boolean", "duration"):
            post(
                client,
                f"{ws}/habits",
                ada,
                {
                    "name": f"Cello {kind}",
                    "kind": kind,
                    "schedule": {"type": "daily"},
                    "start_date": "2030-01-01",
                    "timezone": "UTC",
                    **({"target": 1800} if kind == "duration" else {}),
                },
            )

        assert titles(search(client, ws, ada, "cello", transaction_type="income")) == [
            "Cello income"
        ]
        assert titles(search(client, ws, ada, "cello", document_category=category["id"])) == [
            "Cello papers"
        ]
        assert titles(search(client, ws, ada, "cello", habit_kind="duration")) == ["Cello duration"]

    def test_archived_and_trashed_records(self, client: TestClient, ws: str, ada: Headers) -> None:
        archived = post(client, f"{ws}/notes", ada, {"title": "Harp archive"})
        trashed = post(client, f"{ws}/notes", ada, {"title": "Harp trash"})
        post(client, f"{ws}/notes", ada, {"title": "Harp live"})
        archive = client.patch(f"{ws}/notes/{archived['id']}", json={"archived": True}, headers=ada)
        assert archive.status_code == 200, archive.text
        assert client.post(f"{ws}/notes/{trashed['id']}/trash", headers=ada).status_code == 200

        assert titles(search(client, ws, ada, "harp")) == ["Harp live"]
        with_archived = search(client, ws, ada, "harp", include_archived="true")
        assert sorted(titles(with_archived)) == ["Harp archive", "Harp live"]
        assert {h["title"]: h["active"] for h in with_archived["hits"]}["Harp archive"] is False

    def test_updated_filter(self, client: TestClient, ws: str, ada: Headers) -> None:
        post(client, f"{ws}/tasks", ada, {"title": "Oboe reed"})
        today = datetime.now(UTC).date().isoformat()

        assert titles(search(client, ws, ada, "oboe", updated_from=today)) == ["Oboe reed"]
        assert titles(search(client, ws, ada, "oboe", updated_to="2000-01-01")) == []
        assert titles(search(client, ws, ada, "oboe", created_from=today)) == ["Oboe reed"]

    @pytest.mark.parametrize(
        "params",
        [
            {"q": "a"},
            {"q": "x" * 201},
            {"q": "ok", "module": "music"},
            {"q": "ok", "type": "planet"},
            {"q": "ok", "limit": 0},
            {"q": "ok", "limit": 51},
            {"q": "ok", "offset": 501},
            {"q": "ok", "date_from": "2030-02-01", "date_to": "2030-01-01"},
            {"q": "ok", "task_status": "doing"},
            {"q": "ok", "sort": "random"},
            {"q": "ok", "surprise": "1"},
        ],
    )
    def test_rejects_invalid_parameters(
        self, client: TestClient, ws: str, ada: Headers, params: Json
    ) -> None:
        response = client.get(f"{ws}/search/results", params=params, headers=ada)
        assert response.status_code == 422, response.text


class TestPaging:
    def test_pages_are_exact_across_modules(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        for index in range(30):
            post(client, f"{ws}/tasks", ada, {"title": f"Piano task {index:02}"})
            post(client, f"{ws}/notes", ada, {"title": f"Piano note {index:02}"})

        everything = search(client, ws, ada, "piano", limit=50, offset=0)
        rest = search(client, ws, ada, "piano", limit=50, offset=50)
        pages = [
            search(client, ws, ada, "piano", limit=7, offset=n)["hits"] for n in range(0, 60, 7)
        ]

        assert everything["total"] == 60 and everything["has_more"] is True
        assert len(rest["hits"]) == 10 and rest["has_more"] is False
        ids = [hit["id"] for page in pages for hit in page]
        assert ids == [hit["id"] for hit in everything["hits"] + rest["hits"]]
        assert len(set(ids)) == 60

    def test_large_workspaces_answer_with_bounded_pages(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        for index in range(250):
            post(client, f"{ws}/tasks", ada, {"title": f"Violin practice {index}"})

        body = search(client, ws, ada, "violin", limit=20)

        assert body["total"] == 250 and len(body["hits"]) == 20 and body["has_more"]


class TestFreshness:
    """There is no index: edits, deletes, restores, and new records show at once."""

    def test_changes_are_searchable_immediately(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        task = post(client, f"{ws}/tasks", ada, {"title": "Tune guitar"})
        note = post(client, f"{ws}/notes", ada, {"title": "Guitar chords"})
        assert sorted(titles(search(client, ws, ada, "guitar"))) == ["Guitar chords", "Tune guitar"]

        client.patch(f"{ws}/tasks/{task['id']}", json={"title": "Tune ukulele"}, headers=ada)
        assert titles(search(client, ws, ada, "guitar")) == ["Guitar chords"]
        assert titles(search(client, ws, ada, "ukulele")) == ["Tune ukulele"]

        client.post(f"{ws}/notes/{note['id']}/trash", headers=ada)
        assert titles(search(client, ws, ada, "guitar")) == []
        client.post(f"{ws}/notes/{note['id']}/restore", headers=ada)
        assert titles(search(client, ws, ada, "guitar")) == ["Guitar chords"]

        assert client.delete(f"{ws}/tasks/{task['id']}", headers=ada).status_code == 204
        assert titles(search(client, ws, ada, "ukulele")) == []


class TestPrivacy:
    def test_another_users_workspace_is_not_found(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        seed_everything(client, ws, ada)

        response = client.get(f"{ws}/search/results", params={"q": "orchard"}, headers=grace)
        theirs = search(client, personal(client, grace), grace, "orchard")

        assert response.status_code == 404
        assert theirs["hits"] == [] and theirs["total"] == 0
        assert all(total == 0 for total in facets(theirs).values())

    def test_requires_sign_in(self, client: TestClient, ws: str) -> None:
        response = client.get(f"{ws}/search/results", params={"q": "orchard"})
        assert response.status_code == 401

    def test_health_records_are_only_searched_for_their_owner(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        """Workspaces aren't shared yet, so this checks the owner filter directly: the same
        workspace searched as someone else finds no health records, nor counts them."""
        seed_everything(client, ws, ada)
        workspace_id = uuid.UUID(ws.rsplit("/", 1)[1])
        app: Any = client.app

        async def as_someone_else() -> tuple[int, int]:
            async with app.state.database.session() as session:
                service = build_universal_search(session)
                stranger = SearchScope(workspace_id=workspace_id, user_id=uuid.uuid4())
                results = await service.search(stranger, UniversalQuery(text="orchard", limit=50))
                health = {f.module: f.total for f in results.facets}["health"]
                return health, sum(1 for hit in results.hits if hit.module == "health")

        assert client.portal is not None
        assert client.portal.call(as_someone_else) == (0, 0)


class _Provider:
    def __init__(self, module: UniversalModule, fail: bool = False) -> None:
        self._module: UniversalModule = module
        self._fail = fail

    @property
    def module(self) -> UniversalModule:
        return self._module

    async def search(
        self, scope: SearchScope, query: UniversalQuery, window: int, ranking: RankingStrategy
    ) -> SourcePage:
        if self._fail:
            raise RuntimeError("boom")
        hit = UniversalHit(
            module=self._module,
            entity_type="task",
            id=uuid.uuid4(),
            title=self._module,
            snippet="",
            matched_fields=("title",),
            match="exact_title",
            score=ranking.score("exact_title", active=True),
            active=True,
            status="open",
            details=(),
            day=None,
            starts_at=None,
            all_day=False,
            parent_id=None,
            updated_at=datetime(2030, 1, 1, tzinfo=UTC),
        )
        return SourcePage(hits=[hit][:window], total=1)


class _Transaction:
    def __init__(self) -> None:
        self.rollbacks = 0

    async def commit(self) -> None:
        pass

    async def rollback(self) -> None:
        self.rollbacks += 1


@pytest.mark.anyio
async def test_a_failing_module_is_unavailable_and_the_rest_answer(
    caplog: pytest.LogCaptureFixture,
) -> None:
    transaction = _Transaction()
    service = UniversalSearchService(
        [_Provider("tasks"), _Provider("finance", fail=True), _Provider("notes")],
        transaction,
        DEFAULT_RANKING,
    )

    results = await service.search(
        SearchScope(uuid.uuid4(), uuid.uuid4()), UniversalQuery(text="private words")
    )

    assert sorted(hit.module for hit in results.hits) == ["notes", "tasks"]
    assert results.unavailable == ["finance"]
    assert results.total == 2
    assert transaction.rollbacks == 1
    # The query is personal and never logged.
    assert "private words" not in caplog.text


class TestRecentSearches:
    def test_record_dedupe_cap_forget_and_clear(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        url = f"{ws}/search/recent"
        first = post(client, url, ada, {"query": "  Garden   tools "})
        again = post(client, url, ada, {"query": "garden tools"})
        assert again["id"] == first["id"] and again["query"] == "garden tools"

        for index in range(12):
            post(client, url, ada, {"query": f"query {index}"})
        listed = client.get(url, headers=ada)
        assert listed.headers["cache-control"] == "private, no-store"
        queries = [s["query"] for s in listed.json()["searches"]]
        assert queries == [f"query {index}" for index in range(11, 1, -1)]

        newest = listed.json()["searches"][0]
        assert client.delete(f"{url}/{newest['id']}", headers=ada).status_code == 204
        assert client.delete(f"{url}/{newest['id']}", headers=ada).status_code == 204
        assert len(client.get(url, headers=ada).json()["searches"]) == 9

        assert client.delete(url, headers=ada).status_code == 204
        assert client.get(url, headers=ada).json()["searches"] == []

    def test_history_is_private(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        url = f"{ws}/search/recent"
        mine = post(client, url, ada, {"query": "medical"})
        theirs = f"{personal(client, grace)}/search/recent"

        assert client.get(url, headers=grace).status_code == 404
        assert client.get(theirs, headers=grace).json()["searches"] == []
        # Grace can't remove Ada's search through her own workspace either.
        client.delete(f"{theirs}/{mine['id']}", headers=grace)
        assert [s["query"] for s in client.get(url, headers=ada).json()["searches"]] == ["medical"]

    def test_rejects_short_queries(self, client: TestClient, ws: str, ada: Headers) -> None:
        post(client, f"{ws}/search/recent", ada, {"query": "a"}, code=422)


FILTERS = {
    "module": ["tasks"],
    "type": [],
    "date_from": None,
    "date_to": None,
    "updated_from": None,
    "updated_to": None,
    "created_from": None,
    "created_to": None,
    "task_status": "open",
    "task_priority": ["high"],
    "document_category": None,
    "transaction_type": [],
    "habit_kind": [],
    "include_archived": False,
    "sort": "relevance",
}


class TestSavedSearches:
    def test_create_list_rename_and_delete(self, client: TestClient, ws: str, ada: Headers) -> None:
        url = f"{ws}/search/saved"
        saved = post(client, url, ada, {"name": "Urgent", "query": "launch", "filters": FILTERS})
        assert saved["filters"] == FILTERS

        renamed = client.patch(f"{url}/{saved['id']}", json={"name": "Hot"}, headers=ada)
        assert renamed.status_code == 200 and renamed.json()["name"] == "Hot"
        assert renamed.json()["query"] == "launch"

        listed = client.get(url, headers=ada)
        assert listed.headers["cache-control"] == "private, no-store"
        assert [s["name"] for s in listed.json()["searches"]] == ["Hot"]

        assert client.delete(f"{url}/{saved['id']}", headers=ada).status_code == 204
        assert client.delete(f"{url}/{saved['id']}", headers=ada).status_code == 404
        assert client.get(url, headers=ada).json()["searches"] == []

    def test_names_are_unique_case_insensitively(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        url = f"{ws}/search/saved"
        post(client, url, ada, {"name": "Bills", "query": "bill", "filters": FILTERS})
        other = post(client, url, ada, {"name": "Other", "query": "x y", "filters": FILTERS})

        post(client, url, ada, {"name": "bills", "query": "x y", "filters": FILTERS}, code=409)
        response = client.patch(f"{url}/{other['id']}", json={"name": "BILLS"}, headers=ada)
        assert response.status_code == 409

    def test_rejects_invalid_filters(self, client: TestClient, ws: str, ada: Headers) -> None:
        url = f"{ws}/search/saved"
        for filters in (
            {**FILTERS, "module": ["music"]},
            {**FILTERS, "date_from": "2030-02-01", "date_to": "2030-01-01"},
            {**FILTERS, "extra": True},
        ):
            post(client, url, ada, {"name": "X", "query": "xy", "filters": filters}, code=422)

    def test_saved_searches_are_private(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        saved = post(
            client, f"{ws}/search/saved", ada, {"name": "Mine", "query": "xy", "filters": FILTERS}
        )
        theirs = f"{personal(client, grace)}/search/saved"

        assert client.get(f"{ws}/search/saved", headers=grace).status_code == 404
        assert client.get(theirs, headers=grace).json()["searches"] == []
        assert client.delete(f"{theirs}/{saved['id']}", headers=grace).status_code == 404
        patched = client.patch(f"{theirs}/{saved['id']}", json={"name": "Z"}, headers=grace)
        assert patched.status_code == 404
