"""Microsoft: the identity platform's OAuth 2.0 (Authorization Code with PKCE) and Microsoft
Graph v1.0 for Outlook calendars, mail (read only), and OneDrive (read only).

Graph's delta query for events works on a calendar *view*, which expands series into their
occurrences within a date range. Orbit therefore synchronizes a window (a month back to a year
ahead, moved monthly) and imports each occurrence as its own event; Outlook's own series stay
in Outlook. Times are requested in UTC (`Prefer: outlook.timezone="UTC"`) and converted to the
event's original zone where Orbit recognizes it.

Graph's paging links (`@odata.nextLink`, `@odata.deltaLink`) are absolute URLs; Orbit only
follows ones on `graph.microsoft.com`, so a stored cursor can never send the token elsewhere.
"""

import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, time, timedelta
from typing import Final
from urllib.parse import quote, urlencode, urlsplit
from zoneinfo import ZoneInfo

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
from orbit_api.services.integrations.mapping import local_from_instant, valid_timezone
from orbit_api.services.integrations.models import Capability

GRAPH: Final = "https://graph.microsoft.com/v1.0"
_GRAPH_HOST: Final = "graph.microsoft.com"
LOGIN: Final = "https://login.microsoftonline.com"

BASE_SCOPES: Final = ("openid", "offline_access", "User.Read")
SCOPES: Final[dict[Capability, tuple[str, ...]]] = {
    "calendar": ("Calendars.Read",),
    "calendar_write": ("Calendars.ReadWrite",),
    "mail": ("Mail.Read",),
    "files": ("Files.Read",),
}
# Refreshing asks for whatever was consented, without listing it again.
REFRESH_SCOPE: Final = "https://graph.microsoft.com/.default offline_access"

WINDOW_LENGTH: Final = timedelta(days=395)
# Outlook event subscriptions last at most 4,230 minutes; renewed well before.
SUBSCRIPTION_LENGTH: Final = timedelta(days=2)
_EVENT_FIELDS: Final = (
    "id,subject,body,bodyPreview,location,start,end,isAllDay,isCancelled,type,seriesMasterId,"
    "originalStartTimeZone,changeKey,webLink"
)
_MESSAGE_FIELDS: Final = (
    "id,conversationId,subject,from,receivedDateTime,bodyPreview,webLink,parentFolderId"
)
_DRIVE_FIELDS: Final = (
    "id,name,size,file,folder,package,lastModifiedDateTime,cTag,eTag,parentReference,webUrl"
)
_DRIVE_ID: Final = re.compile(r"^[A-Za-z0-9!._-]{1,200}$")

# The Windows time zone names Outlook reports most often, mapped to IANA (from CLDR's
# windowsZones). An unknown name falls back to UTC, which keeps the instant right.
WINDOWS_ZONES: Final[dict[str, str]] = {
    "UTC": "UTC",
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "W. Europe Standard Time": "Europe/Berlin",
    "Romance Standard Time": "Europe/Paris",
    "Central Europe Standard Time": "Europe/Budapest",
    "Central European Standard Time": "Europe/Warsaw",
    "E. Europe Standard Time": "Europe/Chisinau",
    "FLE Standard Time": "Europe/Kiev",
    "GTB Standard Time": "Europe/Bucharest",
    "Russian Standard Time": "Europe/Moscow",
    "Turkey Standard Time": "Europe/Istanbul",
    "Israel Standard Time": "Asia/Jerusalem",
    "Arabian Standard Time": "Asia/Dubai",
    "Pakistan Standard Time": "Asia/Karachi",
    "India Standard Time": "Asia/Kolkata",
    "Nepal Standard Time": "Asia/Kathmandu",
    "Bangladesh Standard Time": "Asia/Dhaka",
    "SE Asia Standard Time": "Asia/Bangkok",
    "China Standard Time": "Asia/Shanghai",
    "Singapore Standard Time": "Asia/Singapore",
    "Tokyo Standard Time": "Asia/Tokyo",
    "Korea Standard Time": "Asia/Seoul",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "E. Australia Standard Time": "Australia/Brisbane",
    "W. Australia Standard Time": "Australia/Perth",
    "New Zealand Standard Time": "Pacific/Auckland",
    "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Mountain Standard Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix",
    "Pacific Standard Time": "America/Los_Angeles",
    "Alaskan Standard Time": "America/Anchorage",
    "Hawaiian Standard Time": "Pacific/Honolulu",
    "Atlantic Standard Time": "America/Halifax",
    "SA Eastern Standard Time": "America/Cayenne",
    "E. South America Standard Time": "America/Sao_Paulo",
    "Argentina Standard Time": "America/Buenos_Aires",
    "Canada Central Standard Time": "America/Regina",
    "Central America Standard Time": "America/Guatemala",
    "Mexico Standard Time": "America/Mexico_City",
    "South Africa Standard Time": "Africa/Johannesburg",
    "Egypt Standard Time": "Africa/Cairo",
    "W. Central Africa Standard Time": "Africa/Lagos",
    "E. Africa Standard Time": "Africa/Nairobi",
}


