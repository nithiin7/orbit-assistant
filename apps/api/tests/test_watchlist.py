import json
import re
from collections.abc import Callable, Iterator
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.providers.media.tmdb import TmdbCatalog, TmdbClient
from orbit_api.services.watchlist.models import (
    CatalogAuthError,
    CatalogError,
    CatalogNotFoundError,
    Poster,
    Progress,
    TitleDetails,
    TitleMatch,
    WatchKind,
)
from orbit_api.services.watchlist.progress import fits, is_finale, last_episode, next_episode
from orbit_api.services.watchlist.service import PosterSize
from tests.ai_fakes import FakeProviderFactory, FakeState
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
JPEG = b"\xff\xd8\xff\xe0" + b"poster" * 10

Headers = dict[str, str]


GOOD_KEY = "k" * 32


class FakeCatalog:
    def __init__(self) -> None:
        self.searches: list[str] = []
        self.keys: list[str] = []
        self.fail = False
        # Titles by TMDB ID for `details` (default "Dune"/"Saga"), and recommendations by ID.
        self.titles: dict[int, str] = {}
        self.recommended: dict[int, list[TitleMatch]] = {}
        self.recommendation_calls: list[tuple[WatchKind, int]] = []
        self.search_filters: list[tuple[WatchKind | None, str | None]] = []

    async def verify(self) -> None:
        if self.keys[-1] != GOOD_KEY:
            raise CatalogAuthError

    async def search(
        self, query: str, *, kind: WatchKind | None = None, language: str | None = None
    ) -> list[TitleMatch]:
        self.searches.append(query)
        self.search_filters.append((kind, language))
        if self.fail:
            raise CatalogError
        return [
            TitleMatch(
                source_id=438631,
                kind="movie",
                title="Dune",
                release_year=2021,
                overview="Spice.",
                poster_path="/dune.jpg",
            ),
            TitleMatch(
                source_id=1399,
                kind="series",
                title="Saga",
                release_year=2011,
                overview="",
                poster_path=None,
            ),
        ]

    async def details(self, kind: WatchKind, source_id: int) -> TitleDetails:
        if self.fail:
            raise CatalogError
        if source_id == 404:
            raise CatalogNotFoundError
        if kind == "movie":
            return TitleDetails(
                source_id=source_id,
                kind="movie",
                title=self.titles.get(source_id, "Dune"),
                release_year=2021,
                overview="Spice.",
                genres=("Science Fiction", "Adventure"),
                runtime_minutes=155,
                season_episodes=None,
                poster_path="/dune.jpg",
            )
        return TitleDetails(
            source_id=source_id,
            kind="series",
            title=self.titles.get(source_id, "Saga"),
            release_year=2011,
            overview="",
            genres=("Drama",),
            runtime_minutes=55,
            season_episodes=(2, 3),
            poster_path=None,
        )

    async def recommendations(self, kind: WatchKind, source_id: int) -> list[TitleMatch]:
        self.recommendation_calls.append((kind, source_id))
        if self.fail:
            raise CatalogError
        if source_id not in self.recommended:
            raise CatalogNotFoundError
        return self.recommended[source_id]

    async def poster(self, path: str, size: PosterSize) -> Poster:
        if self.fail:
            raise CatalogError
        return Poster(content_type="image/jpeg", data=JPEG)


class FakeCatalogs:
    """Stands in for the shared TMDB client, recording which key each call used."""

    def __init__(self, catalog: FakeCatalog) -> None:
        self._catalog = catalog

    def catalog(self, api_key: str) -> FakeCatalog:
        self._catalog.keys.append(api_key)
        return self._catalog

    async def aclose(self) -> None:
        pass


@pytest.fixture
def catalog() -> FakeCatalog:
    return FakeCatalog()


@pytest.fixture
def ai() -> FakeProviderFactory:
    return FakeProviderFactory(FakeState())


