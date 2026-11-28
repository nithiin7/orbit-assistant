from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import httpx2
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from orbit_api import __version__
from orbit_api.config import Settings
from orbit_api.db.migrate import head_revision
from orbit_api.main import create_app
from orbit_api.providers.releases.github import GitHubReleaseFeed, parse_release
from orbit_api.services.system.models import (
    Release,
    ReleaseFeedError,
    ServerFeatures,
    UpdateCheckState,
)
from orbit_api.services.system.service import SystemService, is_newer
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

STATUS = "/api/v1/system/status"
UPDATE = "/api/v1/system/update"
CHECK = "/api/v1/system/update/check"
SETTINGS = "/api/v1/system/settings"

Headers = dict[str, str]


class FakeFeed:
    def __init__(self, version: str = "99.0.0") -> None:
        self.version = version
        self.failing = False
        self.calls: list[str] = []

    async def latest(self, repository: str) -> Release:
        self.calls.append(repository)
        if self.failing:
            raise ReleaseFeedError
        return Release(version=self.version, published_at=datetime(2026, 11, 20, tzinfo=UTC))

    async def aclose(self) -> None:
        pass


@pytest.fixture
def feed() -> FakeFeed:
    return FakeFeed()


@pytest.fixture
def client(migrated_settings: Settings, feed: FakeFeed) -> Iterator[TestClient]:
    app = create_app(migrated_settings)
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.release_feed = feed
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client))


# Routes


def test_status_reports_version_database_worker_and_features(
    client: TestClient, ada: Headers
) -> None:
    body = client.get(STATUS, headers=ada).json()

    assert body["version"] == __version__
    assert body["storage_mode"] == "local"
    assert datetime.fromisoformat(body["started_at"]) <= datetime.now(UTC)
    assert body["database"] == {
        "status": "ok",
        "revision": head_revision(),
        "expected_revision": head_revision(),
    }
    # Tests drive the worker directly, so the API doesn't run one.
    assert body["worker"] == {"runs_in_api": False, "status": "ok"}
    assert set(body["features"]) == {
        "ai",
        "agent",
        "web_push",
        "google",
        "microsoft",
        "online_maps",
    }
    assert body["features"]["google"] is False


def test_status_reveals_no_paths(
    client: TestClient, ada: Headers, migrated_settings: Settings
) -> None:
    text = client.get(STATUS, headers=ada).text
    assert str(migrated_settings.sqlite_path.parent) not in text


def test_system_routes_need_a_session(client: TestClient) -> None:
    assert client.get(STATUS).status_code == 401
    assert client.get(UPDATE).status_code == 401
    assert client.post(CHECK).status_code == 401
    assert client.put(SETTINGS, json={"update_check_enabled": True}).status_code == 401


def test_update_checks_are_off_until_turned_on(
    client: TestClient, ada: Headers, feed: FakeFeed
) -> None:
    body = client.get(UPDATE, headers=ada).json()
    assert body == {
        "enabled": False,
        "repository": "nithiin7/orbit-assistant",
        "current_version": __version__,
        "latest_version": None,
        "latest_published_at": None,
        "update_available": False,
        "release_url": None,
        "checked_at": None,
        "check_failed": False,
    }
    assert client.post(CHECK, headers=ada).json()["checked_at"] is None
    assert feed.calls == []


def test_turning_checks_on_finds_a_newer_release(
    client: TestClient, ada: Headers, feed: FakeFeed
) -> None:
    body = client.put(SETTINGS, json={"update_check_enabled": True}, headers=ada).json()

    assert feed.calls == ["nithiin7/orbit-assistant"]
    assert body["enabled"] is True
    assert body["latest_version"] == "99.0.0"
    assert body["update_available"] is True
    assert body["release_url"] == (
        "https://github.com/nithiin7/orbit-assistant/releases/tag/v99.0.0"
    )
    assert body["checked_at"] is not None
    assert body["check_failed"] is False


def test_a_recent_answer_is_reused(client: TestClient, ada: Headers, feed: FakeFeed) -> None:
    client.put(SETTINGS, json={"update_check_enabled": True}, headers=ada)
    client.get(UPDATE, headers=ada)
    # Checking now right after a check doesn't ask again either.
    client.post(CHECK, headers=ada)
    assert len(feed.calls) == 1


