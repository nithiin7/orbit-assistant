"""Link previews: parsing, image sniffing, the fetcher's address guard, and the routes."""

import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.providers.web.link_preview import LinkPreviewClient, is_public
from orbit_api.services.bookmarks.models import (
    BlockedAddressError,
    FetchedPage,
    PreviewFetchError,
)
from orbit_api.services.bookmarks.preview import parse_page, sniff_image
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
PNG = b"\x89PNG\r\n\x1a\n" + b"image" * 10
JPEG = b"\xff\xd8\xff\xe0" + b"photo" * 10
ICO = b"\x00\x00\x01\x00" + b"icon" * 10
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

Headers = dict[str, str]
Json = dict[str, Any]


# Parsing


def test_parse_prefers_open_graph_and_resolves_addresses() -> None:
    html = """<!doctype html><html><head>
      <title>Plain title</title>
      <meta property="og:title" content="  Knife   skills
       in 60s ">
      <meta name="description" content="Fallback">
      <meta property="og:description" content="Chop faster.">
      <meta property="og:image" content="/img/cover.jpg">
      <meta property="og:type" content="video.other">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="shortcut icon" href="https://cdn.example.com/fav.ico">
    </head><body><meta property="og:title" content="ignored"></body></html>"""

    meta = parse_page(html, "https://www.example.com/reel/1")

    assert meta.title == "Knife skills in 60s"
    assert meta.description == "Chop faster."
    assert meta.image_url == "https://www.example.com/img/cover.jpg"
    assert meta.icon_url == "https://cdn.example.com/fav.ico"
    assert meta.og_type == "video.other"


def test_parse_falls_back_and_drops_unsafe_addresses() -> None:
    html = (
        "<head><title>A\x00B &amp; C</title>"
        '<meta name="twitter:image" content="javascript:alert(1)"></head>'
    )

    meta = parse_page(html, "https://example.com/a/b")

    assert meta.title == "A B & C"
    assert meta.description is None
    assert meta.image_url is None
    assert meta.icon_url == "https://example.com/favicon.ico"


def test_parse_limits_lengths_and_survives_garbage() -> None:
    long = "x" * 2000
    meta = parse_page(
        f'<meta property="og:title" content="{long}"><meta name="description" content="{long}">',
        "https://example.com",
    )
    assert meta.title is not None and len(meta.title) == 200
    assert meta.description is not None and len(meta.description) == 500
    assert parse_page("<<<>>><meta", "https://example.com").title is None


def test_sniff_image() -> None:
    assert sniff_image(PNG, allow_icon=False) == "image/png"
    assert sniff_image(JPEG, allow_icon=False) == "image/jpeg"
    assert sniff_image(b"GIF89a....", allow_icon=False) == "image/gif"
    assert sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ", allow_icon=False) == "image/webp"
    assert sniff_image(ICO, allow_icon=True) == "image/x-icon"
    assert sniff_image(ICO, allow_icon=False) is None
    assert sniff_image(SVG, allow_icon=True) is None
    assert sniff_image(b"<html>", allow_icon=True) is None


# The fetcher's guard