@pytest.fixture
def app(migrated_settings: Settings, catalog: FakeCatalog, ai: FakeProviderFactory) -> FastAPI:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.tmdb = FakeCatalogs(catalog)
    app.state.ai_providers = ai
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def watchlist_url(client: TestClient, headers: Headers) -> str:
    workspace: dict[str, Any] = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/watchlist"


@pytest.fixture
def wl(client: TestClient, ada: Headers) -> str:
    return watchlist_url(client, ada)


def add(client: TestClient, wl: str, headers: Headers, **body: Any) -> dict[str, Any]:
    response = client.post(f"{wl}/items", json={"kind": "movie", **body}, headers=headers)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def enable_lookup(client: TestClient, wl: str, headers: Headers) -> None:
    response = client.put(f"{wl}/lookup/key", json={"api_key": GOOD_KEY}, headers=headers)
    assert response.status_code == 200, response.text


# Titles entered by hand


def test_adds_and_lists_titles_in_queue_order(client: TestClient, wl: str, ada: Headers) -> None:
    first = add(client, wl, ada, title="  Arrival ", release_year=2016, platform="")
    second = add(client, wl, ada, kind="series", title="Severance", platform="Apple TV+")

    assert first["title"] == "Arrival"
    assert first["status"] == "want"
    assert first["platform"] is None
    assert first["looked_up"] is False
    assert first["has_poster"] is False
    assert second["position"] > first["position"]

    items = client.get(f"{wl}/items", headers=ada).json()["items"]
    assert [item["title"] for item in items] == ["Arrival", "Severance"]

    moved = client.post(f"{wl}/items/{second['id']}/move-to-top", headers=ada).json()
    assert moved["position"] < first["position"]
    items = client.get(f"{wl}/items", headers=ada).json()["items"]
    assert [item["title"] for item in items] == ["Severance", "Arrival"]


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "movie"},
        {"kind": "movie", "title": "A", "source_id": 1},
        {"kind": "movie", "title": " "},
        {"kind": "show", "title": "A"},
        {"kind": "movie", "title": "A", "release_year": 1500},
        {"kind": "movie", "title": "A", "status": "later"},
        {"kind": "movie", "title": "A", "extra": 1},
    ],
)
def test_rejects_invalid_titles(
    client: TestClient, wl: str, ada: Headers, body: dict[str, Any]
) -> None:
    assert client.post(f"{wl}/items", json=body, headers=ada).status_code == 422


def test_status_changes_keep_dates_consistent(client: TestClient, wl: str, ada: Headers) -> None:
    item = add(client, wl, ada, title="Arrival")
    url = f"{wl}/items/{item['id']}"

    watching = client.patch(url, json={"status": "watching"}, headers=ada).json()
    assert watching["started_at"] is not None
    assert watching["finished_at"] is None

    watched = client.patch(url, json={"status": "watched", "rating": 9}, headers=ada).json()
    assert watched["finished_at"] is not None
    assert watched["started_at"] == watching["started_at"]
    assert watched["rating"] == 9

    back = client.patch(url, json={"status": "want"}, headers=ada).json()
    assert back["started_at"] is None
    assert back["finished_at"] is None
    assert back["rating"] == 9

    assert client.patch(url, json={"rating": 11}, headers=ada).status_code == 422
    assert client.patch(url, json={"status": None}, headers=ada).status_code == 422
    assert client.patch(url, json={}, headers=ada).status_code == 422


def test_adding_as_watched_sets_its_finish(client: TestClient, wl: str, ada: Headers) -> None:
    item = add(client, wl, ada, title="Arrival", status="watched")
    assert item["finished_at"] is not None
    assert item["started_at"] is not None