def test_the_current_version_is_not_an_update(
    client: TestClient, ada: Headers, feed: FakeFeed
) -> None:
    feed.version = __version__
    body = client.put(SETTINGS, json={"update_check_enabled": True}, headers=ada).json()
    assert body["latest_version"] == __version__
    assert body["update_available"] is False


def test_a_failed_check_is_reported_not_raised(
    client: TestClient, ada: Headers, feed: FakeFeed
) -> None:
    feed.failing = True
    response = client.put(SETTINGS, json={"update_check_enabled": True}, headers=ada)
    assert response.status_code == 200
    assert response.json()["check_failed"] is True
    assert response.json()["latest_version"] is None


def test_turning_checks_off_hides_the_last_result(
    client: TestClient, ada: Headers, feed: FakeFeed
) -> None:
    client.put(SETTINGS, json={"update_check_enabled": True}, headers=ada)
    body = client.put(SETTINGS, json={"update_check_enabled": False}, headers=ada).json()
    assert body["enabled"] is False
    assert body["latest_version"] is None
    assert body["update_available"] is False
    assert client.get(UPDATE, headers=ada).json()["enabled"] is False
    assert len(feed.calls) == 1


def test_settings_are_validated(client: TestClient, ada: Headers) -> None:
    assert client.put(SETTINGS, json={}, headers=ada).status_code == 422
    response = client.put(SETTINGS, json={"update_check_enabled": "maybe"}, headers=ada)
    assert response.status_code == 422


# Service


class MemorySettings:
    def __init__(self) -> None:
        self.state = UpdateCheckState(
            enabled=True,
            latest_version=None,
            latest_published_at=None,
            checked_at=None,
            check_failed=False,
        )

    async def update_check(self) -> UpdateCheckState:
        return self.state

    async def set_update_check_enabled(self, enabled: bool) -> None:
        self.state = replace(self.state, enabled=enabled)

    async def record_check(self, release: Release | None, checked_at: datetime) -> None:
        state = self.state
        self.state = UpdateCheckState(
            enabled=state.enabled,
            latest_version=release.version if release else state.latest_version,
            latest_published_at=release.published_at if release else state.latest_published_at,
            checked_at=checked_at,
            check_failed=release is None,
        )


class FakeHealth:
    def __init__(self, revision: str | None, *, waiting: bool = False) -> None:
        self.revision = revision
        self.waiting = waiting
        self.before: datetime | None = None

    async def schema_revision(self) -> str | None:
        return self.revision

    async def reminders_waiting_since(self, before: datetime) -> bool:
        self.before = before
        return self.waiting


class NoTransaction:
    async def commit(self) -> None:
        pass

    async def rollback(self) -> None:
        pass


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 28, 9, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


FEATURES = ServerFeatures(
    ai=True, agent=True, web_push=False, google=False, microsoft=False, online_maps=True
)


def service(
    feed: FakeFeed, clock: Clock, health: FakeHealth | None = None
) -> tuple[SystemService, MemorySettings]:
    settings = MemorySettings()
    return (
        SystemService(
            settings,
            health or FakeHealth("0055"),
            NoTransaction(),
            feed,
            repository="me/orbit",
            current_version="1.0.0",
            clock=clock,
        ),
        settings,
    )


@pytest.mark.anyio
async def test_checks_again_after_a_day_and_an_hour_after_a_failure() -> None:
    feed, clock = FakeFeed("1.1.0"), Clock()
    system, _ = service(feed, clock)

    await system.update_status()
    clock.now += timedelta(hours=23)
    await system.update_status()
    assert len(feed.calls) == 1
    clock.now += timedelta(hours=1)
    await system.update_status()
    assert len(feed.calls) == 2

    feed.failing = True
    clock.now += timedelta(days=1)
    failed = await system.update_status()
    # The release from the earlier check is still shown, marked as not current.
    assert failed.check_failed is True
    assert failed.latest_version == "1.1.0"
    clock.now += timedelta(minutes=59)
    await system.update_status()
    assert len(feed.calls) == 3
    clock.now += timedelta(minutes=1)
    await system.update_status()
    assert len(feed.calls) == 4


