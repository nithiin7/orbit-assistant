"""A deterministic, in-memory provider for integration tests: OAuth with PKCE checks, a calendar
with a change log, sync tokens, pages, and versions, mail, and files. No network, no real
accounts."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlencode, urlsplit

from orbit_api.services.integrations.connectors import (
    AccountInfo,
    ChangePage,
    CursorExpiredError,
    FilePage,
    MailQuery,
    MessageDetail,
    MessagePage,
    OutgoingEvent,
    ProviderConnector,
    RateLimitedError,
    ReauthRequiredError,
    RemoteCalendar,
    RemoteChange,
    RemoteDeletion,
    RemoteEvent,
    RemoteFile,
    RemoteLabel,
    RemoteNotFoundError,
    SyncPosition,
    TokenSet,
    VersionConflictError,
    WatchChannel,
)
from orbit_api.services.integrations.models import Capability, ProviderId
from orbit_api.services.integrations.oauth import code_challenge

SCOPES: dict[Capability, tuple[str, ...]] = {
    "calendar": ("cal.read",),
    "calendar_write": ("cal.write",),
    "mail": ("mail.read",),
    "files": ("files.read",),
}


@dataclass
class Grant:
    account: AccountInfo
    scopes: tuple[str, ...]
    challenge: str


@dataclass
class FakeProvider:
    """One fake provider's state, shared by its OAuth, calendar, mail, and files adapters."""

    provider: ProviderId
    windowed: bool = False
    # OAuth
    challenges: dict[str, str] = field(default_factory=dict[str, str])
    codes: dict[str, Grant] = field(default_factory=dict[str, Grant])
    access: dict[str, AccountInfo] = field(default_factory=dict[str, AccountInfo])
    refresh_tokens: dict[str, AccountInfo] = field(default_factory=dict[str, AccountInfo])
    revoked: list[str] = field(default_factory=list[str])
    refreshes: int = 0
    token_lifetime: timedelta = timedelta(hours=1)
    counter: int = 0
    # Calendar
    calendars: list[RemoteCalendar] = field(default_factory=list[RemoteCalendar])
    events: dict[str, dict[str, RemoteEvent]] = field(
        default_factory=dict[str, dict[str, RemoteEvent]]
    )
    log: list[tuple[int, str, str]] = field(default_factory=list[tuple[int, str, str]])
    seq: int = 0
    page_size: int = 50
    expire_next_cursor: bool = False
    rate_limits: int = 0
    pushes: list[tuple[str, OutgoingEvent, str | None]] = field(
        default_factory=list[tuple[str, OutgoingEvent, str | None]]
    )
    watches: list[str] = field(default_factory=list[str])
    change_calls: int = 0
    # Mail
    labels: list[RemoteLabel] = field(default_factory=list[RemoteLabel])
    messages: dict[str, MessageDetail] = field(default_factory=dict[str, MessageDetail])
    # Files
    files: dict[str, tuple[RemoteFile, bytes]] = field(
        default_factory=dict[str, tuple[RemoteFile, bytes]]
    )

    # Test controls

    def issue_code(
        self, authorization_url: str, account: AccountInfo, scopes: Sequence[str]
    ) -> tuple[str, str]:
        """What the provider's consent page does: returns `(state, code)` for the redirect."""
        query = parse_qs(urlsplit(authorization_url).query)
        state = query["state"][0]
        code = f"code-{uuid.uuid4().hex[:8]}"
        self.codes[code] = Grant(account, tuple(scopes), query["code_challenge"][0])
        return state, code

    def put(self, calendar_id: str, event: RemoteEvent) -> RemoteEvent:
        self.seq += 1
        stored = replace(event, version=f"v{self.seq}")
        self.events.setdefault(calendar_id, {})[event.external_id] = stored
        self.log.append((self.seq, calendar_id, event.external_id))
        return stored

    def remove(self, calendar_id: str, external_id: str) -> None:
        self.seq += 1
        self.events.get(calendar_id, {}).pop(external_id, None)
        self.log.append((self.seq, calendar_id, external_id))

    def expire_tokens(self) -> None:
        self.access.clear()

    def revoke_all(self) -> None:
        self.access.clear()
        self.refresh_tokens.clear()

    def connector(self) -> ProviderConnector:
        return ProviderConnector(
            provider=self.provider,
            name=self.provider.title(),
            oauth=FakeOAuth(self),
            scopes=dict(SCOPES),
            base_scopes=("openid",),
            calendar=FakeCalendar(self),
            mail=FakeMail(self),
            files=FakeFiles(self),
        )

    def _issue(self, account: AccountInfo) -> TokenSet:
        self.counter += 1
        access = f"access-{self.provider}-{self.counter}"
        refresh = f"refresh-{self.provider}-{self.counter}"
        self.access[access] = account
        self.refresh_tokens[refresh] = account
        return TokenSet(access, refresh, datetime.now(UTC) + self.token_lifetime, ())

    def check(self, token: str) -> AccountInfo:
        account = self.access.get(token)
        if account is None:
            raise ReauthRequiredError
        return account