def test_logs_episodes_of_series_without_known_seasons(
    client: TestClient, wl: str, ada: Headers
) -> None:
    item = add(client, wl, ada, kind="series", title="Severance")
    url = f"{wl}/items/{item['id']}"

    first = client.post(f"{url}/next-episode", headers=ada).json()
    assert first["progress"] == {"season": 1, "episode": 1}
    assert first["status"] == "watching"
    second = client.post(f"{url}/next-episode", headers=ada).json()
    assert second["progress"] == {"season": 1, "episode": 2}

    jumped = client.patch(url, json={"progress": {"season": 2, "episode": 4}}, headers=ada).json()
    assert jumped["progress"] == {"season": 2, "episode": 4}

    cleared = client.patch(url, json={"progress": None}, headers=ada).json()
    assert cleared["progress"] is None


def test_movies_have_no_episodes(client: TestClient, wl: str, ada: Headers) -> None:
    item = add(client, wl, ada, title="Arrival")
    url = f"{wl}/items/{item['id']}"

    assert client.post(f"{url}/next-episode", headers=ada).status_code == 422
    response = client.patch(url, json={"progress": {"season": 1, "episode": 1}}, headers=ada)
    assert response.status_code == 422


def test_deletes_titles(client: TestClient, wl: str, ada: Headers) -> None:
    item = add(client, wl, ada, title="Arrival")
    url = f"{wl}/items/{item['id']}"

    assert client.delete(url, headers=ada).status_code == 204
    assert client.get(url, headers=ada).status_code == 404
    assert client.delete(url, headers=ada).status_code == 404


def test_titles_are_private_to_their_workspace(
    client: TestClient, wl: str, ada: Headers, grace: Headers
) -> None:
    item = add(client, wl, ada, title="Arrival")
    url = f"{wl}/items/{item['id']}"
    graces = watchlist_url(client, grace)

    # Another user can't reach the workspace at all...
    assert client.get(f"{wl}/items", headers=grace).status_code == 404
    assert client.get(url, headers=grace).status_code == 404
    # ...nor the title through their own workspace.
    assert client.get(f"{graces}/items/{item['id']}", headers=grace).status_code == 404
    assert (
        client.patch(f"{graces}/items/{item['id']}", json={"rating": 1}, headers=grace).status_code
        == 404
    )
    assert client.delete(f"{graces}/items/{item['id']}", headers=grace).status_code == 404
    assert client.get(f"{graces}/items", headers=grace).json()["items"] == []
    assert client.get(url, headers=ada).json()["rating"] is None


# Lookup


def test_lookup_needs_a_saved_key(
    client: TestClient, wl: str, ada: Headers, catalog: FakeCatalog
) -> None:
    off = {"configured": False, "enabled": False}
    assert client.get(f"{wl}/lookup", headers=ada).json() == off
    assert client.get(f"{wl}/search", params={"q": "dune"}, headers=ada).status_code == 409
    response = client.post(f"{wl}/items", json={"kind": "movie", "source_id": 438631}, headers=ada)
    assert response.status_code == 409
    assert client.put(f"{wl}/lookup", json={"enabled": True}, headers=ada).status_code == 409
    assert catalog.searches == []

    enable_lookup(client, wl, ada)
    on = {"configured": True, "enabled": True}
    assert client.get(f"{wl}/lookup", headers=ada).json() == on

    paused = client.put(f"{wl}/lookup", json={"enabled": False}, headers=ada)
    assert paused.json() == {"configured": True, "enabled": False}
    assert client.get(f"{wl}/search", params={"q": "dune"}, headers=ada).status_code == 409
    assert client.put(f"{wl}/lookup", json={"enabled": True}, headers=ada).json() == on

    assert client.delete(f"{wl}/lookup/key", headers=ada).json() == off
    assert client.get(f"{wl}/search", params={"q": "dune"}, headers=ada).status_code == 409


