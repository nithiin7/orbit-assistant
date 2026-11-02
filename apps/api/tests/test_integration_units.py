"""Pure integration logic: RFC 5545 rule translation, field limits, snapshots, PKCE, backoff,
token refresh under concurrency, the secret box without a key, and configuration checks."""

import asyncio
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from orbit_api.config import Settings
from orbit_api.services.calendar.recurrence import EventRecurrence
from orbit_api.services.integrations.connectors import (
    AccountInfo,
    ConnectorRegistry,
    ReauthRequiredError,
    RemoteEvent,
    TokenSet,
)
from orbit_api.services.integrations.mapping import (
    UNTITLED,
    from_snapshot,
    normalized,
    parse_rrule,
    rrule_lines,
    to_snapshot,
)
from orbit_api.services.integrations.models import Connection, TokenStorageUnavailableError
from orbit_api.services.integrations.oauth import code_challenge, digest, matches
from orbit_api.services.integrations.runner import backoff
from orbit_api.services.integrations.store import IntegrationStore
from orbit_api.services.integrations.tokens import TokenManager
from orbit_api.system.secrets import FernetSecretBox, IntegrationSecretBox
from tests.integration_fakes import FakeProvider, FakeRegistry

START = datetime(2030, 1, 14, 9, 0)  # A Monday.


# Recurrence


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("RRULE:FREQ=DAILY", EventRecurrence("daily")),
        ("RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5", EventRecurrence("daily", interval=2, count=5)),
        ("RRULE:FREQ=WEEKLY", EventRecurrence("weekly", weekdays=frozenset({"mon"}))),
        (
            "RRULE:FREQ=WEEKLY;BYDAY=MO,FR;WKST=SU",
            EventRecurrence("weekly", weekdays=frozenset({"mon", "fri"})),
        ),
        ("RRULE:FREQ=MONTHLY;BYMONTHDAY=14", EventRecurrence("monthly")),
        ("RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=14", EventRecurrence("yearly")),
        ("RRULE:FREQ=DAILY;UNTIL=20300120", EventRecurrence("daily", until=date(2030, 1, 20))),
        # A UTC end instant becomes the local date it falls on.
        (
            "RRULE:FREQ=DAILY;UNTIL=20300120T235959Z",
            EventRecurrence("daily", until=date(2030, 1, 21)),
        ),
    ],
)
def test_rules_orbit_can_represent(line: str, expected: EventRecurrence) -> None:
    parsed = parse_rrule([line], START, "Asia/Tokyo")
    assert parsed is not None and parsed[0] == expected


@pytest.mark.parametrize(
    "lines",
    [
        ["RRULE:FREQ=MONTHLY;BYDAY=2TU"],
        ["RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1"],
        ["RRULE:FREQ=WEEKLY;BYDAY=TU"],  # Doesn't include the start's weekday.
        ["RRULE:FREQ=HOURLY"],
        ["RRULE:FREQ=DAILY;COUNT=5000"],
        ["RRULE:FREQ=DAILY", "RDATE:20300301T090000"],
        ["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"],
        ["RRULE:FREQ=MONTHLY;BYMONTHDAY=1"],
        ["RRULE:FREQ=DAILY;UNTIL=20290101"],
        ["RRULE:FREQ=DAILY;COUNT=2;UNTIL=20300120"],
        ["RRULE:garbage"],
    ],
)
def test_rules_orbit_cant_represent_are_never_approximated(lines: list[str]) -> None:
    assert parse_rrule(lines, START, "UTC") is None


def test_exdates_become_skipped_starts_in_the_series_zone() -> None:
    parsed = parse_rrule(
        ["RRULE:FREQ=DAILY", "EXDATE;TZID=Europe/Paris:20300115T100000", "EXDATE:20300117T080000Z"],
        START,
        "Europe/London",
    )
    assert parsed is not None
    assert parsed[1] == (datetime(2030, 1, 15, 9, 0), datetime(2030, 1, 17, 8, 0))


def test_orbit_rules_round_trip_through_rfc_5545() -> None:
    rule = EventRecurrence("weekly", interval=2, weekdays=frozenset({"mon", "wed"}), count=6)
    parsed = parse_rrule(rrule_lines(rule), START, "UTC")
    assert parsed is not None and parsed[0] == rule


# Limits and snapshots


def _event(**changes: object) -> RemoteEvent:
    base = RemoteEvent("e", "v1", "Title", "", "", False, "UTC", START, START + timedelta(hours=1))
    return replace(base, **changes)  # type: ignore[arg-type]


def test_normalized_events_fit_orbits_limits() -> None:
    event = normalized(
        _event(
            title="  ",
            description="x" * 6000,
            location="\x00Room\x07",
            start=datetime(2030, 1, 14, 9, 0, 59),
            end=datetime(2030, 1, 14, 8, 0),
        )
    )
    assert event.title == UNTITLED
    assert len(event.description) == 5000
    assert event.location == "Room"
    assert event.end == event.start == datetime(2030, 1, 14, 9, 0)
    with pytest.raises(ValueError):
        normalized(_event(end=START + timedelta(days=400)))


def test_all_day_events_without_length_last_a_day() -> None:
    event = normalized(_event(all_day=True, start=datetime(2030, 1, 14), end=datetime(2030, 1, 14)))
    assert event.end == datetime(2030, 1, 15)


def test_snapshots_round_trip() -> None:
    event = _event(
        recurrence=EventRecurrence("daily", count=3),
        skipped=(START + timedelta(days=1),),
        parent_id="p",
        original_start=START,
        url="https://x.example",
    )
    assert from_snapshot(to_snapshot(event)) == event


# OAuth helpers