@pytest.mark.parametrize(
    ("address", "public"),
    [
        ("93.184.216.34", True),
        ("2606:2800:220:1:248:1893:25c8:1946", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("172.16.0.1", False),
        ("192.168.1.1", False),
        ("169.254.169.254", False),
        ("100.64.0.1", False),
        ("0.0.0.0", False),
        ("224.0.0.1", False),
        ("::1", False),
        ("fe80::1%eth0", False),
        ("fd00::1", False),
        ("::ffff:127.0.0.1", False),
        ("::ffff:10.0.0.1", False),
        ("not an ip", False),
    ],
)
def test_is_public(address: str, public: bool) -> None:
    assert is_public(address) is public


HOSTS = {
    "example.com": ["93.184.216.34"],
    "cdn.example.com": ["93.184.216.35"],
    "internal.example.com": ["10.0.0.5"],
    "mixed.example.com": ["93.184.216.36", "127.0.0.1"],
    "metadata.example.com": ["169.254.169.254"],
}


async def fake_resolve(host: str, _port: int) -> list[str]:
    return HOSTS.get(host, [])


def client(handler: Any) -> LinkPreviewClient:
    return LinkPreviewClient(transport=httpx2.MockTransport(handler), resolver=fake_resolve)


@pytest.mark.anyio
async def test_fetches_by_checked_address_with_the_real_host_name() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(
            200,
            headers={"content-type": "text/html; charset=iso-8859-1"},
            content="<title>Caf\xe9</title>".encode("latin-1"),
        )

    page = await client(handler).page("https://example.com/a?b=c#frag")

    assert page.url == "https://example.com/a?b=c#frag"
    assert "Café" in page.html
    [request] = seen
    assert request.url.host == "93.184.216.34"
    assert request.url.path == "/a"
    assert request.url.query == b"b=c"
    assert request.headers["host"] == "example.com"
    assert request.extensions["sni_hostname"] == "example.com"
    assert "cookie" not in request.headers


@pytest.mark.parametrize(
    "url",
    [
        "https://internal.example.com/",
        "https://mixed.example.com/",
        "http://metadata.example.com/latest/meta-data/",
        "http://127.0.0.1/",
        "http://[::1]/",
        "https://example.com:8443/",
        "http://example.com:22/",
        "https://user:pass@example.com/",
        "ftp://example.com/",
        "https://unknown.example.com/",
    ],
)
@pytest.mark.anyio
async def test_refuses_non_public_destinations(url: str) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise AssertionError(f"contacted {request.url}")

    with pytest.raises(BlockedAddressError):
        await client(handler).page(url)


@pytest.mark.anyio
async def test_redirects_are_checked_at_every_hop() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.headers["host"] == "example.com":
            return httpx2.Response(302, headers={"location": "https://internal.example.com/x"})
        raise AssertionError("followed a redirect to a private address")

    with pytest.raises(BlockedAddressError):
        await client(handler).page("https://example.com/")


@pytest.mark.anyio
async def test_follows_a_few_redirects_and_reports_where_it_landed() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/start":
            return httpx2.Response(301, headers={"location": "https://cdn.example.com/end"})
        return httpx2.Response(200, headers={"content-type": "text/html"}, content=b"<p>hi")

    page = await client(handler).page("https://example.com/start")
    assert page.url == "https://cdn.example.com/end"

    def loop(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(302, headers={"location": "/again"})

    with pytest.raises(PreviewFetchError):
        await client(loop).page("https://example.com/")


@pytest.mark.anyio
async def test_rejects_errors_and_non_html() -> None:
    def missing(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(404)

    def pdf(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")

    def broken(_request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused")

    for handler in (missing, pdf, broken):
        with pytest.raises(PreviewFetchError):
            await client(handler).page("https://example.com/")


@pytest.mark.anyio
async def test_reads_only_the_start_of_a_page_and_limits_images() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/page":
            body = b"<title>Start</title>" + b"x" * (2 * 1024 * 1024)
            return httpx2.Response(200, headers={"content-type": "text/html"}, content=body)
        return httpx2.Response(200, headers={"content-type": "image/png"}, content=PNG * 1000)

    page = await client(handler).page("https://example.com/page")
    assert len(page.html) == 512 * 1024
    assert await client(handler).image("https://example.com/img", 100_000) == PNG * 1000
    with pytest.raises(PreviewFetchError):
        await client(handler).image("https://example.com/img", 1000)


# Routes


class FakeFetcher:
    def __init__(self) -> None:
        self.pages: dict[str, str] = {}
        self.images: dict[str, bytes] = {}
        self.calls: list[str] = []
        self.blocked = False

    async def page(self, url: str) -> FetchedPage:
        self.calls.append(url)
        if self.blocked:
            raise BlockedAddressError
        if url not in self.pages:
            raise PreviewFetchError
        return FetchedPage(url=url, html=self.pages[url])

    async def image(self, url: str, max_bytes: int) -> bytes:
        self.calls.append(url)
        if url not in self.images or len(self.images[url]) > max_bytes:
            raise PreviewFetchError
        return self.images[url]


@pytest.fixture
def fetcher() -> FakeFetcher:
    return FakeFetcher()


@pytest.fixture
def client_app(migrated_settings: Settings, fetcher: FakeFetcher) -> Iterator[TestClient]:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.link_previews = fetcher
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client_app: TestClient) -> Headers:
    return bearer(sign_up(client_app, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client_app: TestClient) -> Headers:
    return bearer(sign_up(client_app, email="grace@example.com", display_name="Grace"))


def base(http: TestClient, headers: Headers) -> str:
    workspace: Json = http.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/bookmarks"


def save(http: TestClient, collection_url: str, headers: Headers, **fields: Any) -> Json:
    response = http.post(f"{collection_url}/items", json=fields, headers=headers)
    assert response.status_code == 201, response.text
    body: Json = response.json()
    return body


def enable(http: TestClient, url: str, headers: Headers) -> None:
    response = http.put(f"{url}/settings", json={"previews_enabled": True}, headers=headers)
    assert response.json() == {"previews_enabled": True}


REEL = "https://www.instagram.com/reel/C1abc/"
REEL_PAGE = """<head>
  <meta property="og:title" content="Knife skills">
  <meta property="og:description" content="Chop faster.">
  <meta property="og:image" content="https://cdn.example.com/cover.jpg">
  <link rel="icon" href="https://cdn.example.com/icon.ico">
</head>"""


def test_previews_are_off_until_turned_on(
    client_app: TestClient, ada: Headers, fetcher: FakeFetcher
) -> None:
    url = base(client_app, ada)
    bookmark = save(client_app, url, ada, url=REEL)

    assert client_app.get(f"{url}/settings", headers=ada).json() == {"previews_enabled": False}
    response = client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada)

    assert response.status_code == 409
    assert fetcher.calls == []
    assert bookmark["has_image"] is False
    assert bookmark["preview_description"] is None
    assert bookmark["previewed_at"] is None


def test_preview_fills_in_the_bookmark(
    client_app: TestClient, ada: Headers, fetcher: FakeFetcher, migrated_settings: Settings
) -> None:
    url = base(client_app, ada)
    enable(client_app, url, ada)
    fetcher.pages[REEL] = REEL_PAGE
    fetcher.images["https://cdn.example.com/cover.jpg"] = JPEG
    fetcher.images["https://cdn.example.com/icon.ico"] = ICO
    bookmark = save(client_app, url, ada, url=REEL)

    response = client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada)

    assert response.status_code == 200, response.text
    previewed = response.json()
    assert previewed["title"] == "Knife skills"
    assert previewed["preview_description"] == "Chop faster."
    assert previewed["has_image"] is True
    assert previewed["has_icon"] is True
    assert previewed["previewed_at"] is not None
    assert previewed["updated_at"] >= bookmark["updated_at"]

    image = client_app.get(f"{url}/items/{bookmark['id']}/image", headers=ada)
    assert image.status_code == 200
    assert image.content == JPEG
    assert image.headers["content-type"] == "image/jpeg"
    assert image.headers["x-content-type-options"] == "nosniff"
    assert image.headers["content-security-policy"] == "default-src 'none'"
    icon = client_app.get(f"{url}/items/{bookmark['id']}/icon", headers=ada)
    assert icon.content == ICO
    assert icon.headers["content-type"] == "image/x-icon"
    assert client_app.get(f"{url}/items", headers=ada).json()["bookmarks"] == [previewed]


def test_preview_keeps_a_title_you_chose_and_upgrades_plain_links(
    client_app: TestClient, ada: Headers, fetcher: FakeFetcher
) -> None:
    url = base(client_app, ada)
    enable(client_app, url, ada)
    page = "https://example.com/watch/1"
    fetcher.pages[page] = (
        '<meta property="og:title" content="Theirs"><meta property="og:type" content="video.movie">'
    )
    bookmark = save(client_app, url, ada, url=page, title="Mine")

    previewed = client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada).json()

    assert previewed["title"] == "Mine"
    assert previewed["kind"] == "video"
    assert previewed["has_image"] is False
    assert client_app.get(f"{url}/items/{bookmark['id']}/image", headers=ada).status_code == 204


def test_refreshing_replaces_files_and_skips_non_images(
    client_app: TestClient, ada: Headers, fetcher: FakeFetcher, migrated_settings: Settings
) -> None:
    url = base(client_app, ada)
    enable(client_app, url, ada)
    fetcher.pages[REEL] = REEL_PAGE
    fetcher.images["https://cdn.example.com/cover.jpg"] = JPEG
    bookmark = save(client_app, url, ada, url=REEL)
    client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada)
    [(first_id,)] = query(
        migrated_settings.sqlite_path, "SELECT id FROM bookmark_previews WHERE role = 'image'"
    )

    fetcher.images["https://cdn.example.com/cover.jpg"] = PNG
    fetcher.images["https://cdn.example.com/icon.ico"] = SVG
    again = client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada).json()

    assert again["has_image"] is True
    assert again["has_icon"] is False
    assert client_app.get(f"{url}/items/{bookmark['id']}/image", headers=ada).content == PNG
    rows = query(migrated_settings.sqlite_path, "SELECT id, role FROM bookmark_previews")
    assert len(rows) == 1
    workspace_dir = next(migrated_settings.attachments_dir.iterdir())
    files = {path.name for path in workspace_dir.rglob("*") if path.is_file()}
    assert str(uuid.UUID(str(first_id))) not in "".join(files)
    assert len(files) == 1