def test_keys_are_checked_and_stored_encrypted(
    client: TestClient,
    wl: str,
    ada: Headers,
    catalog: FakeCatalog,
    migrated_settings: Settings,
) -> None:
    bad = client.put(f"{wl}/lookup/key", json={"api_key": "x" * 32}, headers=ada)
    assert bad.status_code == 422
    assert client.get(f"{wl}/lookup", headers=ada).json()["configured"] is False
    for invalid in ("short", "has spaces in it, not a key"):
        response = client.put(f"{wl}/lookup/key", json={"api_key": invalid}, headers=ada)
        assert response.status_code == 422

    enable_lookup(client, wl, ada)
    stored = query(migrated_settings.sqlite_path, "SELECT tmdb_api_key FROM watchlist_settings")
    assert len(stored) == 1
    assert GOOD_KEY not in str(stored[0][0])
    assert GOOD_KEY not in client.get(f"{wl}/lookup", headers=ada).text

    # Searches use the decrypted key.
    client.get(f"{wl}/search", params={"q": "dune"}, headers=ada)
    assert catalog.keys[-1] == GOOD_KEY


def test_lookup_settings_are_per_workspace(
    client: TestClient, wl: str, ada: Headers, grace: Headers
) -> None:
    enable_lookup(client, wl, ada)
    graces = watchlist_url(client, grace)

    assert client.get(f"{wl}/lookup", headers=grace).status_code == 404
    assert client.delete(f"{wl}/lookup/key", headers=grace).status_code == 404
    assert client.get(f"{graces}/lookup", headers=grace).json() == {
        "configured": False,
        "enabled": False,
    }
    assert client.get(f"{graces}/search", params={"q": "x"}, headers=grace).status_code == 409


def test_searches_and_adds_looked_up_titles(
    client: TestClient, wl: str, ada: Headers, catalog: FakeCatalog
) -> None:
    enable_lookup(client, wl, ada)

    results = client.get(f"{wl}/search", params={"q": "dune"}, headers=ada).json()["results"]
    assert [(r["kind"], r["title"], r["existing_id"]) for r in results] == [
        ("movie", "Dune", None),
        ("series", "Saga", None),
    ]
    assert catalog.searches == ["dune"]
    assert catalog.search_filters == [(None, None)]

    item = add(client, wl, ada, source_id=438631, platform="Max", recommended_by="Sam")
    assert item["title"] == "Dune"
    assert item["genres"] == ["Science Fiction", "Adventure"]
    assert item["runtime_minutes"] == 155
    assert item["platform"] == "Max"
    assert item["recommended_by"] == "Sam"
    assert item["looked_up"] is True
    assert item["has_poster"] is True

    poster = client.get(f"{wl}/items/{item['id']}/poster", headers=ada)
    assert poster.status_code == 200
    assert poster.headers["content-type"] == "image/jpeg"
    assert poster.content == JPEG

    results = client.get(f"{wl}/search", params={"q": "dune"}, headers=ada).json()["results"]
    assert results[0]["existing_id"] == item["id"]

    duplicate = client.post(f"{wl}/items", json={"kind": "movie", "source_id": 438631}, headers=ada)
    assert duplicate.status_code == 409

    # Removing the title removes its poster from the attachment store.
    assert client.delete(f"{wl}/items/{item['id']}", headers=ada).status_code == 204
    readded = add(client, wl, ada, source_id=438631)
    assert readded["id"] != item["id"]


def test_series_progress_follows_known_seasons(client: TestClient, wl: str, ada: Headers) -> None:
    enable_lookup(client, wl, ada)
    item = add(client, wl, ada, kind="series", source_id=1399)
    assert item["season_episodes"] == [2, 3]
    assert item["has_poster"] is False
    url = f"{wl}/items/{item['id']}"

    def next_up() -> dict[str, Any]:
        result: dict[str, Any] = client.post(f"{url}/next-episode", headers=ada).json()
        return result

    assert next_up()["progress"] == {"season": 1, "episode": 1}
    assert next_up()["progress"] == {"season": 1, "episode": 2}
    assert next_up()["progress"] == {"season": 2, "episode": 1}
    assert next_up()["progress"] == {"season": 2, "episode": 2}
    finale = next_up()
    assert finale["progress"] == {"season": 2, "episode": 3}
    assert finale["status"] == "watched"
    assert finale["finished_at"] is not None
    # Logging past the finale changes nothing.
    assert next_up() == finale

    response = client.patch(url, json={"progress": {"season": 3, "episode": 1}}, headers=ada)
    assert response.status_code == 422

    restarted = client.patch(url, json={"status": "want"}, headers=ada).json()
    assert restarted["progress"] is None
    watched = client.patch(url, json={"status": "watched"}, headers=ada).json()
    assert watched["progress"] == {"season": 2, "episode": 3}