class FakeOAuth:
    def __init__(self, state: FakeProvider) -> None:
        self._s = state

    def authorization_url(
        self,
        *,
        state: str,
        code_challenge: str,
        scopes: Sequence[str],
        redirect_uri: str,
        login_hint: str | None,
    ) -> str:
        params = {
            "state": state,
            "code_challenge": code_challenge,
            "scope": " ".join(scopes),
            "redirect_uri": redirect_uri,
        }
        return f"https://{self._s.provider}.example/authorize?{urlencode(params)}"

    async def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> TokenSet:
        grant = self._s.codes.pop(code, None)
        if grant is None or code_challenge(code_verifier) != grant.challenge:
            raise ReauthRequiredError("The code was invalid.")
        tokens = self._s._issue(grant.account)  # pyright: ignore[reportPrivateUsage]
        return replace(tokens, scopes=grant.scopes)

    async def refresh(self, refresh_token: str) -> TokenSet:
        self._s.refreshes += 1
        account = self._s.refresh_tokens.get(refresh_token)
        if account is None:
            raise ReauthRequiredError
        tokens = self._s._issue(account)  # pyright: ignore[reportPrivateUsage]
        # Google-like: the refresh token stays the same.
        self._s.refresh_tokens.pop(tokens.refresh_token or "", None)
        return replace(tokens, refresh_token=None)

    async def revoke(self, token: str) -> bool:
        self._s.revoked.append(token)
        return self._s.provider == "google"

    async def account(self, access_token: str) -> AccountInfo:
        return self._s.check(access_token)