@pytest.mark.anyio
async def test_checking_now_waits_a_minute_between_checks() -> None:
    feed, clock = FakeFeed(), Clock()
    system, _ = service(feed, clock)
    await system.update_status(check_now=True)
    clock.now += timedelta(seconds=30)
    await system.update_status(check_now=True)
    assert len(feed.calls) == 1
    clock.now += timedelta(seconds=30)
    await system.update_status(check_now=True)
    assert len(feed.calls) == 2


@pytest.mark.anyio
async def test_status_flags_an_old_schema_and_a_stalled_worker() -> None:
    clock = Clock()
    health = FakeHealth("0050", waiting=True)
    system, _ = service(FakeFeed(), clock, health)

    status = await system.status(
        storage_mode="local",
        started_at=clock.now,
        expected_revision="0055",
        worker_in_api=True,
        poll_interval=timedelta(seconds=15),
        features=FEATURES,
    )

    assert status.database.state == "outdated"
    assert status.database.revision == "0050"
    assert status.worker.state == "behind"
    # A short poll interval still allows five minutes before calling the worker behind.
    assert health.before == clock.now - timedelta(minutes=5)


@pytest.mark.anyio
async def test_a_slow_poll_interval_allows_more_lag() -> None:
    clock = Clock()
    health = FakeHealth("0055")
    system, _ = service(FakeFeed(), clock, health)
    status = await system.status(
        storage_mode="cloud",
        started_at=clock.now,
        expected_revision="0055",
        worker_in_api=False,
        poll_interval=timedelta(minutes=5),
        features=FEATURES,
    )
    assert status.database.state == "ok"
    assert status.worker.state == "ok"
    assert health.before == clock.now - timedelta(minutes=20)


@pytest.mark.parametrize(
    ("latest", "current", "newer"),
    [
        ("1.0.1", "1.0.0", True),
        ("1.10.0", "1.9.3", True),
        ("2.0.0", "1.99.99", True),
        ("1.0.0", "1.0.0", False),
        ("0.9.0", "1.0.0", False),
        ("v1.2.0", "1.1.0", True),
        ("nonsense", "1.0.0", False),
        ("1.2.0", "dev", False),
    ],
)
def test_version_comparison(latest: str, current: str, newer: bool) -> None:
    assert is_newer(latest, current) is newer


# GitHub feed


def test_parse_release_reads_the_tag_and_date() -> None:
    release = parse_release({"tag_name": "v1.4.2", "published_at": "2026-11-20T10:00:00Z"})
    assert release == Release(version="1.4.2", published_at=datetime(2026, 11, 20, 10, tzinfo=UTC))
    assert parse_release({"tag_name": "1.4.2", "published_at": None}).published_at is None


@pytest.mark.parametrize(
    "body",
    [
        [],
        {"tag_name": None},
        {"tag_name": "nightly"},
        {"tag_name": "v1.2"},
        {"tag_name": "v1.2.3-rc.1"},
    ],
)
def test_parse_release_rejects_unexpected_answers(body: object) -> None:
    with pytest.raises(ReleaseFeedError):
        parse_release(body)


@pytest.mark.anyio
async def test_github_feed_asks_for_the_latest_release() -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json={"tag_name": "v2.0.0", "published_at": None})

    feed = GitHubReleaseFeed(transport=httpx2.MockTransport(handler))
    try:
        assert (await feed.latest("me/orbit")).version == "2.0.0"
    finally:
        await feed.aclose()
    assert str(requests[0].url) == "https://api.github.com/repos/me/orbit/releases/latest"
    assert "Authorization" not in requests[0].headers


@pytest.mark.anyio
@pytest.mark.parametrize("status", [404, 403, 500])
async def test_github_feed_reports_errors(status: int) -> None:
    feed = GitHubReleaseFeed(transport=httpx2.MockTransport(lambda _: httpx2.Response(status)))
    try:
        with pytest.raises(ReleaseFeedError):
            await feed.latest("me/orbit")
    finally:
        await feed.aclose()


@pytest.mark.parametrize("repository", ["orbit", "../..", "me/..", "me/orbit/extra", "me /orbit"])
def test_update_repository_must_be_owner_and_name(repository: str) -> None:
    with pytest.raises(ValidationError):
        Settings(update_repository=repository)