def test_search_can_narrow_by_kind_and_language(
    client: TestClient, wl: str, ada: Headers, catalog: FakeCatalog
) -> None:
    enable_lookup(client, wl, ada)
    params = {"q": "dark", "kind": "series", "language": "de"}
    assert client.get(f"{wl}/search", params=params, headers=ada).status_code == 200
    assert catalog.search_filters == [("series", "de")]
    for bad in ({"kind": "anime"}, {"language": "German"}, {"language": "DE"}):
        response = client.get(f"{wl}/search", params={"q": "dark", **bad}, headers=ada)
        assert response.status_code == 422


def test_refreshes_looked_up_titles(client: TestClient, wl: str, ada: Headers) -> None:
    enable_lookup(client, wl, ada)
    manual = add(client, wl, ada, title="Arrival")
    looked_up = add(client, wl, ada, source_id=438631)

    assert client.post(f"{wl}/items/{manual['id']}/refresh", headers=ada).status_code == 422
    refreshed = client.post(f"{wl}/items/{looked_up['id']}/refresh", headers=ada)
    assert refreshed.status_code == 200
    assert refreshed.json()["updated_at"] == looked_up["updated_at"]


def test_lookup_failures_are_safe(
    client: TestClient, wl: str, ada: Headers, catalog: FakeCatalog
) -> None:
    enable_lookup(client, wl, ada)
    missing = client.post(f"{wl}/items", json={"kind": "movie", "source_id": 404}, headers=ada)
    assert missing.status_code == 422

    catalog.fail = True
    assert client.get(f"{wl}/search", params={"q": "dune"}, headers=ada).status_code == 503
    response = client.post(f"{wl}/items", json={"kind": "movie", "source_id": 1}, headers=ada)
    assert response.status_code == 503
    assert client.get(f"{wl}/items", headers=ada).json()["items"] == []


def test_proxies_search_posters(client: TestClient, wl: str, ada: Headers) -> None:
    enable_lookup(client, wl, ada)
    poster = client.get(f"{wl}/search/poster", params={"path": "/dune.jpg"}, headers=ada)
    assert poster.status_code == 200
    assert poster.content == JPEG

    for path in ("https://evil.example/x.jpg", "/../secret.jpg", "/x.svg", "dune.jpg"):
        response = client.get(f"{wl}/search/poster", params={"path": path}, headers=ada)
        assert response.status_code == 422, path


def test_title_without_poster_returns_no_content(client: TestClient, wl: str, ada: Headers) -> None:
    item = add(client, wl, ada, title="Arrival")
    assert client.get(f"{wl}/items/{item['id']}/poster", headers=ada).status_code == 204


# Progress rules


def test_next_episode_rules() -> None:
    assert next_episode(None, None) == Progress(1, 1)
    assert next_episode(Progress(1, 9), None) == Progress(1, 10)
    assert next_episode(Progress(1, 1), (2, 3)) == Progress(1, 2)
    assert next_episode(Progress(1, 2), (2, 3)) == Progress(2, 1)
    assert next_episode(Progress(2, 3), (2, 3)) == Progress(2, 3)
    # Beyond the known seasons, episodes count up.
    assert next_episode(Progress(3, 1), (2, 3)) == Progress(3, 2)