class FakeCalendar:
    def __init__(self, state: FakeProvider) -> None:
        self._s = state
        self.windowed = state.windowed

    async def calendars(self, token: str) -> list[RemoteCalendar]:
        self._s.check(token)
        return list(self._s.calendars)

    async def changes(
        self, token: str, calendar: RemoteCalendar, position: SyncPosition
    ) -> ChangePage:
        self._s.check(token)
        self._s.change_calls += 1
        if self._s.rate_limits > 0:
            self._s.rate_limits -= 1
            raise RateLimitedError(1)
        if position.page:
            kind, since, offset, upto = position.page.split(":")
            since_seq, start, snapshot = int(since), int(offset), int(upto)
            full = kind == "full"
        else:
            if position.cursor and self._s.expire_next_cursor:
                self._s.expire_next_cursor = False
                raise CursorExpiredError
            full = position.cursor is None
            since_seq = 0 if full else int(position.cursor.split(":")[1])  # pyright: ignore[reportOptionalMemberAccess]
            start, snapshot = 0, self._s.seq
        current = self._s.events.get(calendar.external_id, {})
        changes: list[RemoteChange]
        if full:
            changes = [current[k] for k in sorted(current)]
        else:
            touched = sorted(
                {
                    eid
                    for seq, cal, eid in self._s.log
                    if cal == calendar.external_id and since_seq < seq <= snapshot
                }
            )
            changes = [current[e] if e in current else RemoteDeletion(e) for e in touched]
        chunk = changes[start : start + self._s.page_size]
        more = start + self._s.page_size < len(changes)
        kind = "full" if full else "inc"
        return ChangePage(
            changes=chunk,
            next_page=f"{kind}:{since_seq}:{start + self._s.page_size}:{snapshot}"
            if more
            else None,
            next_cursor=None if more else f"seq:{snapshot}",
        )

    async def create_event(self, token: str, calendar_id: str, event: OutgoingEvent) -> RemoteEvent:
        self._s.check(token)
        self._s.pushes.append(("create", event, None))
        return self._s.put(calendar_id, _remote(f"created-{uuid.uuid4().hex[:6]}", event))

    async def update_event(
        self,
        token: str,
        calendar_id: str,
        external_id: str,
        event: OutgoingEvent,
        version: str | None,
    ) -> RemoteEvent:
        self._s.check(token)
        current = self._s.events.get(calendar_id, {}).get(external_id)
        if current is None:
            raise RemoteNotFoundError
        if version is not None and version != current.version:
            raise VersionConflictError
        self._s.pushes.append((external_id, event, version))
        return self._s.put(calendar_id, _remote(external_id, event))

    async def watch(
        self, token: str, calendar_id: str, address: str, channel_id: str, secret: str
    ) -> WatchChannel:
        self._s.check(token)
        self._s.watches.append(secret)
        return WatchChannel(channel_id, "resource-1", datetime.now(UTC) + timedelta(days=7))

    async def unwatch(self, token: str, channel_id: str, resource_id: str | None) -> None:
        return None


def _remote(external_id: str, event: OutgoingEvent) -> RemoteEvent:
    return RemoteEvent(
        external_id=external_id,
        version="",
        title=event.title,
        description=event.description,
        location=event.location,
        all_day=event.all_day,
        timezone=event.timezone,
        start=event.start,
        end=event.end,
    )


class FakeMail:
    def __init__(self, state: FakeProvider) -> None:
        self._s = state

    async def labels(self, token: str) -> list[RemoteLabel]:
        self._s.check(token)
        return list(self._s.labels)

    async def messages(self, token: str, query: MailQuery) -> MessagePage:
        self._s.check(token)
        found = [
            m.summary
            for m in self._s.messages.values()
            if query.label_id in m.summary.label_ids
            and (not query.search or query.search.lower() in m.summary.subject.lower())
        ]
        return MessagePage(sorted(found, key=lambda m: m.received_at, reverse=True), None)

    async def message(self, token: str, external_id: str) -> MessageDetail:
        self._s.check(token)
        if external_id not in self._s.messages:
            raise RemoteNotFoundError
        return self._s.messages[external_id]


class FakeFiles:
    def __init__(self, state: FakeProvider) -> None:
        self._s = state

    async def list(
        self, token: str, folder_id: str | None, search: str | None, page: str | None
    ) -> FilePage:
        self._s.check(token)
        files = [
            f
            for f, _ in self._s.files.values()
            if (search and search.lower() in f.name.lower())
            or (not search and f.parent_id == (folder_id or "root"))
        ]
        return FilePage(sorted(files, key=lambda f: f.name), None)

    async def metadata(self, token: str, file_id: str) -> RemoteFile:
        self._s.check(token)
        if file_id not in self._s.files:
            raise RemoteNotFoundError
        return self._s.files[file_id][0]

    async def download(self, token: str, file: RemoteFile, max_bytes: int) -> bytes:
        self._s.check(token)
        if file.external_id not in self._s.files:
            raise RemoteNotFoundError
        return self._s.files[file.external_id][1]


class FakeRegistry:
    def __init__(self, *providers: FakeProvider) -> None:
        self.providers = {p.provider: p for p in providers}

    def get(self, provider: ProviderId) -> ProviderConnector | None:
        fake = self.providers.get(provider)
        return fake.connector() if fake else None

    def known(self) -> list[ProviderId]:
        return ["google", "microsoft"]

    async def aclose(self) -> None:
        return None