def test_fetch_failures(client_app: TestClient, ada: Headers, fetcher: FakeFetcher) -> None:
    url = base(client_app, ada)
    enable(client_app, url, ada)
    bookmark = save(client_app, url, ada, url="https://example.com/gone")

    missing = client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada)
    fetcher.blocked = True
    blocked = client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada)

    assert missing.status_code == 502
    assert blocked.status_code == 422
    unchanged = client_app.get(f"{url}/items/{bookmark['id']}", headers=ada).json()
    assert unchanged["previewed_at"] is None


def test_deleting_a_bookmark_deletes_its_files(
    client_app: TestClient, ada: Headers, fetcher: FakeFetcher, migrated_settings: Settings
) -> None:
    url = base(client_app, ada)
    enable(client_app, url, ada)
    fetcher.pages[REEL] = REEL_PAGE
    fetcher.images["https://cdn.example.com/cover.jpg"] = JPEG
    fetcher.images["https://cdn.example.com/icon.ico"] = ICO
    bookmark = save(client_app, url, ada, url=REEL)
    client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada)

    assert client_app.delete(f"{url}/items/{bookmark['id']}", headers=ada).status_code == 204

    assert query(migrated_settings.sqlite_path, "SELECT id FROM bookmark_previews") == []
    stored = [p for p in Path(migrated_settings.attachments_dir).rglob("*") if p.is_file()]
    assert stored == []


def test_other_workspaces_cant_reach_previews_or_settings(
    client_app: TestClient, ada: Headers, grace: Headers, fetcher: FakeFetcher
) -> None:
    url = base(client_app, ada)
    enable(client_app, url, ada)
    fetcher.pages[REEL] = REEL_PAGE
    fetcher.images["https://cdn.example.com/cover.jpg"] = JPEG
    bookmark = save(client_app, url, ada, url=REEL)
    client_app.post(f"{url}/items/{bookmark['id']}/preview", headers=ada)
    grace_url = base(client_app, grace)
    calls = len(fetcher.calls)

    for path in ("image", "icon"):
        response = client_app.get(f"{grace_url}/items/{bookmark['id']}/{path}", headers=grace)
        assert response.status_code == 404
    enable(client_app, grace_url, grace)
    response = client_app.post(f"{grace_url}/items/{bookmark['id']}/preview", headers=grace)
    assert response.status_code == 404
    assert len(fetcher.calls) == calls
    # Ada's setting is hers; Grace's change didn't touch it, and vice versa.
    client_app.put(f"{url}/settings", json={"previews_enabled": False}, headers=ada)
    assert client_app.get(f"{grace_url}/settings", headers=grace).json() == {
        "previews_enabled": True
    }