def test_finale_and_fit_rules() -> None:
    assert is_finale(Progress(2, 3), (2, 3))
    assert not is_finale(Progress(2, 2), (2, 3))
    assert not is_finale(Progress(2, 3), None)
    assert last_episode((2, 3)) == Progress(2, 3)
    assert last_episode(None) is None
    assert fits(Progress(1, 2), (2, 3))
    assert not fits(Progress(1, 3), (2, 3))
    assert not fits(Progress(3, 1), (2, 3))
    assert fits(Progress(9, 9), None)


# TMDB adapter


def _tmdb(
    handler: Callable[[httpx2.Request], httpx2.Response], key: str = "abc123"
) -> tuple[TmdbClient, TmdbCatalog]:
    client = TmdbClient(transport=httpx2.MockTransport(handler))
    return client, client.catalog(key)


# Suggestions


def match(source_id: int, title: str, kind: WatchKind = "movie") -> TitleMatch:
    return TitleMatch(source_id, kind, title, 2020, f"About {title}.", None)


def seed_watchlist(client: TestClient, wl: str, ada: Headers, catalog: FakeCatalog) -> None:
    """Dune rated highly, Saga in progress, Flop rated low, Gone dropped, and one manual title."""
    enable_lookup(client, wl, ada)
    catalog.titles.update({1: "Dune", 2: "Saga", 3: "Flop", 4: "Gone"})
    dune = add(client, wl, ada, source_id=1)
    client.patch(f"{wl}/items/{dune['id']}", json={"status": "watched", "rating": 9}, headers=ada)
    add(client, wl, ada, kind="series", source_id=2, status="watching")
    flop = add(client, wl, ada, source_id=3)
    client.patch(f"{wl}/items/{flop['id']}", json={"status": "watched", "rating": 3}, headers=ada)
    add(client, wl, ada, source_id=4, status="dropped")
    add(client, wl, ada, title="Home movie", notes="Private note")
    catalog.recommended = {
        1: [match(10, "Arrival"), match(2, "Saga", "series"), match(11, "Sicario")],
        2: [match(12, "Dark", "series"), match(10, "Arrival"), match(4, "Gone")],
        3: [match(13, "Worse")],
        4: [match(14, "Never")],
    }


def test_suggests_titles_from_liked_and_current_titles(
    client: TestClient, wl: str, ada: Headers, grace: Headers, catalog: FakeCatalog
) -> None:
    url = f"{wl}/suggestions"
    assert client.get(url, headers=ada).status_code == 409  # No TMDB key yet.
    seed_watchlist(client, wl, ada, catalog)

    suggestions = client.get(url, headers=ada).json()["suggestions"]
    # Arrival comes from both seeds; titles already added (Saga, dropped Gone) never return, and
    # low-rated or dropped titles don't seed.
    assert [(s["title"], s["because"]) for s in suggestions] == [
        ("Arrival", ["Dune", "Saga"]),
        ("Dark", ["Saga"]),
        ("Sicario", ["Dune"]),
    ]
    assert sorted(catalog.recommendation_calls) == [("movie", 1), ("series", 2)]

    # A title that vanished from TMDB is skipped; another person can't ask for this list.
    catalog.recommended.pop(2)
    assert [s["title"] for s in client.get(url, headers=ada).json()["suggestions"]] == [
        "Arrival",
        "Sicario",
    ]
    assert client.get(url, headers=grace).status_code == 404
    catalog.fail = True
    assert client.get(url, headers=ada).status_code == 503


def test_suggestions_are_empty_without_looked_up_titles(
    client: TestClient, wl: str, ada: Headers, catalog: FakeCatalog
) -> None:
    enable_lookup(client, wl, ada)
    add(client, wl, ada, title="Typed in")
    assert client.get(f"{wl}/suggestions", headers=ada).json() == {"suggestions": []}
    assert catalog.recommendation_calls == []