def zone_of(name: str | None) -> str:
    if not name:
        return "UTC"
    return WINDOWS_ZONES.get(name) or valid_timezone(name) or "UTC"


def _graph_link(url: str) -> str:
    """A paging link, only if it points at Graph over HTTPS."""
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != _GRAPH_HOST:
        raise ProviderResponseError()
    return url


def _bare_scope(scope: str) -> str:
    prefix = "https://graph.microsoft.com/"
    return scope[len(prefix) :] if scope.startswith(prefix) else scope


class MicrosoftOAuth:
    def __init__(
        self, http: ApiClient, client_id: str, client_secret: str | None, tenant: str
    ) -> None:
        self._http = http
        self._client_id = client_id
        self._client_secret = client_secret
        self._base = f"{LOGIN}/{quote(tenant, safe='')}/oauth2/v2.0"

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
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": " ".join(scopes),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
        if login_hint:
            params["login_hint"] = login_hint
        return f"{self._base}/authorize?{urlencode(params)}"

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
        return await self._token(
            {"grant_type": "refresh_token", "refresh_token": refresh_token, "scope": REFRESH_SCOPE}
        )

    async def revoke(self, token: str) -> bool:
        # The identity platform has no endpoint to revoke one app's grant. The tokens are
        # deleted; the person removes Orbit at https://account.live.com/consent/Manage or in
        # their organization's My Apps page.
        return False

    async def account(self, access_token: str) -> AccountInfo:
        data = await self._http.json(
            "GET",
            f"{GRAPH}/me",
            token=access_token,
            params={"$select": "id,displayName,mail,userPrincipalName"},
        )
        account_id = text(data.get("id"))
        if not account_id:
            raise ProviderResponseError()
        email = text(data.get("mail")) or text(data.get("userPrincipalName"))
        return AccountInfo(account_id, email, text(data.get("displayName")) or email)

    async def _token(self, form: dict[str, str]) -> TokenSet:
        form = {**form, "client_id": self._client_id}
        if self._client_secret:
            form["client_secret"] = self._client_secret
        data = await self._http.json("POST", f"{self._base}/token", form=form)
        access = text(data.get("access_token"))
        if not access:
            raise ProviderResponseError()
        expires_in = integer(data.get("expires_in"))
        return TokenSet(
            access_token=access,
            refresh_token=text(data.get("refresh_token")) or None,
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in) if expires_in else None,
            scopes=tuple(_bare_scope(s) for s in text(data.get("scope")).split()),
        )


# Calendar


