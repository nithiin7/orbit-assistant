import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.bookmarks.urls import default_status, default_title, guess_kind
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


def base_url(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/bookmarks"


@pytest.fixture
def url(client: TestClient, ada: Headers) -> str:
    """Bookmarks in Ada's personal workspace."""
    return base_url(client, ada)


def save(client: TestClient, base: str, headers: Headers, **fields: Any) -> Json:
    response = client.post(
        f"{base}/items", json={"url": "https://example.com/a", **fields}, headers=headers
    )
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


def collection(client: TestClient, url: str, headers: Headers, name: str, **fields: Any) -> Json:
    response = client.post(f"{url}/collections", json={"name": name, **fields}, headers=headers)
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


def listed(client: TestClient, url: str, headers: Headers) -> list[Json]:
    response = client.get(f"{url}/items", headers=headers)
    assert response.status_code == 200, response.text
    bookmarks: list[Json] = response.json()["bookmarks"]
    return bookmarks


# What a URL says on its own


@pytest.mark.parametrize(
    ("link", "kind"),
    [
        ("https://www.instagram.com/reel/C1abc/", "reel"),
        ("https://instagram.com/reels/C1abc", "reel"),
        ("https://www.tiktok.com/@cook/video/123", "reel"),
        ("https://youtube.com/shorts/abc", "reel"),
        ("https://www.facebook.com/reel/123", "reel"),
        ("https://www.youtube.com/watch?v=abc", "video"),
        ("https://m.youtube.com/watch?v=abc", "video"),
        ("https://youtu.be/abc", "video"),
        ("https://vimeo.com/123", "video"),
        ("https://github.com/fastapi/fastapi", "repo"),
        ("https://github.com/fastapi", "link"),
        ("https://en.wikipedia.org/wiki/Orbit", "article"),
        ("https://someone.substack.com/p/post", "article"),
        ("https://example.com/blog/hello", "article"),
        ("https://www.instagram.com/someone/", "link"),
        ("https://notyoutube.com/watch", "link"),
        ("https://example.com", "link"),
    ],
)
def test_guess_kind(link: str, kind: str) -> None:
    assert guess_kind(link) == kind


def test_things_to_consume_start_on_the_later_queue() -> None:
    assert default_status("reel") == "later"
    assert default_status("video") == "later"
    assert default_status("article") == "later"
    assert default_status("repo") == "reference"
    assert default_status("link") == "reference"


@pytest.mark.parametrize(
    ("link", "title"),
    [
        ("https://www.example.com", "example.com"),
        ("https://example.com/", "example.com"),
        ("https://example.com/docs/getting-started/", "example.com · getting started"),
        ("https://example.com/caf%C3%A9_menu", "example.com · café menu"),
        ("https://example.com/%00%0A", "example.com"),
    ],
)
def test_default_title(link: str, title: str) -> None:
    assert default_title(link) == title


def test_default_title_fits_the_limit() -> None:
    assert len(default_title("https://example.com/" + "a" * 3000)) == 200


# Bookmarks


def test_save_with_only_a_url_fills_in_the_rest(client: TestClient, ada: Headers, url: str) -> None:
    bookmark = save(client, url, ada, url="https://www.instagram.com/reel/C1abc/")

    assert bookmark["title"] == "instagram.com · C1abc"
    assert bookmark["kind"] == "reel"
    assert bookmark["status"] == "later"
    assert bookmark["note"] == ""
    assert bookmark["tags"] == []
    assert bookmark["pinned"] is False
    assert bookmark["collection_id"] is None
    assert bookmark["open_count"] == 0
    assert bookmark["last_opened_at"] is None
    assert listed(client, url, ada) == [bookmark]


def test_save_with_every_field(client: TestClient, ada: Headers, url: str) -> None:
    tools = collection(client, url, ada, "Work tools", color="teal")

    bookmark = save(
        client,
        url,
        ada,
        url="https://grafana.example.com/d/abc",
        title="  Grafana  ",
        note="Prod dashboards\nfor on-call",
        kind="tool",
        status="reference",
        tags=["work", "Work", "ops"],
        pinned=True,
        collection_id=tools["id"],
    )

    assert bookmark["title"] == "Grafana"
    assert bookmark["note"] == "Prod dashboards\nfor on-call"
    assert bookmark["kind"] == "tool"
    assert bookmark["tags"] == ["work", "ops"]
    assert bookmark["pinned"] is True
    assert bookmark["collection_id"] == tools["id"]
    got = client.get(f"{url}/items/{bookmark['id']}", headers=ada)
    assert got.json() == bookmark


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"url": ""},
        {"url": "javascript:alert(1)"},
        {"url": "data:text/html,hi"},
        {"url": "file:///etc/passwd"},
        {"url": "example.com"},
        {"url": "https://"},
        {"url": "https://exa mple.com"},
        {"url": "https://example.com/" + "a" * 2048},
        {"url": "https://example.com", "title": ""},
        {"url": "https://example.com", "title": "a\nb"},
        {"url": "https://example.com", "title": "a" * 201},
        {"url": "https://example.com", "note": "a" * 1001},
        {"url": "https://example.com", "kind": "podcast"},
        {"url": "https://example.com", "status": "someday"},
        {"url": "https://example.com", "tags": ["a"] * 11},
        {"url": "https://example.com", "tags": [""]},
        {"url": "https://example.com", "tags": ["a" * 31]},
        {"url": "https://example.com", "owner": "me"},
    ],
)
def test_input_is_validated(client: TestClient, ada: Headers, url: str, body: Json) -> None:
    response = client.post(f"{url}/items", json=body, headers=ada)
    assert response.status_code == 422, response.text