AI_SETTINGS = "/api/v1/me/ai/settings"


def enable_ai(client: TestClient, headers: Headers) -> None:
    provider = client.post(
        "/api/v1/me/ai/providers", json={"name": "Local", "kind": "ollama"}, headers=headers
    ).json()
    settings = {"enabled": True, "chat_provider_id": provider["id"], "chat_model": "chat-model"}
    assert client.patch(AI_SETTINGS, json=settings, headers=headers).status_code == 200


def test_ai_picks_among_suggestions_with_reasons(
    client: TestClient, wl: str, ada: Headers, catalog: FakeCatalog, ai: FakeProviderFactory
) -> None:
    url = wl.replace("/watchlist", "/ai/watchlist/suggestions")
    seed_watchlist(client, wl, ada, catalog)
    assert client.post(url, headers=ada).status_code == 409  # AI is off.
    enable_ai(client, ada)
    # New AI settings may read the watchlist by default; without it, nothing is sent anywhere.
    assert "watchlist" in client.get(AI_SETTINGS, headers=ada).json()["modules"]
    client.patch(AI_SETTINGS, json={"modules": ["notes"]}, headers=ada)
    assert client.post(url, headers=ada).status_code == 403
    assert catalog.recommendation_calls == []
    client.patch(AI_SETTINGS, json={"modules": ["watchlist"]}, headers=ada)

    def choose(request: Any) -> str:
        prompt = request.messages[-1].content
        refs = dict(re.findall(r"^(C\d+): (\w+)", prompt, re.M))
        by_title = {title: ref for ref, title in refs.items()}
        return json.dumps(
            {
                "picks": [
                    {"ref": by_title["Dark"], "reason": "  Like   Saga. "},
                    {"ref": "C99", "reason": "Made up"},
                    {"ref": by_title["Dark"], "reason": "Again"},
                    {"ref": by_title["Arrival"].lower()},
                ]
            }
        )

    ai.state.script = choose
    result = client.post(url, headers=ada).json()
    assert [(p["suggestion"]["title"], p["reason"]) for p in result["picks"]] == [
        ("Dark", "Like Saga."),
        ("Arrival", ""),
    ]
    assert result["processing"] == "local"
    prompt = ai.state.last_prompt()
    assert "Dune (movie; 2021; Science Fiction, Adventure): watched, rated 4.5 of 5" in prompt
    assert "Private note" not in prompt

    ai.state.script = lambda request: json.dumps({"picks": [{"ref": "C99"}]})
    assert client.post(url, headers=ada).status_code == 502


def _json(data: object, status_code: int = 200) -> httpx2.Response:
    return httpx2.Response(status_code, content=json.dumps(data).encode())


@pytest.mark.anyio
async def test_tmdb_search_keeps_movies_and_series() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return _json(
            {
                "results": [
                    {
                        "media_type": "movie",
                        "id": 1,
                        "title": "Dune",
                        "release_date": "2021-09-15",
                        "overview": "Spice\n must flow.",
                        "poster_path": "/a.jpg",
                    },
                    {"media_type": "person", "id": 2, "name": "Someone"},
                    {
                        "media_type": "tv",
                        "id": 3,
                        "name": "Saga",
                        "first_air_date": "",
                        "poster_path": "/../b.jpg",
                    },
                    {"media_type": "movie", "id": "4", "title": "Bad id"},
                ]
            }
        )

    client, catalog = _tmdb(handler)
    found = await catalog.search("dune")
    await client.aclose()

    assert found == [
        TitleMatch(1, "movie", "Dune", 2021, "Spice must flow.", "/a.jpg"),
        TitleMatch(3, "series", "Saga", None, "", None),
    ]
    assert seen[0].url.path == "/3/search/multi"
    assert seen[0].url.params["api_key"] == "abc123"
    assert seen[0].url.params["query"] == "dune"