class MicrosoftCalendar:
    windowed = True

    def __init__(
        self, http: ApiClient, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._http = http
        self._clock = clock

    async def calendars(self, token: str) -> list[RemoteCalendar]:
        calendars: list[RemoteCalendar] = []
        url: str | None = f"{GRAPH}/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100"
        while url:
            data = await self._http.json("GET", url, token=token)
            for item in items(data.get("value")):
                entry = obj(item)
                calendar_id = text(entry.get("id"))
                if calendar_id:
                    calendars.append(
                        RemoteCalendar(
                            external_id=calendar_id,
                            name=text(entry.get("name")),
                            writable=entry.get("canEdit") is True,
                            timezone=None,
                            primary=entry.get("isDefaultCalendar") is True,
                        )
                    )
            link = text(data.get("@odata.nextLink"))
            url = _graph_link(link) if link else None
        return calendars

    async def changes(
        self, token: str, calendar: RemoteCalendar, position: SyncPosition
    ) -> ChangePage:
        headers = {"Prefer": 'outlook.timezone="UTC", odata.maxpagesize=100'}
        if position.page:
            url = _graph_link(position.page)
        elif position.cursor:
            url = _graph_link(position.cursor)
        else:
            start = position.window_start or self._clock()
            end = start + WINDOW_LENGTH
            url = (
                f"{GRAPH}/me/calendars/{quote(calendar.external_id, safe='')}/calendarView/delta?"
                + urlencode(
                    {
                        "startDateTime": start.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "endDateTime": end.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    }
                )
            )
        data = await self._http.json("GET", url, token=token, headers=headers, expect_gone=True)
        changes: list[RemoteChange] = []
        for item in items(data.get("value")):
            change = change_from_graph(obj(item))
            if change is not None:
                changes.append(change)
        next_link = text(data.get("@odata.nextLink"))
        delta = text(data.get("@odata.deltaLink"))
        return ChangePage(
            changes=changes,
            next_page=_graph_link(next_link) if next_link else None,
            next_cursor=_graph_link(delta) if delta and not next_link else None,
        )

    async def create_event(self, token: str, calendar_id: str, event: OutgoingEvent) -> RemoteEvent:
        data = await self._http.json(
            "POST",
            f"{GRAPH}/me/calendars/{quote(calendar_id, safe='')}/events",
            token=token,
            json_body=event_to_graph(event),
            headers={"Prefer": 'outlook.timezone="UTC"'},
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
        headers = {"Prefer": 'outlook.timezone="UTC"'}
        if version:
            headers["If-Match"] = f'W/"{version}"'
        data = await self._http.json(
            "PATCH",
            f"{GRAPH}/me/events/{quote(external_id, safe='')}",
            token=token,
            json_body=event_to_graph(event),
            headers=headers,
        )
        return self._returned(data, event.timezone)

    async def watch(
        self, token: str, calendar_id: str, address: str, channel_id: str, secret: str
    ) -> WatchChannel:
        expires = self._clock() + SUBSCRIPTION_LENGTH
        data = await self._http.json(
            "POST",
            f"{GRAPH}/subscriptions",
            token=token,
            json_body={
                "changeType": "created,updated,deleted",
                "notificationUrl": address,
                "resource": f"me/calendars/{calendar_id}/events",
                "expirationDateTime": expires.astimezone(UTC).isoformat(),
                "clientState": secret[:128],
            },
        )
        subscription = text(data.get("id"))
        if not subscription:
            raise ProviderResponseError()
        return WatchChannel(
            subscription, None, parse_instant(data.get("expirationDateTime")) or expires
        )

    async def unwatch(self, token: str, channel_id: str, resource_id: str | None) -> None:
        await self._http.send(
            "DELETE", f"{GRAPH}/subscriptions/{quote(channel_id, safe='')}", token=token
        )

    @staticmethod
    def _returned(data: Json, zone: str) -> RemoteEvent:
        change = change_from_graph(data, fallback_zone=zone)
        if not isinstance(change, RemoteEvent):
            raise ProviderResponseError()
        return change


def change_from_graph(entry: Json, fallback_zone: str | None = None) -> RemoteChange | None:
    event_id = text(entry.get("id"))
    if not event_id:
        return None
    if "@removed" in entry or entry.get("isCancelled") is True:
        return RemoteDeletion(event_id)
    start = parse_instant(obj(entry.get("start")).get("dateTime"), "UTC")
    end = parse_instant(obj(entry.get("end")).get("dateTime"), "UTC")
    if start is None or end is None:
        return None
    zone = zone_of(text(entry.get("originalStartTimeZone")) or fallback_zone)
    all_day = entry.get("isAllDay") is True
    if all_day:
        local_start, local_end = _all_day(start, zone), _all_day(end, zone)
    else:
        local_start, local_end = local_from_instant(start, zone), local_from_instant(end, zone)
    body = obj(entry.get("body"))
    content = text(body.get("content"))
    description = (
        html_to_text(content) if text(body.get("contentType")).lower() == "html" else tidy(content)
    ) or tidy(text(entry.get("bodyPreview")))
    return RemoteEvent(
        external_id=event_id,
        version=text(entry.get("changeKey")) or event_id,
        title=text(entry.get("subject")),
        description=description,
        location=text(obj(entry.get("location")).get("displayName")),
        all_day=all_day,
        timezone=zone,
        start=local_start,
        end=local_end,
        parent_id=text(entry.get("seriesMasterId")) or None,
        expanded=True,
        url=text(entry.get("webLink")) or None,
    )


def _all_day(instant: datetime, zone: str) -> datetime:
    """All-day events are midnight in their own zone; asked for in UTC, they arrive shifted.
    Converting back (or, for an unknown zone, rounding to the nearest midnight) recovers the
    date."""
    if zone != "UTC":
        return datetime.combine(local_from_instant(instant, zone).date(), time())
    rounded = (instant.astimezone(UTC) + timedelta(hours=12)).date()
    return datetime.combine(rounded, time())


def event_to_graph(event: OutgoingEvent) -> Json:
    if event.all_day:
        start: Json = {"dateTime": f"{event.start.date().isoformat()}T00:00:00", "timeZone": "UTC"}
        end: Json = {"dateTime": f"{event.end.date().isoformat()}T00:00:00", "timeZone": "UTC"}
    else:
        # Sent as UTC instants: Graph's time zone names aren't IANA's.
        zone = ZoneInfo(event.timezone)
        start_utc = event.start.replace(tzinfo=zone).astimezone(UTC)
        end_utc = event.end.replace(tzinfo=zone).astimezone(UTC)
        start = {"dateTime": start_utc.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}
        end = {"dateTime": end_utc.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}
    return {
        "subject": event.title,
        "body": {"contentType": "text", "content": event.description},
        "location": {"displayName": event.location},
        "isAllDay": event.all_day,
        "start": start,
        "end": end,
    }


# Mail


class OutlookMail:
    def __init__(self, http: ApiClient) -> None:
        self._http = http

    async def labels(self, token: str) -> list[RemoteLabel]:
        data = await self._http.json(
            "GET",
            f"{GRAPH}/me/mailFolders",
            token=token,
            params={"$top": "100", "$select": "id,displayName"},
        )
        labels: list[RemoteLabel] = []
        for item in items(data.get("value")):
            entry = obj(item)
            folder_id = text(entry.get("id"))
            name = text(entry.get("displayName"))
            if folder_id and name.lower() not in (
                "deleted items",
                "junk email",
                "drafts",
                "outbox",
            ):
                labels.append(RemoteLabel(folder_id, name, name.lower() == "inbox"))
        return sorted(labels, key=lambda label: (not label.system, label.name.lower()))

    async def messages(self, token: str, query: MailQuery) -> MessagePage:
        if query.page:
            url = _graph_link(query.page)
            params: dict[str, str | list[str]] | None = None
        else:
            url = f"{GRAPH}/me/mailFolders/{quote(query.label_id, safe='')}/messages"
            params = {"$select": _MESSAGE_FIELDS, "$top": str(query.limit)}
            if query.search:
                # `$search` can't be combined with `$filter` or `$orderby`; dates are checked
                # by the service afterwards.
                cleaned = query.search.replace('"', " ").replace("\\", " ")[:200]
                params["$search"] = f'"{cleaned}"'
            else:
                params["$filter"] = f"receivedDateTime ge {query.since.isoformat()}T00:00:00Z"
                params["$orderby"] = "receivedDateTime desc"
        data = await self._http.json("GET", url, token=token, params=params)
        messages = [m for m in (summary_from_graph(obj(i)) for i in items(data.get("value"))) if m]
        link = text(data.get("@odata.nextLink"))
        return MessagePage(messages, _graph_link(link) if link else None)

    async def message(self, token: str, external_id: str) -> MessageDetail:
        data = await self._http.json(
            "GET",
            f"{GRAPH}/me/messages/{quote(external_id, safe='')}",
            token=token,
            params={"$select": f"{_MESSAGE_FIELDS},toRecipients,ccRecipients,body"},
            headers={"Prefer": 'outlook.body-content-type="text"'},
        )
        summary = summary_from_graph(data)
        if summary is None:
            raise ProviderResponseError()
        recipients = tuple(
            _address(obj(r))
            for key in ("toRecipients", "ccRecipients")
            for r in items(data.get(key))
        )
        body = obj(data.get("body"))
        content = text(body.get("content"))
        plain = html_to_text(content) if text(body.get("contentType")) == "html" else tidy(content)
        return MessageDetail(summary, tuple(r for r in recipients if r), plain)


def _address(recipient: Json) -> str:
    address = obj(recipient.get("emailAddress"))
    name, email = text(address.get("name")), text(address.get("address"))
    return f"{name} <{email}>" if name and email and name != email else email or name


def summary_from_graph(entry: Json) -> MessageSummary | None:
    message_id = text(entry.get("id"))
    received = parse_instant(entry.get("receivedDateTime"))
    if not message_id or received is None:
        return None
    folder = text(entry.get("parentFolderId"))
    return MessageSummary(
        external_id=message_id,
        thread_id=text(entry.get("conversationId")) or None,
        subject=text(entry.get("subject")),
        sender=_address(obj(entry.get("from"))),
        received_at=received,
        snippet=tidy(text(entry.get("bodyPreview"))),
        label_ids=(folder,) if folder else (),
        url=text(entry.get("webLink")) or None,
    )


# OneDrive


class OneDriveFiles:
    def __init__(self, http: ApiClient) -> None:
        self._http = http

    async def list(
        self, token: str, folder_id: str | None, search: str | None, page: str | None
    ) -> FilePage:
        params: dict[str, str | list[str]] | None = {"$select": _DRIVE_FIELDS, "$top": "50"}
        if page:
            url, params = _graph_link(page), None
        elif search:
            escaped = search.replace("'", "''")[:200]
            url = f"{GRAPH}/me/drive/root/search(q='{quote(escaped, safe='')}')"
        elif folder_id:
            if not _DRIVE_ID.match(folder_id):
                raise RemoteNotFoundError
            url = f"{GRAPH}/me/drive/items/{folder_id}/children"
        else:
            url = f"{GRAPH}/me/drive/root/children"
        data = await self._http.json("GET", url, token=token, params=params)
        files = [f for f in (file_from_graph(obj(i)) for i in items(data.get("value"))) if f]
        link = text(data.get("@odata.nextLink"))
        return FilePage(files, _graph_link(link) if link else None)

    async def metadata(self, token: str, file_id: str) -> RemoteFile:
        if not _DRIVE_ID.match(file_id):
            raise RemoteNotFoundError
        data = await self._http.json(
            "GET",
            f"{GRAPH}/me/drive/items/{file_id}",
            token=token,
            params={"$select": _DRIVE_FIELDS},
        )
        remote = file_from_graph(data)
        if remote is None:
            raise ProviderResponseError()
        return remote

    async def download(self, token: str, file: RemoteFile, max_bytes: int) -> bytes:
        if not _DRIVE_ID.match(file.external_id):
            raise RemoteNotFoundError
        if file.size is not None and file.size > max_bytes:
            raise FileTooLargeError
        body = await self._http.download(
            f"{GRAPH}/me/drive/items/{file.external_id}/content", token=token, max_bytes=max_bytes
        )
        if isinstance(body, bytes):
            return body
        # A short-lived, pre-authenticated download URL: fetched without Orbit's token.
        if urlsplit(body).scheme != "https":
            raise ProviderResponseError()
        content = await self._http.download(body, token=None, max_bytes=max_bytes)
        if isinstance(content, str):
            raise ProviderResponseError()
        return content


def file_from_graph(entry: Json) -> RemoteFile | None:
    file_id = text(entry.get("id"))
    if not file_id:
        return None
    is_folder = "folder" in entry or "package" in entry
    modified = parse_instant(entry.get("lastModifiedDateTime"))
    return RemoteFile(
        external_id=file_id,
        name=text(entry.get("name")) or "Untitled",
        folder=is_folder,
        mime_type=text(obj(entry.get("file")).get("mimeType")),
        size=integer(entry.get("size")),
        modified_at=modified,
        version=text(entry.get("cTag")) or text(entry.get("eTag")) or file_id,
        parent_id=text(obj(entry.get("parentReference")).get("id")) or None,
        url=text(entry.get("webUrl")) or None,
    )