def test_pkce_challenge_matches_rfc_7636() -> None:
    # The example in RFC 7636, appendix B.
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert code_challenge(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_secrets_compare_against_digests() -> None:
    assert matches("secret", digest("secret"))
    assert not matches("secret", digest("other"))
    assert not matches("secret", None)


def test_backoff_grows_and_respects_retry_after() -> None:
    assert [backoff(n).total_seconds() for n in (1, 2, 3)] == [30, 60, 120]
    assert backoff(20) == timedelta(minutes=30)
    assert backoff(1, retry_after=300) == timedelta(minutes=5)


# Tokens


def test_secret_box_without_a_key_refuses_to_store_tokens(tmp_path: Path) -> None:
    box = IntegrationSecretBox(FernetSecretBox(None, None))
    with pytest.raises(TokenStorageUnavailableError):
        box.encrypt("token")


def test_secret_box_uses_its_own_key_file(tmp_path: Path) -> None:
    settings = Settings(
        env="test",
        storage_mode="local",
        sqlite_path=tmp_path / "orbit.sqlite3",
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )
    box = IntegrationSecretBox.from_settings(settings)
    ciphertext = box.encrypt("refresh-token")
    assert "refresh-token" not in ciphertext
    assert box.decrypt(ciphertext) == "refresh-token"
    key_file = tmp_path / "integrations-secret.key"
    assert key_file.exists() and (key_file.stat().st_mode & 0o777) == 0o600
    assert not (tmp_path / "ai-secret.key").exists()


class _PlainBox:
    def encrypt(self, plaintext: str) -> str:
        return f"enc:{plaintext}"

    def decrypt(self, ciphertext: str) -> str:
        return ciphertext.removeprefix("enc:")


@dataclass
class _Store:
    connection: Connection
    updates: int = 0
    saved: list[Connection] = field(default_factory=list[Connection])

    async def connection_by_id(self, connection_id: uuid.UUID) -> Connection | None:
        return self.connection

    async def update_tokens(
        self,
        connection_id: uuid.UUID,
        expected_version: int,
        access_ciphertext: str,
        refresh_ciphertext: str | None,
        expires_at: datetime | None,
        now: datetime,
    ) -> bool:
        if expected_version != self.connection.token_version:
            return False
        self.updates += 1
        self.connection = replace(
            self.connection,
            access_token_ciphertext=access_ciphertext,
            refresh_token_ciphertext=refresh_ciphertext,
            token_expires_at=expires_at,
            token_version=expected_version + 1,
        )
        return True

    async def save_connection(self, connection: Connection) -> None:
        self.connection = connection
        self.saved.append(connection)


class _Noop:
    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None

    async def notify(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, title: str, body: str
    ) -> None:
        return None


def _connection(fake: FakeProvider, expires_at: datetime) -> Connection:
    tokens: TokenSet = fake._issue(fake_account())  # pyright: ignore[reportPrivateUsage]
    now = datetime.now(UTC)
    return Connection(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        provider="google",
        account_id="a",
        account_email="a@example.com",
        display_name="A",
        scopes=(),
        capabilities=("calendar",),
        status="active",
        access_token_ciphertext=f"enc:{tokens.access_token}",
        refresh_token_ciphertext=f"enc:{tokens.refresh_token}",
        token_expires_at=expires_at,
        token_version=1,
        mail_days=30,
        last_synced_at=None,
        last_error=None,
        created_at=now,
        updated_at=now,
    )


def fake_account() -> AccountInfo:
    return AccountInfo("a", "a@example.com", "A")


@pytest.mark.anyio
async def test_concurrent_callers_refresh_an_expired_token_once() -> None:
    fake = FakeProvider("google")
    store = _Store(_connection(fake, datetime.now(UTC) - timedelta(minutes=1)))
    noop = _Noop()
    manager = TokenManager(
        cast(IntegrationStore, store),
        _PlainBox(),
        cast(ConnectorRegistry, FakeRegistry(fake)),
        noop,
        noop,
    )
    stale = store.connection
    tokens = await asyncio.gather(*(manager.access_token(stale) for _ in range(5)))
    assert fake.refreshes == 1 and store.updates == 1
    assert len(set(tokens)) == 1 and tokens[0] in fake.access


@pytest.mark.anyio
async def test_a_refused_refresh_marks_the_connection_for_reconnecting() -> None:
    fake = FakeProvider("google")
    store = _Store(_connection(fake, datetime.now(UTC) - timedelta(minutes=1)))
    fake.revoke_all()
    noop = _Noop()
    manager = TokenManager(
        cast(IntegrationStore, store),
        _PlainBox(),
        cast(ConnectorRegistry, FakeRegistry(fake)),
        noop,
        noop,
    )
    with pytest.raises(ReauthRequiredError):
        await manager.access_token(store.connection)
    assert store.connection.status == "reauth_required"


# Configuration


def _settings(tmp_path: Path, **values: object) -> Settings:
    return Settings(
        env="production",
        storage_mode="local",
        sqlite_path=tmp_path / "orbit.sqlite3",
        cors_origins=["https://orbit.example"],
        _env_file=None,  # pyright: ignore[reportCallIssue]
        **values,  # type: ignore[arg-type]
    )


def test_production_needs_an_https_redirect_except_on_loopback(tmp_path: Path) -> None:
    assert _settings(tmp_path).integrations_redirect_url.host == "localhost"
    with pytest.raises(ValidationError):
        _settings(tmp_path, integrations_redirect_url="http://orbit.example/integrations/callback")
    _settings(tmp_path, integrations_redirect_url="https://orbit.example/integrations/callback")


def test_webhooks_need_https_and_keys_must_be_fernet(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        _settings(tmp_path, integrations_webhook_url="http://orbit.example/hooks")
    with pytest.raises(ValidationError):
        _settings(tmp_path, integrations_secret_key="not-a-key")