@pytest.mark.anyio
async def test_tmdb_series_details_skip_specials_and_empty_seasons() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return _json(
            {
                "name": "Saga",
                "first_air_date": "2011-04-17",
                "overview": "",
                "genres": [{"name": "Drama"}, {"id": 1}],
                "episode_run_time": [],
                "last_episode_to_air": {"runtime": 58},
                "seasons": [
                    {"season_number": 0, "episode_count": 5},
                    {"season_number": 2, "episode_count": 9},
                    {"season_number": 1, "episode_count": 10},
                    {"season_number": 3, "episode_count": 0},
                ],
                "poster_path": "/s.jpg",
            }
        )

    client, catalog = _tmdb(handler, key="eyJ.token")
    details = await catalog.details("series", 1399)
    await client.aclose()

    assert details.season_episodes == (10, 9)
    assert details.runtime_minutes == 58
    assert details.genres == ("Drama",)
    assert details.release_year == 2011
    assert seen[0].url.path == "/3/tv/1399"
    assert seen[0].headers["authorization"] == "Bearer eyJ.token"
    assert "api_key" not in seen[0].url.params


@pytest.mark.anyio
async def test_tmdb_errors_and_posters() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/3/movie/404":
            return _json({}, 404)
        if request.url.path.startswith("/t/p/w342/"):
            return httpx2.Response(200, content=JPEG)
        if request.url.path.startswith("/t/p/w92/"):
            return httpx2.Response(200, content=b"<svg/>")
        return _json({}, 500)

    client, catalog = _tmdb(handler)
    with pytest.raises(CatalogNotFoundError):
        await catalog.details("movie", 404)
    with pytest.raises(CatalogError):
        await catalog.search("x")
    assert (await catalog.poster("/a.jpg", "full")).data == JPEG
    with pytest.raises(CatalogError):
        await catalog.poster("/a.jpg", "thumbnail")
    with pytest.raises(CatalogNotFoundError):
        await catalog.poster("https://evil.example/a.jpg", "full")
    await client.aclose()


@pytest.mark.anyio
async def test_tmdb_verify_reports_refused_keys() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.params.get("api_key") == "good":
            return _json({"success": True})
        return _json({"success": False}, 401)

    client, good = _tmdb(handler, key="good")
    await good.verify()
    with pytest.raises(CatalogAuthError):
        await client.catalog("bad").verify()
    await client.aclose()


@pytest.mark.anyio
async def test_tmdb_recommendations_keep_the_kind_asked_for() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return _json(
            {
                "results": [
                    {"id": 5, "name": "Dark", "first_air_date": "2017-12-01"},
                    {"id": 6, "name": "Adult", "adult": True},
                    {"id": 7, "media_type": "tv", "name": "Typed"},
                ]
            }
        )

    client, catalog = _tmdb(handler)
    found = await catalog.recommendations("series", 1399)
    await client.aclose()

    assert found == [
        TitleMatch(5, "series", "Dark", 2017, "", None),
        TitleMatch(7, "series", "Typed", None, "", None),
    ]
    assert seen[0].url.path == "/3/tv/1399/recommendations"


@pytest.mark.anyio
async def test_tmdb_search_by_kind_and_original_language() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return _json(
            {
                "results": [
                    {"id": 1, "name": "Dark", "original_language": "de"},
                    {"id": 2, "name": "Dark Matter", "original_language": "en"},
                    {"id": 3, "name": "Odd", "original_language": "DEU"},
                ]
            }
        )

    client, catalog = _tmdb(handler)
    german = await catalog.search("dark", kind="series", language="de")
    every = await catalog.search("dark", kind="movie")
    await client.aclose()

    assert german == [TitleMatch(1, "series", "Dark", None, "", None, "de")]
    assert [(m.kind, m.original_language) for m in every] == [
        ("movie", "de"),
        ("movie", "en"),
        ("movie", None),
    ]
    assert [r.url.path for r in seen] == ["/3/search/tv", "/3/search/movie"]