def test_urls_are_trimmed_and_http_is_allowed(client: TestClient, ada: Headers, url: str) -> None:
    bookmark = save(client, url, ada, url="  HTTP://Example.com/x  ")
    assert bookmark["url"] == "HTTP://Example.com/x"


def test_the_same_url_is_saved_once(client: TestClient, ada: Headers, url: str) -> None:
    save(client, url, ada, url="https://example.com/a")

    response = client.post(f"{url}/items", json={"url": "https://example.com/a"}, headers=ada)

    assert response.status_code == 409
    assert response.json()["detail"] == "You've already saved this link."
    save(client, url, ada, url="https://example.com/b")


def test_newest_first(client: TestClient, ada: Headers, url: str) -> None:
    save(client, url, ada, url="https://example.com/1")
    save(client, url, ada, url="https://example.com/2")

    assert [b["url"] for b in listed(client, url, ada)] == [
        "https://example.com/2",
        "https://example.com/1",
    ]


def test_update(client: TestClient, ada: Headers, url: str) -> None:
    bookmark = save(client, url, ada, tags=["a"])
    recipes = collection(client, url, ada, "Recipes")

    response = client.patch(
        f"{url}/items/{bookmark['id']}",
        json={
            "url": "https://example.com/b",
            "title": "B",
            "note": "why",
            "kind": "article",
            "status": "done",
            "tags": ["x", "y"],
            "pinned": True,
            "collection_id": recipes["id"],
        },
        headers=ada,
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["url"] == "https://example.com/b"
    assert updated["title"] == "B"
    assert updated["note"] == "why"
    assert updated["kind"] == "article"
    assert updated["status"] == "done"
    assert updated["tags"] == ["x", "y"]
    assert updated["pinned"] is True
    assert updated["collection_id"] == recipes["id"]
    assert updated["updated_at"] >= bookmark["updated_at"]

    cleared = client.patch(
        f"{url}/items/{bookmark['id']}", json={"collection_id": None}, headers=ada
    ).json()
    assert cleared["collection_id"] is None
    assert cleared["title"] == "B"


@pytest.mark.parametrize(
    "body",
    [{}, {"title": None}, {"pinned": None}, {"tags": None}, {"url": "ftp://example.com"}],
)
def test_update_is_validated(client: TestClient, ada: Headers, url: str, body: Json) -> None:
    bookmark = save(client, url, ada)
    response = client.patch(f"{url}/items/{bookmark['id']}", json=body, headers=ada)
    assert response.status_code == 422, response.text


def test_update_cannot_take_another_bookmarks_url(
    client: TestClient, ada: Headers, url: str
) -> None:
    save(client, url, ada, url="https://example.com/a")
    other = save(client, url, ada, url="https://example.com/b")

    clash = client.patch(
        f"{url}/items/{other['id']}", json={"url": "https://example.com/a"}, headers=ada
    )
    same = client.patch(
        f"{url}/items/{other['id']}", json={"url": "https://example.com/b"}, headers=ada
    )

    assert clash.status_code == 409
    assert same.status_code == 200


def test_unknown_collection_is_rejected(client: TestClient, ada: Headers, url: str) -> None:
    bookmark = save(client, url, ada)
    missing = str(uuid.uuid4())

    created = client.post(
        f"{url}/items", json={"url": "https://example.com/z", "collection_id": missing}, headers=ada
    )
    updated = client.patch(
        f"{url}/items/{bookmark['id']}", json={"collection_id": missing}, headers=ada
    )

    assert created.status_code == 422
    assert updated.status_code == 422


def test_record_open(client: TestClient, ada: Headers, url: str) -> None:
    bookmark = save(client, url, ada)

    client.post(f"{url}/items/{bookmark['id']}/opened", headers=ada)
    response = client.post(f"{url}/items/{bookmark['id']}/opened", headers=ada)

    assert response.status_code == 200
    opened = response.json()
    assert opened["open_count"] == 2
    assert opened["last_opened_at"] is not None
    assert opened["updated_at"] == bookmark["updated_at"]


def test_delete(client: TestClient, ada: Headers, url: str) -> None:
    bookmark = save(client, url, ada)

    assert client.delete(f"{url}/items/{bookmark['id']}", headers=ada).status_code == 204
    assert client.delete(f"{url}/items/{bookmark['id']}", headers=ada).status_code == 404
    assert listed(client, url, ada) == []


def test_unknown_and_invalid_ids(client: TestClient, ada: Headers, url: str) -> None:
    missing = uuid.uuid4()
    assert client.get(f"{url}/items/{missing}", headers=ada).status_code == 404
    assert (
        client.patch(f"{url}/items/{missing}", json={"pinned": True}, headers=ada).status_code
        == 404
    )
    assert client.post(f"{url}/items/{missing}/opened", headers=ada).status_code == 404
    assert client.get(f"{url}/items/not-a-uuid", headers=ada).status_code == 422


# Collections


def test_collections(client: TestClient, ada: Headers, url: str) -> None:
    work = collection(client, url, ada, "Work")
    recipes = collection(client, url, ada, "Recipes", color="rose")
    save(client, url, ada, collection_id=recipes["id"])

    response = client.get(f"{url}/collections", headers=ada)

    assert response.status_code == 200
    assert response.json()["collections"] == [
        {"id": work["id"], "name": "Work", "color": "blue", "position": 0, "bookmarks": 0},
        {"id": recipes["id"], "name": "Recipes", "color": "rose", "position": 1, "bookmarks": 1},
    ]


def test_collection_names_are_unique_ignoring_case_and_spacing(
    client: TestClient, ada: Headers, url: str
) -> None:
    collection(client, url, ada, "Work tools")
    other = collection(client, url, ada, "Recipes")

    created = client.post(f"{url}/collections", json={"name": " work  TOOLS "}, headers=ada)
    renamed = client.patch(
        f"{url}/collections/{other['id']}", json={"name": "WORK tools"}, headers=ada
    )

    assert created.status_code == 409
    assert renamed.status_code == 409


def test_rename_and_recolor_a_collection(client: TestClient, ada: Headers, url: str) -> None:
    work = collection(client, url, ada, "Work")
    save(client, url, ada, collection_id=work["id"])

    response = client.patch(
        f"{url}/collections/{work['id']}", json={"name": "Job", "color": "green"}, headers=ada
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": work["id"],
        "name": "Job",
        "color": "green",
        "position": 0,
        "bookmarks": 1,
    }
    for body in ({}, {"name": None}, {"name": ""}, {"color": "pink"}):
        bad = client.patch(f"{url}/collections/{work['id']}", json=body, headers=ada)
        assert bad.status_code == 422, body


def test_deleting_a_collection_keeps_its_bookmarks(
    client: TestClient, ada: Headers, url: str
) -> None:
    work = collection(client, url, ada, "Work")
    bookmark = save(client, url, ada, collection_id=work["id"])

    assert client.delete(f"{url}/collections/{work['id']}", headers=ada).status_code == 204
    assert client.delete(f"{url}/collections/{work['id']}", headers=ada).status_code == 404

    [kept] = listed(client, url, ada)
    assert kept["id"] == bookmark["id"]
    assert kept["collection_id"] is None


def test_too_many_collections(client: TestClient, ada: Headers, url: str) -> None:
    for number in range(50):
        collection(client, url, ada, f"C{number}")

    response = client.post(f"{url}/collections", json={"name": "One more"}, headers=ada)

    assert response.status_code == 409


# Isolation


def test_other_workspaces_bookmarks_are_unreachable(
    client: TestClient, ada: Headers, grace: Headers, url: str
) -> None:
    bookmark = save(client, url, ada)
    work = collection(client, url, ada, "Work")
    grace_url = base_url(client, grace)
    item = f"{grace_url}/items/{bookmark['id']}"

    assert client.get(item, headers=grace).status_code == 404
    assert client.patch(item, json={"pinned": True}, headers=grace).status_code == 404
    assert client.post(f"{item}/opened", headers=grace).status_code == 404
    assert client.delete(item, headers=grace).status_code == 404
    assert (
        client.patch(
            f"{grace_url}/collections/{work['id']}", json={"name": "Mine"}, headers=grace
        ).status_code
        == 404
    )
    assert client.delete(f"{grace_url}/collections/{work['id']}", headers=grace).status_code == 404
    assert listed(client, grace_url, grace) == []
    assert client.get(f"{grace_url}/collections", headers=grace).json() == {"collections": []}
    # Grace saving the same URL is fine: it's her own workspace.
    save(client, grace_url, grace)
    # And she can't file her bookmark in Ada's collection.
    response = client.post(
        f"{grace_url}/items",
        json={"url": "https://example.com/g", "collection_id": work["id"]},
        headers=grace,
    )
    assert response.status_code == 422
    assert listed(client, url, ada)[0]["pinned"] is False
