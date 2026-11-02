"""The connector contract: what every provider adapter implements.

A provider (`ProviderConnector`) bundles an OAuth client and the capability connectors it
supports (calendar, mail, files). Adapters translate the provider's API into the normalized types
below, so the synchronization engine and services never see a vendor's JSON. Adding a provider
means writing one adapter and registering it; nothing else changes.

Adapters receive a decrypted access token per call and must never log it or put it in an error.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal, Protocol

from orbit_api.services.calendar.recurrence import EventRecurrence
from orbit_api.services.integrations.models import Capability, ProviderId

# Errors


class ProviderError(Exception):
    """A provider call failed. `message` is safe to show and store."""

    message: str = "The provider couldn't be reached."

    def __init__(self, message: str | None = None) -> None:
        if message is not None:
            self.message = message
        super().__init__(self.message)


class ReauthRequiredError(ProviderError):
    """The provider refused the tokens: expired or revoked consent, or a changed password."""

    message = "The account needs to be reconnected."


class AccessDeniedError(ProviderError):
    """The token is valid but lacks permission for this call (a missing scope)."""

    message = "The account didn't grant permission for this."


class RateLimitedError(ProviderError):
    message = "The provider is rate limiting requests. Orbit will retry."

    def __init__(self, retry_after: float | None = None) -> None:
        super().__init__()
        self.retry_after = retry_after


class ProviderUnavailableError(ProviderError):
    message = "The provider is unavailable right now. Orbit will retry."


class RemoteNotFoundError(ProviderError):
    message = "It no longer exists or Orbit can't access it."


class CursorExpiredError(ProviderError):
    """The sync token or delta link is no longer valid; a full synchronization is needed."""

    message = "The provider asked for a full synchronization."


class VersionConflictError(ProviderError):
    """The record changed at the provider since Orbit last saw it (HTTP 412)."""

    message = "The record changed at the provider."


class ProviderResponseError(ProviderError):
    message = "The provider sent a response Orbit couldn't read."


class FileTooLargeError(ProviderError):
    message = "The file is larger than Documents accepts."


# OAuth


@dataclass(frozen=True, slots=True)
class TokenSet:
    access_token: str
    # Absent when the provider keeps the previous one (Google refreshes).
    refresh_token: str | None
    expires_at: datetime | None
    scopes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AccountInfo:
    account_id: str
    email: str
    display_name: str


class OAuthClient(Protocol):
    def authorization_url(
        self,
        *,
        state: str,
        code_challenge: str,
        scopes: Sequence[str],
        redirect_uri: str,
        login_hint: str | None,
    ) -> str: ...

    async def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> TokenSet: ...

    async def refresh(self, refresh_token: str) -> TokenSet: ...

    async def revoke(self, token: str) -> bool:
        """Revoke Orbit's access at the provider. `False` when the provider has no revocation
        endpoint for third-party apps (the person removes access in their account)."""
        ...

    async def account(self, access_token: str) -> AccountInfo: ...


# Calendar


@dataclass(frozen=True, slots=True)
class RemoteCalendar:
    external_id: str
    name: str
    writable: bool
    timezone: str | None
    primary: bool = False


@dataclass(frozen=True, slots=True)
class RemoteEvent:
    """An external event, normalized. Times are naive local wall-clock times in `timezone`, like
    Orbit's; all-day events run from midnight on the first day to midnight after the last."""

    external_id: str
    version: str
    title: str
    description: str
    location: str
    all_day: bool
    timezone: str
    start: datetime
    end: datetime
    # A series whose rule Orbit can represent.
    recurrence: EventRecurrence | None = None
    # Occurrences skipped by the rule itself (RFC 5545 EXDATE), as original local starts.
    skipped: tuple[datetime, ...] = ()
    # The series this is an occurrence of.
    parent_id: str | None = None
    # For a changed or cancelled occurrence of a series: its original local start.
    original_start: datetime | None = None
    # An occurrence expanded by the provider from a rule Orbit can't represent: imported as a
    # standalone event rather than as an exception.
    expanded: bool = False
    cancelled: bool = False
    url: str | None = None


@dataclass(frozen=True, slots=True)
class RemoteDeletion:
    external_id: str


type RemoteChange = RemoteEvent | RemoteDeletion


@dataclass(frozen=True, slots=True)
class SyncPosition:
    # The provider's sync token or delta link from the last completed synchronization.
    cursor: str | None
    # The page to continue from within a synchronization in progress.
    page: str | None
    # Windowed providers: where the window starts (it ends a year later).
    window_start: datetime | None


@dataclass(frozen=True, slots=True)
class ChangePage:
    changes: list[RemoteChange]
    # Continue with this page; `None` on the last page.
    next_page: str | None
    # On the last page: the cursor for the next incremental synchronization.
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class OutgoingEvent:
    """An Orbit event sent to the provider. Times are local in `timezone`."""

    title: str
    description: str
    location: str
    all_day: bool
    timezone: str
    start: datetime
    end: datetime


