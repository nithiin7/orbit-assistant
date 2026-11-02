"""Google: OAuth 2.0 (Authorization Code with PKCE), Calendar API v3, Gmail API v1 (read only),
and Drive API v3 (read only).

Calendar synchronization follows Google's documented pattern: a full list with `showDeleted`,
then `syncToken` increments; a 410 means start over. Series are listed as masters
(`singleEvents=false`): a rule Orbit can represent becomes an Orbit series and its changed or
cancelled instances become exceptions; any other rule is expanded with `instances` over a
bounded window and imported as standalone events.
"""

import asyncio
import base64
import re
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Final
from urllib.parse import quote, urlencode

from orbit_api.providers.integrations.http import (
    ApiClient,
    Json,
    integer,
    items,
    obj,
    parse_instant,
    text,
)
from orbit_api.providers.integrations.text import html_to_text, tidy
from orbit_api.services.integrations.connectors import (
    AccountInfo,
    ChangePage,
    FilePage,
    FileTooLargeError,
    MailQuery,
    MessageDetail,
    MessagePage,
    MessageSummary,
    OutgoingEvent,
    ProviderError,
    ProviderResponseError,
    RemoteCalendar,
    RemoteChange,
    RemoteDeletion,
    RemoteEvent,
    RemoteFile,
    RemoteLabel,
    RemoteNotFoundError,
    SyncPosition,
    TokenSet,
    WatchChannel,
)
from orbit_api.services.integrations.mapping import local_from_instant, parse_rrule, valid_timezone
from orbit_api.services.integrations.models import Capability

AUTHORIZE_URL: Final = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL: Final = "https://oauth2.googleapis.com/token"
REVOKE_URL: Final = "https://oauth2.googleapis.com/revoke"
USERINFO_URL: Final = "https://openidconnect.googleapis.com/v1/userinfo"
CALENDAR_API: Final = "https://www.googleapis.com/calendar/v3"
GMAIL_API: Final = "https://gmail.googleapis.com/gmail/v1/users/me"
DRIVE_API: Final = "https://www.googleapis.com/drive/v3"

_SCOPE: Final = "https://www.googleapis.com/auth/"
BASE_SCOPES: Final = ("openid", "email")
SCOPES: Final[dict[Capability, tuple[str, ...]]] = {
    # Listing calendars, and reading their events.
    "calendar": (_SCOPE + "calendar.calendarlist.readonly", _SCOPE + "calendar.events.readonly"),
    # Changing and creating events (not calendars, settings, or sharing).
    "calendar_write": (_SCOPE + "calendar.events",),
    # Reading messages and labels; never sending, deleting, or changing them.
    "mail": (_SCOPE + "gmail.readonly",),
    # Reading files, to browse and import them; never changing them.
    "files": (_SCOPE + "drive.readonly",),
}

# Instances of a rule Orbit can't represent are imported over this window.
EXPAND_PAST: Final = timedelta(days=30)
EXPAND_AHEAD: Final = timedelta(days=365)
MAX_INSTANCE_PAGES: Final = 4
PAGE_SIZE: Final = 250
# Gmail lists IDs only; metadata is fetched for each message, a few at a time.
METADATA_CONCURRENCY: Final = 5
_HIDDEN_LABELS: Final = frozenset({"CHAT", "DRAFT", "SPAM", "TRASH", "UNREAD"})
_DRIVE_ID: Final = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
_DRIVE_FIELDS: Final = (
    "id,name,mimeType,size,modifiedTime,md5Checksum,version,parents,webViewLink,trashed"
)
_GOOGLE_EXPORTS: Final = {
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.google-apps.presentation",
    "application/vnd.google-apps.drawing",
}
_FOLDER: Final = "application/vnd.google-apps.folder"


class GoogleOAuth:
    def __init__(self, http: ApiClient, client_id: str, client_secret: str | None) -> None:
        self._http = http
        self._client_id = client_id
        self._client_secret = client_secret

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
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(scopes),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            # A refresh token, and consent shown again so one is issued on reconnecting.
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
        }
        if login_hint:
            params["login_hint"] = login_hint
        return f"{AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> TokenSet:
        return await self._token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": redirect_uri,
            }
        )

    async def refresh(self, refresh_token: str) -> TokenSet:
        return await self._token({"grant_type": "refresh_token", "refresh_token": refresh_token})

    async def revoke(self, token: str) -> bool:
        await self._http.send("POST", REVOKE_URL, form={"token": token})
        return True

    async def account(self, access_token: str) -> AccountInfo:
        data = await self._http.json("GET", USERINFO_URL, token=access_token)
        subject = text(data.get("sub"))
        if not subject:
            raise ProviderResponseError()
        email = text(data.get("email"))
        return AccountInfo(subject, email, text(data.get("name")) or email)

    async def _token(self, form: dict[str, str]) -> TokenSet:
        form = {**form, "client_id": self._client_id}
        if self._client_secret:
            form["client_secret"] = self._client_secret
        data = await self._http.json("POST", TOKEN_URL, form=form)
        return token_set(data)


def token_set(data: Json, now: datetime | None = None) -> TokenSet:
    access = text(data.get("access_token"))
    if not access:
        raise ProviderResponseError()
    expires_in = integer(data.get("expires_in"))
    moment = now or datetime.now(UTC)
    return TokenSet(
        access_token=access,
        refresh_token=text(data.get("refresh_token")) or None,
        expires_at=moment + timedelta(seconds=expires_in) if expires_in else None,
        scopes=tuple(text(data.get("scope")).split()),
    )


# Calendar


class GoogleCalendar:
    windowed = False

    def __init__(
        self, http: ApiClient, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._http = http
        self._clock = clock

    async def calendars(self, token: str) -> list[RemoteCalendar]:
        calendars: list[RemoteCalendar] = []
        page: str | None = None
        while True:
            params = {"minAccessRole": "reader", "maxResults": "250"}
            if page:
                params["pageToken"] = page
            data = await self._http.json(
                "GET", f"{CALENDAR_API}/users/me/calendarList", token=token, params=params
            )
            for item in items(data.get("items")):
                entry = obj(item)
                calendar_id = text(entry.get("id"))
                if not calendar_id:
                    continue
                calendars.append(
                    RemoteCalendar(
                        external_id=calendar_id,
                        name=text(entry.get("summaryOverride")) or text(entry.get("summary")),
                        writable=text(entry.get("accessRole")) in ("owner", "writer"),
                        timezone=valid_timezone(text(entry.get("timeZone"))),
                        primary=entry.get("primary") is True,
                    )
                )
            page = text(data.get("nextPageToken")) or None
            if page is None:
                return calendars

    async def changes(
        self, token: str, calendar: RemoteCalendar, position: SyncPosition
    ) -> ChangePage:
        params = {"maxResults": str(PAGE_SIZE), "showDeleted": "true", "singleEvents": "false"}
        if position.page:
            params["pageToken"] = position.page
        elif position.cursor:
            params["syncToken"] = position.cursor
        data = await self._http.json(
            "GET",
            f"{_calendar_url(calendar.external_id)}/events",
            token=token,
            params=params,
            expect_gone=True,
        )
        zone = valid_timezone(text(data.get("timeZone"))) or calendar.timezone or "UTC"
        changes: list[RemoteChange] = []
        for item in items(data.get("items")):
            entry = obj(item)
            lines = [text(line) for line in items(entry.get("recurrence"))]
            if lines and text(entry.get("status")) != "cancelled":
                mapped = event_from_google(entry, zone)
                if mapped is not None and mapped.recurrence is None:
                    # A rule Orbit can't represent: its occurrences, one by one.
                    changes += await self._instances(token, calendar.external_id, entry, zone)
                    continue
            change = change_from_google(entry, zone)
            if change is not None:
                changes.append(change)
        next_page = text(data.get("nextPageToken")) or None
        return ChangePage(
            changes=changes,
            next_page=next_page,
            next_cursor=None if next_page else text(data.get("nextSyncToken")) or None,
        )

    async def _instances(
        self, token: str, calendar_id: str, master: Json, zone: str
    ) -> list[RemoteChange]:
        now = self._clock()
        params = {
            "timeMin": (now - EXPAND_PAST).isoformat(),
            "timeMax": (now + EXPAND_AHEAD).isoformat(),
            "showDeleted": "true",
            "maxResults": str(PAGE_SIZE),
        }
        event_id = quote(text(master.get("id")), safe="")
        changes: list[RemoteChange] = []
        for _ in range(MAX_INSTANCE_PAGES):
            data = await self._http.json(
                "GET",
                f"{_calendar_url(calendar_id)}/events/{event_id}/instances",
                token=token,
                params=params,
            )
            for item in items(data.get("items")):
                entry = obj(item)
                if text(entry.get("status")) == "cancelled":
                    changes.append(RemoteDeletion(text(entry.get("id"))))
                    continue
                mapped = event_from_google(entry, zone)
                if mapped is not None:
                    changes.append(_expanded(mapped))
            page = text(data.get("nextPageToken"))
            if not page:
                break
            params["pageToken"] = page
        return changes

    async def create_event(self, token: str, calendar_id: str, event: OutgoingEvent) -> RemoteEvent:
        data = await self._http.json(
            "POST",
            f"{_calendar_url(calendar_id)}/events",
            token=token,
            json_body=event_to_google(event),
        )
        return self._returned(data, event.timezone)

    async def update_event(
        self,
        token: str,
        calendar_id: str,
        external_id: str,
        event: OutgoingEvent,
        version: str | None,
    ) -> RemoteEvent:
        headers = {"If-Match": version} if version else {}
        data = await self._http.json(
            "PATCH",
            f"{_calendar_url(calendar_id)}/events/{quote(external_id, safe='')}",
            token=token,
            json_body=event_to_google(event),
            headers=headers,
        )
        return self._returned(data, event.timezone)

    async def watch(
        self, token: str, calendar_id: str, address: str, channel_id: str, secret: str
    ) -> WatchChannel:
        data = await self._http.json(
            "POST",
            f"{_calendar_url(calendar_id)}/events/watch",
            token=token,
            json_body={
                "id": channel_id,
                "type": "web_hook",
                "address": address,
                "token": secret,
                "params": {"ttl": str(7 * 24 * 3600)},
            },
        )
        expiration = integer(data.get("expiration"))
        expires = (
            datetime.fromtimestamp(expiration / 1000, UTC)
            if expiration
            else self._clock() + timedelta(days=7)
        )
        return WatchChannel(channel_id, text(data.get("resourceId")) or None, expires)

    async def unwatch(self, token: str, channel_id: str, resource_id: str | None) -> None:
        await self._http.send(
            "POST",
            f"{CALENDAR_API}/channels/stop",
            token=token,
            json_body={"id": channel_id, "resourceId": resource_id or ""},
        )

    @staticmethod
    def _returned(data: Json, zone: str) -> RemoteEvent:
        event = event_from_google(data, zone)
        if event is None:
            raise ProviderResponseError()
        return event


def _calendar_url(calendar_id: str) -> str:
    return f"{CALENDAR_API}/calendars/{quote(calendar_id, safe='')}"


def _expanded(event: RemoteEvent) -> RemoteEvent:
    return RemoteEvent(
        external_id=event.external_id,
        version=event.version,
        title=event.title,
        description=event.description,
        location=event.location,
        all_day=event.all_day,
        timezone=event.timezone,
        start=event.start,
        end=event.end,
        parent_id=event.parent_id,
        original_start=event.original_start,
        expanded=True,
        url=event.url,
    )


def _when(value: Json, zone: str) -> tuple[datetime, bool] | None:
    """A Google `start`/`end`/`originalStartTime` as a naive local time in `zone`."""
    day = text(value.get("date"))
    if day:
        try:
            return datetime.combine(date.fromisoformat(day), time()), True
        except ValueError:
            return None
    instant = parse_instant(value.get("dateTime"), zone)
    if instant is None:
        return None
    return local_from_instant(instant, zone), False


def change_from_google(entry: Json, calendar_zone: str) -> RemoteChange | None:
    event_id = text(entry.get("id"))
    if not event_id:
        return None
    if text(entry.get("status")) == "cancelled":
        parent = text(entry.get("recurringEventId"))
        if not parent:
            return RemoteDeletion(event_id)
        zone = valid_timezone(text(obj(entry.get("originalStartTime")).get("timeZone"))) or (
            calendar_zone
        )
        original = _when(obj(entry.get("originalStartTime")), zone)
        if original is None:
            return RemoteDeletion(event_id)
        return RemoteEvent(
            external_id=event_id,
            version=text(entry.get("etag")) or event_id,
            title="",
            description="",
            location="",
            all_day=original[1],
            timezone=zone,
            start=original[0],
            end=original[0],
            parent_id=parent,
            original_start=original[0],
            cancelled=True,
        )
    return event_from_google(entry, calendar_zone)


def event_from_google(entry: Json, calendar_zone: str) -> RemoteEvent | None:
    event_id = text(entry.get("id"))
    start_value = obj(entry.get("start"))
    zone = valid_timezone(text(start_value.get("timeZone"))) or calendar_zone
    start = _when(start_value, zone)
    end = _when(obj(entry.get("end")), zone)
    if not event_id or start is None or end is None:
        return None
    all_day = start[1]
    lines = [text(line) for line in items(entry.get("recurrence"))]
    rule = parse_rrule(lines, start[0], zone) if lines else None
    original = _when(obj(entry.get("originalStartTime")), zone)
    description = text(entry.get("description"))
    if "<" in description:
        # Google stores descriptions as limited HTML.
        description = html_to_text(description)
    return RemoteEvent(
        external_id=event_id,
        version=text(entry.get("etag")) or text(entry.get("updated")) or event_id,
        title=text(entry.get("summary")),
        description=description,
        location=text(entry.get("location")),
        all_day=all_day,
        timezone=zone,
        start=start[0],
        end=end[0],
        recurrence=rule[0] if rule else None,
        skipped=rule[1] if rule else (),
        parent_id=text(entry.get("recurringEventId")) or None,
        original_start=original[0] if original else None,
        url=text(entry.get("htmlLink")) or None,
    )


def event_to_google(event: OutgoingEvent) -> Json:
    if event.all_day:
        start: Json = {"date": event.start.date().isoformat()}
        end: Json = {"date": event.end.date().isoformat()}
    else:
        start = {"dateTime": event.start.isoformat(timespec="seconds"), "timeZone": event.timezone}
        end = {"dateTime": event.end.isoformat(timespec="seconds"), "timeZone": event.timezone}
    return {
        "summary": event.title,
        "description": event.description,
        "location": event.location,
        "start": start,
        "end": end,
    }


# Gmail


class GoogleMail:
    def __init__(self, http: ApiClient) -> None:
        self._http = http

    async def labels(self, token: str) -> list[RemoteLabel]:
        data = await self._http.json("GET", f"{GMAIL_API}/labels", token=token)
        labels: list[RemoteLabel] = []
        for item in items(data.get("labels")):
            entry = obj(item)
            label_id = text(entry.get("id"))
            if not label_id or label_id in _HIDDEN_LABELS or label_id.startswith("CATEGORY_"):
                continue
            system = text(entry.get("type")) == "system"
            name = text(entry.get("name"))
            labels.append(RemoteLabel(label_id, name.title() if system else name, system))
        return sorted(labels, key=lambda label: (not label.system, label.name.lower()))

    async def messages(self, token: str, query: MailQuery) -> MessagePage:
        search = f"after:{query.since:%Y/%m/%d}"
        if query.search:
            search += f" {query.search}"
        params: dict[str, str | list[str]] = {
            "labelIds": [query.label_id],
            "maxResults": str(query.limit),
            "q": search,
        }
        if query.page:
            params["pageToken"] = query.page
        data = await self._http.json("GET", f"{GMAIL_API}/messages", token=token, params=params)
        ids = [text(obj(item).get("id")) for item in items(data.get("messages"))]
        limit = asyncio.Semaphore(METADATA_CONCURRENCY)

        async def fetch(message_id: str) -> MessageSummary | None:
            async with limit:
                try:
                    entry = await self._http.json(
                        "GET",
                        f"{GMAIL_API}/messages/{quote(message_id, safe='')}",
                        token=token,
                        params={
                            "format": "metadata",
                            "metadataHeaders": ["Subject", "From", "Date"],
                        },
                    )
                except RemoteNotFoundError:
                    return None
                return summary_from_gmail(entry)

        summaries = await asyncio.gather(*(fetch(i) for i in ids if i))
        return MessagePage(
            [s for s in summaries if s is not None], text(data.get("nextPageToken")) or None
        )

    async def message(self, token: str, external_id: str) -> MessageDetail:
        entry = await self._http.json(
            "GET",
            f"{GMAIL_API}/messages/{quote(external_id, safe='')}",
            token=token,
            params={"format": "full"},
        )
        summary = summary_from_gmail(entry)
        if summary is None:
            raise ProviderResponseError()
        headers = _headers(obj(entry.get("payload")))
        recipients = tuple(
            r.strip() for key in ("to", "cc") for r in headers.get(key, "").split(",") if r.strip()
        )
        return MessageDetail(summary, recipients, body_from_gmail(obj(entry.get("payload"))))


def _headers(payload: Json) -> dict[str, str]:
    return {
        text(obj(h).get("name")).lower(): text(obj(h).get("value"))
        for h in items(payload.get("headers"))
    }


def summary_from_gmail(entry: Json) -> MessageSummary | None:
    message_id = text(entry.get("id"))
    millis = integer(entry.get("internalDate"))
    if not message_id or millis is None:
        return None
    headers = _headers(obj(entry.get("payload")))
    return MessageSummary(
        external_id=message_id,
        thread_id=text(entry.get("threadId")) or None,
        subject=headers.get("subject", ""),
        sender=headers.get("from", ""),
        received_at=datetime.fromtimestamp(millis / 1000, UTC),
        snippet=tidy(text(entry.get("snippet"))),
        label_ids=tuple(text(label) for label in items(entry.get("labelIds"))),
        url=f"https://mail.google.com/mail/#all/{message_id}",
    )


def _decode(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
    except ValueError:
        return ""


def body_from_gmail(payload: Json) -> str:
    plain: list[str] = []
    html: list[str] = []

    def walk(part: Json, depth: int) -> None:
        if depth > 10:
            return
        mime = text(part.get("mimeType")).lower()
        data = text(obj(part.get("body")).get("data"))
        if data and not text(part.get("filename")):
            if mime == "text/plain":
                plain.append(_decode(data))
            elif mime == "text/html":
                html.append(_decode(data))
        for child in items(part.get("parts")):
            walk(obj(child), depth + 1)

    walk(payload, 0)
    if plain:
        return tidy("\n".join(plain))
    return html_to_text("\n".join(html))


# Drive


class GoogleDrive:
    def __init__(self, http: ApiClient) -> None:
        self._http = http

    async def list(
        self, token: str, folder_id: str | None, search: str | None, page: str | None
    ) -> FilePage:
        if search:
            query = f"name contains '{_quote(search)}' and trashed = false"
        else:
            parent = folder_id or "root"
            if parent != "root" and not _DRIVE_ID.match(parent):
                raise RemoteNotFoundError
            query = f"'{parent}' in parents and trashed = false"
        params = {
            "q": query,
            "pageSize": "50",
            "fields": f"nextPageToken,files({_DRIVE_FIELDS})",
            "spaces": "drive",
        }
        if not search:
            params["orderBy"] = "folder,name"
        if page:
            params["pageToken"] = page
        data = await self._http.json("GET", f"{DRIVE_API}/files", token=token, params=params)
        files = [f for f in (file_from_drive(obj(i)) for i in items(data.get("files"))) if f]
        return FilePage(files, text(data.get("nextPageToken")) or None)

    async def metadata(self, token: str, file_id: str) -> RemoteFile:
        if not _DRIVE_ID.match(file_id):
            raise RemoteNotFoundError
        data = await self._http.json(
            "GET", f"{DRIVE_API}/files/{file_id}", token=token, params={"fields": _DRIVE_FIELDS}
        )
        if data.get("trashed") is True:
            raise RemoteNotFoundError
        remote = file_from_drive(data)
        if remote is None:
            raise ProviderResponseError()
        return remote

    async def download(self, token: str, file: RemoteFile, max_bytes: int) -> bytes:
        if not _DRIVE_ID.match(file.external_id):
            raise RemoteNotFoundError
        if file.mime_type in _GOOGLE_EXPORTS:
            url = f"{DRIVE_API}/files/{file.external_id}/export"
            params = {"mimeType": "application/pdf"}
        elif file.mime_type.startswith("application/vnd.google-apps."):
            raise ProviderError("This kind of Google file can't be imported.")
        else:
            url = f"{DRIVE_API}/files/{file.external_id}"
            params = {"alt": "media"}
        if file.size is not None and file.size > max_bytes:
            raise FileTooLargeError
        body = await self._http.download(url, token=token, max_bytes=max_bytes, params=params)
        if isinstance(body, str):
            raise ProviderResponseError()  # Drive doesn't redirect file content.
        return body


def _quote(value: str) -> str:
    """Escape a string for a Drive query literal."""
    return value.replace("\\", "\\\\").replace("'", "\\'")[:200]


def file_from_drive(entry: Json) -> RemoteFile | None:
    file_id = text(entry.get("id"))
    if not file_id:
        return None
    mime = text(entry.get("mimeType"))
    name = text(entry.get("name")) or "Untitled"
    modified = parse_instant(entry.get("modifiedTime"))
    version = (
        text(entry.get("md5Checksum"))
        or (f"v{text(entry.get('version'))}" if entry.get("version") else "")
        or (modified.isoformat() if modified else file_id)
    )
    parents = [text(p) for p in items(entry.get("parents"))]
    return RemoteFile(
        external_id=file_id,
        name=name,
        folder=mime == _FOLDER,
        mime_type=mime,
        size=integer(entry.get("size")),
        modified_at=modified,
        version=version,
        parent_id=parents[0] if parents else None,
        url=text(entry.get("webViewLink")) or None,
        export_name=f"{name}.pdf" if mime in _GOOGLE_EXPORTS else None,
    )