@dataclass(frozen=True, slots=True)
class WatchChannel:
    channel_id: str
    resource_id: str | None
    expires_at: datetime


class CalendarConnector(Protocol):
    # Windowed providers synchronize a moving window instead of every event.
    windowed: bool

    async def calendars(self, token: str) -> list[RemoteCalendar]: ...

    async def changes(
        self, token: str, calendar: RemoteCalendar, position: SyncPosition
    ) -> ChangePage: ...

    async def create_event(
        self, token: str, calendar_id: str, event: OutgoingEvent
    ) -> RemoteEvent: ...

    async def update_event(
        self,
        token: str,
        calendar_id: str,
        external_id: str,
        event: OutgoingEvent,
        version: str | None,
    ) -> RemoteEvent:
        """Update, refusing with `VersionConflictError` if `version` is given and stale."""
        ...

    async def watch(
        self, token: str, calendar_id: str, address: str, channel_id: str, secret: str
    ) -> WatchChannel: ...

    async def unwatch(self, token: str, channel_id: str, resource_id: str | None) -> None: ...


# Mail


@dataclass(frozen=True, slots=True)
class RemoteLabel:
    external_id: str
    name: str
    # Provider-defined (Inbox, Sent) rather than created by the person.
    system: bool


@dataclass(frozen=True, slots=True)
class MailQuery:
    label_id: str
    # Received on or after this date.
    since: date
    search: str | None = None
    page: str | None = None
    limit: int = 20


@dataclass(frozen=True, slots=True)
class MessageSummary:
    external_id: str
    thread_id: str | None
    subject: str
    sender: str
    received_at: datetime
    snippet: str
    label_ids: tuple[str, ...] = ()
    url: str | None = None


@dataclass(frozen=True, slots=True)
class MessagePage:
    messages: list[MessageSummary]
    next_page: str | None


@dataclass(frozen=True, slots=True)
class MessageDetail:
    summary: MessageSummary
    recipients: tuple[str, ...]
    # Plain text only: HTML is reduced to text, never rendered.
    body: str


class MailConnector(Protocol):
    async def labels(self, token: str) -> list[RemoteLabel]: ...

    async def messages(self, token: str, query: MailQuery) -> MessagePage: ...

    async def message(self, token: str, external_id: str) -> MessageDetail: ...


# Files


@dataclass(frozen=True, slots=True)
class RemoteFile:
    external_id: str
    name: str
    folder: bool
    mime_type: str
    size: int | None
    modified_at: datetime | None
    # Changes when the content changes (checksum, cTag, or revision).
    version: str
    parent_id: str | None = None
    url: str | None = None
    # A provider-native document exported for import (Google Docs as PDF).
    export_name: str | None = None


@dataclass(frozen=True, slots=True)
class FilePage:
    files: list[RemoteFile]
    next_page: str | None


class FilesConnector(Protocol):
    async def list(
        self, token: str, folder_id: str | None, search: str | None, page: str | None
    ) -> FilePage: ...

    async def metadata(self, token: str, file_id: str) -> RemoteFile:
        """Raises `RemoteNotFoundError` when deleted or inaccessible."""
        ...

    async def download(self, token: str, file: RemoteFile, max_bytes: int) -> bytes: ...


# Providers


@dataclass(frozen=True, slots=True)
class ProviderConnector:
    provider: ProviderId
    name: str
    oauth: OAuthClient
    # The narrowest scopes for each capability, and the ones every connection needs (identity).
    scopes: dict[Capability, tuple[str, ...]]
    base_scopes: tuple[str, ...] = ()
    calendar: CalendarConnector | None = None
    mail: MailConnector | None = None
    files: FilesConnector | None = None
    extra: dict[str, str] = field(default_factory=dict[str, str])

    @property
    def capabilities(self) -> tuple[Capability, ...]:
        return tuple(self.scopes)

    def scopes_for(self, capabilities: Sequence[Capability]) -> list[str]:
        scopes = list(self.base_scopes)
        for capability in capabilities:
            scopes.extend(self.scopes.get(capability, ()))
        return list(dict.fromkeys(scopes))

    def granted(self, scopes: Sequence[str]) -> tuple[Capability, ...]:
        """The capabilities whose scopes were all granted."""
        held = set(scopes)
        return tuple(c for c, needed in self.scopes.items() if set(needed) <= held)


class ConnectorRegistry(Protocol):
    def get(self, provider: ProviderId) -> ProviderConnector | None:
        """The provider's connector, or `None` when it isn't configured on this server."""
        ...

    def known(self) -> list[ProviderId]: ...


SyncKind = Literal["calendar", "files"]
