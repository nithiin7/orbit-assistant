"""The Google and Microsoft adapters against mocked HTTP: authorization URLs (PKCE, scopes),
token exchange and refresh, error mapping (refused tokens, rate limits with retries, expired
sync tokens, version conflicts), calendar mapping (time zones, all-day, series, occurrences,
cancellations), Graph link checks, mail bodies, Drive query escaping, and downloads that never
carry the token off the provider."""

import base64
import json
from collections.abc import Callable
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import httpx2
import pytest

from orbit_api.config import Settings
from orbit_api.providers.integrations import google, microsoft
from orbit_api.providers.integrations.http import ApiClient
from orbit_api.providers.integrations.registry import HttpConnectorRegistry
from orbit_api.providers.integrations.text import html_to_text
from orbit_api.services.integrations.connectors import (
    CursorExpiredError,
    FileTooLargeError,
    MailQuery,
    OutgoingEvent,
    ProviderResponseError,
    RateLimitedError,
    ReauthRequiredError,
    RemoteCalendar,
    RemoteDeletion,
    RemoteEvent,
    RemoteFile,
    RemoteNotFoundError,
    SyncPosition,
    VersionConflictError,
)

pytestmark = pytest.mark.anyio

TOKEN = "ya29.secret-token"
Handler = Callable[[httpx2.Request], httpx2.Response]


async def no_sleep(_: float) -> None:
    return None


def api(handler: Handler, name: str = "Google") -> ApiClient:
    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler), follow_redirects=False)
    return ApiClient(client, name, sleep=no_sleep)


CALENDAR = RemoteCalendar("primary", "Personal", True, "Europe/London")
START = SyncPosition(None, None, None)


# OAuth


def test_google_authorization_url_uses_pkce_offline_access_and_given_scopes() -> None:
    oauth = google.GoogleOAuth(api(lambda r: httpx2.Response(500)), "client-1", None)
    url = oauth.authorization_url(
        state="s" * 43,
        code_challenge="c" * 43,
        scopes=["openid", google.SCOPES["calendar"][0]],
        redirect_uri="http://localhost:3000/integrations/callback",
        login_hint="ada@example.com",
    )
    parts = urlsplit(url)
    params = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert parts.netloc == "accounts.google.com"
    assert params["code_challenge_method"] == "S256"
    assert params["access_type"] == "offline" and params["response_type"] == "code"
    assert (
        params["scope"] == "openid https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    )
    assert params["login_hint"] == "ada@example.com"
    assert "client_secret" not in params


async def test_google_token_exchange_sends_verifier_and_secret_as_form() -> None:
    seen: list[dict[str, list[str]]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(parse_qs(request.content.decode()))
        return httpx2.Response(
            200,
            json={
                "access_token": "a1",
                "refresh_token": "r1",
                "expires_in": 3600,
                "scope": "openid x",
            },
        )

    oauth = google.GoogleOAuth(api(handler), "client-1", "shh")
    tokens = await oauth.exchange_code("code", "verifier", "http://localhost/cb")
    assert tokens.access_token == "a1" and tokens.refresh_token == "r1"
    assert tokens.scopes == ("openid", "x")
    assert tokens.expires_at is not None
    form = seen[0]
    assert form["code_verifier"] == ["verifier"] and form["client_secret"] == ["shh"]
    assert form["grant_type"] == ["authorization_code"]


async def test_invalid_grant_means_reconnect_and_never_echoes_tokens() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(400, json={"error": "invalid_grant", "error_description": TOKEN})

    oauth = google.GoogleOAuth(api(handler), "client-1", None)
    with pytest.raises(ReauthRequiredError) as raised:
        await oauth.refresh(TOKEN)
    assert TOKEN not in str(raised.value)


async def test_microsoft_scopes_are_normalized_and_refresh_uses_default_scope() -> None:
    forms: list[dict[str, list[str]]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        forms.append(parse_qs(request.content.decode()))
        assert request.url.host == "login.microsoftonline.com"
        assert request.url.path == "/common/oauth2/v2.0/token"
        return httpx2.Response(
            200,
            json={
                "access_token": "a",
                "refresh_token": "r2",
                "expires_in": 3600,
                "scope": "https://graph.microsoft.com/Calendars.Read User.Read openid",
            },
        )

    oauth = microsoft.MicrosoftOAuth(api(handler, "Microsoft"), "client", None, "common")
    tokens = await oauth.refresh("r1")
    assert tokens.scopes == ("Calendars.Read", "User.Read", "openid")
    assert tokens.refresh_token == "r2"
    assert forms[0]["scope"] == [microsoft.REFRESH_SCOPE]
    assert await oauth.revoke("r2") is False  # No per-app revocation endpoint.


# HTTP behaviour


async def test_rate_limits_retry_then_surface_with_retry_after() -> None:
    calls = {"n": 0}

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls["n"] += 1
        return httpx2.Response(429, headers={"Retry-After": "5"})

    with pytest.raises(RateLimitedError) as raised:
        await api(handler).json("GET", "https://www.googleapis.com/x", token=TOKEN)
    assert calls["n"] == 3  # The first try and two retries.
    assert raised.value.retry_after == 5


async def test_google_quota_403_is_a_rate_limit_and_server_errors_recover() -> None:
    responses = [
        httpx2.Response(403, json={"error": {"errors": [{"reason": "userRateLimitExceeded"}]}}),
        httpx2.Response(503),
        httpx2.Response(200, json={"ok": True}),
    ]
    body = await api(lambda r: responses.pop(0)).json("GET", "https://www.googleapis.com/x")
    assert body == {"ok": True}


async def test_writes_are_not_retried() -> None:
    calls = {"n": 0}

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls["n"] += 1
        return httpx2.Response(503)

    with pytest.raises(Exception):  # noqa: B017 - the type is covered elsewhere
        await api(handler).json("POST", "https://www.googleapis.com/x", json_body={})
    assert calls["n"] == 1


# Google Calendar


def _google_calendar(handler: Handler) -> google.GoogleCalendar:
    return google.GoogleCalendar(api(handler), clock=lambda: datetime(2030, 1, 1, tzinfo=UTC))


async def test_google_full_sync_maps_timed_all_day_series_and_occurrences() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.headers["Authorization"] == f"Bearer {TOKEN}"
        params = dict(request.url.params)
        assert params["showDeleted"] == "true" and params["singleEvents"] == "false"
        assert "syncToken" not in params
        return httpx2.Response(
            200,
            json={
                "timeZone": "Europe/London",
                "nextSyncToken": "sync-1",
                "items": [
                    {
                        "id": "timed",
                        "etag": '"1"',
                        "summary": "Flight",
                        "start": {
                            "dateTime": "2030-01-14T09:00:00-05:00",
                            "timeZone": "America/New_York",
                        },
                        "end": {"dateTime": "2030-01-14T11:00:00-05:00"},
                    },
                    {
                        "id": "day",
                        "etag": '"2"',
                        "summary": "Holiday",
                        "start": {"date": "2030-01-20"},
                        "end": {"date": "2030-01-22"},
                    },
                    {
                        "id": "series",
                        "etag": '"3"',
                        "summary": "Standup",
                        "description": "<b>Daily</b> sync",
                        "start": {"dateTime": "2030-01-14T09:30:00Z"},
                        "end": {"dateTime": "2030-01-14T09:45:00Z"},
                        "recurrence": [
                            "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10",
                            "EXDATE;TZID=Europe/London:20300116T093000",
                        ],
                    },
                    {
                        "id": "series_x",
                        "status": "cancelled",
                        "recurringEventId": "series",
                        "originalStartTime": {"dateTime": "2030-01-21T09:30:00Z"},
                    },
                    {"id": "gone", "status": "cancelled"},
                ],
            },
        )

    page = await _google_calendar(handler).changes(TOKEN, CALENDAR, START)
    assert page.next_cursor == "sync-1" and page.next_page is None
    timed, day, series, cancelled, gone = page.changes
    assert isinstance(timed, RemoteEvent)
    assert (timed.timezone, timed.start, timed.end) == (
        "America/New_York",
        datetime(2030, 1, 14, 9, 0),
        datetime(2030, 1, 14, 11, 0),
    )
    assert isinstance(day, RemoteEvent) and day.all_day
    assert (day.start, day.end) == (datetime(2030, 1, 20), datetime(2030, 1, 22))
    assert isinstance(series, RemoteEvent) and series.recurrence is not None
    assert series.recurrence.weekdays == frozenset({"mon", "wed"}) and series.recurrence.count == 10
    assert series.skipped == (datetime(2030, 1, 16, 9, 30),)
    assert series.description == "Daily sync"
    assert isinstance(cancelled, RemoteEvent) and cancelled.cancelled
    assert (cancelled.parent_id, cancelled.original_start) == (
        "series",
        datetime(2030, 1, 21, 9, 30),
    )
    assert gone == RemoteDeletion("gone")


async def test_google_rules_orbit_cant_represent_are_expanded() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path.endswith("/instances"):
            params = dict(request.url.params)
            assert params["timeMin"].startswith("2029-12-02")
            return httpx2.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "m_1",
                            "etag": '"a"',
                            "summary": "Board",
                            "recurringEventId": "m",
                            "originalStartTime": {"dateTime": "2030-01-14T18:00:00Z"},
                            "start": {"dateTime": "2030-01-14T18:00:00Z"},
                            "end": {"dateTime": "2030-01-14T19:00:00Z"},
                        },
                        {"id": "m_2", "status": "cancelled", "recurringEventId": "m"},
                    ]
                },
            )
        return httpx2.Response(
            200,
            json={
                "nextSyncToken": "s",
                "items": [
                    {
                        "id": "m",
                        "summary": "Board",
                        "start": {"dateTime": "2030-01-14T18:00:00Z"},
                        "end": {"dateTime": "2030-01-14T19:00:00Z"},
                        "recurrence": ["RRULE:FREQ=MONTHLY;BYDAY=2TU"],
                    }
                ],
            },
        )

    page = await _google_calendar(handler).changes(TOKEN, CALENDAR, START)
    instance, deletion = page.changes
    assert isinstance(instance, RemoteEvent) and instance.expanded and instance.parent_id == "m"
    assert deletion == RemoteDeletion("m_2")


async def test_google_incremental_sync_and_expired_tokens() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.params["syncToken"] == "old"
        return httpx2.Response(410, json={"error": {"code": 410}})

    with pytest.raises(CursorExpiredError):
        await _google_calendar(handler).changes(TOKEN, CALENDAR, SyncPosition("old", None, None))


async def test_google_updates_send_if_match_and_map_412() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.method == "PATCH"
        assert request.headers["If-Match"] == '"7"'
        body = json.loads(request.content)
        assert body["start"] == {"dateTime": "2030-01-14T09:00:00", "timeZone": "Europe/London"}
        return httpx2.Response(412)

    event = OutgoingEvent(
        "T", "", "", False, "Europe/London", datetime(2030, 1, 14, 9), datetime(2030, 1, 14, 10)
    )
    with pytest.raises(VersionConflictError):
        await _google_calendar(handler).update_event(TOKEN, "primary", "e1", event, '"7"')


async def test_unauthorized_calls_ask_for_a_refresh() -> None:
    with pytest.raises(ReauthRequiredError):
        await _google_calendar(lambda r: httpx2.Response(401)).calendars(TOKEN)


# Microsoft Graph calendar


async def test_graph_delta_maps_occurrences_zones_and_removals() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert "calendarView/delta" in request.url.path
        assert 'outlook.timezone="UTC"' in request.headers["Prefer"]
        return httpx2.Response(
            200,
            json={
                "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=x",
                "value": [
                    {
                        "id": "occ",
                        "changeKey": "ck1",
                        "subject": "1:1",
                        "type": "occurrence",
                        "seriesMasterId": "master",
                        "originalStartTimeZone": "Pacific Standard Time",
                        "start": {"dateTime": "2030-01-14T17:00:00.0000000", "timeZone": "UTC"},
                        "end": {"dateTime": "2030-01-14T17:30:00.0000000", "timeZone": "UTC"},
                        "body": {
                            "contentType": "html",
                            "content": "<p>Agenda</p><script>x</script>",
                        },
                    },
                    {
                        "id": "allday",
                        "changeKey": "ck2",
                        "subject": "Offsite",
                        "isAllDay": True,
                        "originalStartTimeZone": "Some Unknown Zone",
                        "start": {"dateTime": "2030-01-19T23:00:00.0000000", "timeZone": "UTC"},
                        "end": {"dateTime": "2030-01-20T23:00:00.0000000", "timeZone": "UTC"},
                    },
                    {"id": "removed", "@removed": {"reason": "deleted"}},
                    {"id": "cancelled", "isCancelled": True},
                ],
            },
        )

    calendar = microsoft.MicrosoftCalendar(api(handler, "Microsoft"))
    page = await calendar.changes(
        TOKEN,
        RemoteCalendar("cal", "Calendar", True, None),
        SyncPosition(None, None, datetime(2030, 1, 1, tzinfo=UTC)),
    )
    assert page.next_cursor is not None and page.next_page is None
    occurrence, all_day, removed, cancelled = page.changes
    assert isinstance(occurrence, RemoteEvent)
    assert occurrence.timezone == "America/Los_Angeles"
    assert occurrence.start == datetime(2030, 1, 14, 9, 0)
    assert occurrence.expanded and occurrence.parent_id == "master"
    assert occurrence.description == "Agenda"
    assert isinstance(all_day, RemoteEvent) and all_day.all_day
    assert (all_day.start, all_day.end) == (datetime(2030, 1, 20), datetime(2030, 1, 21))
    assert removed == RemoteDeletion("removed") and cancelled == RemoteDeletion("cancelled")


async def test_graph_links_off_graph_are_refused() -> None:
    calendar = microsoft.MicrosoftCalendar(api(lambda r: httpx2.Response(500), "Microsoft"))
    with pytest.raises(ProviderResponseError):
        await calendar.changes(
            TOKEN,
            RemoteCalendar("cal", "Calendar", True, None),
            SyncPosition("https://evil.example/steal?token", None, None),
        )


async def test_graph_expired_delta_is_a_full_resync() -> None:
    calendar = microsoft.MicrosoftCalendar(api(lambda r: httpx2.Response(410), "Microsoft"))
    with pytest.raises(CursorExpiredError):
        await calendar.changes(
            TOKEN,
            RemoteCalendar("cal", "Calendar", True, None),
            SyncPosition("https://graph.microsoft.com/v1.0/delta?x", None, None),
        )


async def test_graph_updates_use_weak_etags_and_utc_times() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.headers["If-Match"] == 'W/"ck1"'
        body = json.loads(request.content)
        assert body["start"] == {"dateTime": "2030-01-14T17:00:00", "timeZone": "UTC"}
        return httpx2.Response(
            200,
            json={
                "id": "e",
                "changeKey": "ck2",
                "subject": "T",
                "start": {"dateTime": "2030-01-14T17:00:00", "timeZone": "UTC"},
                "end": {"dateTime": "2030-01-14T18:00:00", "timeZone": "UTC"},
            },
        )

    event = OutgoingEvent(
        "T",
        "",
        "",
        False,
        "America/Los_Angeles",
        datetime(2030, 1, 14, 9),
        datetime(2030, 1, 14, 10),
    )
    updated = await microsoft.MicrosoftCalendar(api(handler, "Microsoft")).update_event(
        TOKEN, "cal", "e", event, "ck1"
    )
    assert updated.version == "ck2" and updated.timezone == "America/Los_Angeles"
    assert updated.start == datetime(2030, 1, 14, 9, 0)


# Mail


async def test_gmail_lists_metadata_and_reads_plain_text() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if path.endswith("/messages"):
            assert request.url.params["q"] == "after:2030/01/01 invoice"
            assert request.url.params.get_list("labelIds") == ["INBOX"]
            return httpx2.Response(200, json={"messages": [{"id": "m1"}]})
        if request.url.params.get("format") == "metadata":
            return httpx2.Response(
                200,
                json={
                    "id": "m1",
                    "threadId": "t1",
                    "internalDate": "1893456000000",
                    "snippet": "Hello &amp; welcome",
                    "labelIds": ["INBOX"],
                    "payload": {
                        "headers": [
                            {"name": "Subject", "value": "Invoice"},
                            {"name": "From", "value": "a@b.c"},
                        ]
                    },
                },
            )
        html = base64.urlsafe_b64encode(b"<p>Hi</p><img src=x onerror=alert(1)>").decode()
        return httpx2.Response(
            200,
            json={
                "id": "m1",
                "internalDate": "1893456000000",
                "payload": {
                    "headers": [{"name": "To", "value": "x@y.z, w@v.u"}],
                    "parts": [{"mimeType": "text/html", "body": {"data": html}}],
                },
            },
        )

    mail = google.GoogleMail(api(handler))
    page = await mail.messages(TOKEN, MailQuery("INBOX", datetime(2030, 1, 1).date(), "invoice"))
    assert [(m.subject, m.sender, m.thread_id) for m in page.messages] == [
        ("Invoice", "a@b.c", "t1")
    ]
    detail = await mail.message(TOKEN, "m1")
    assert detail.body == "Hi" and detail.recipients == ("x@y.z", "w@v.u")


def test_html_to_text_drops_scripts_and_markup() -> None:
    html = "<style>p{}</style><p>One</p><p>Two &amp; three</p><script>bad()</script>"
    assert html_to_text(html) == "One\n\nTwo & three"
    text = html_to_text("<p>One</p><script>bad()</script>")
    assert text == "One" and "bad" not in text


# Files


async def test_drive_search_is_escaped_and_ids_are_checked() -> None:
    seen: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request.url.params["q"])
        return httpx2.Response(200, json={"files": []})

    drive = google.GoogleDrive(api(handler))
    await drive.list(TOKEN, None, "it's", None)
    assert seen == ["name contains 'it\\'s' and trashed = false"]
    with pytest.raises(RemoteNotFoundError):
        await drive.list(TOKEN, "x' or '1'='1", None, None)


async def test_drive_exports_google_docs_and_enforces_size() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path.endswith("/export")
        return httpx2.Response(200, content=b"%PDF-" + b"x" * 100)

    drive = google.GoogleDrive(api(handler))
    doc = RemoteFile(
        "d1",
        "Plan",
        False,
        "application/vnd.google-apps.document",
        None,
        None,
        "v1",
        export_name="Plan.pdf",
    )
    assert (await drive.download(TOKEN, doc, 1000)).startswith(b"%PDF-")
    with pytest.raises(FileTooLargeError):
        await drive.download(TOKEN, doc, 10)


async def test_onedrive_download_redirect_is_fetched_without_the_token() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.host == "graph.microsoft.com":
            assert request.headers["Authorization"] == f"Bearer {TOKEN}"
            return httpx2.Response(
                302, headers={"Location": "https://files.example/download?sig=1"}
            )
        assert "Authorization" not in request.headers
        return httpx2.Response(200, content=b"data")

    files = microsoft.OneDriveFiles(api(handler, "Microsoft"))
    remote = RemoteFile("ABC!1", "a.txt", False, "text/plain", 4, None, "c1")
    assert await files.download(TOKEN, remote, 100) == b"data"


def test_registry_offers_only_configured_providers(settings: Settings) -> None:
    assert HttpConnectorRegistry(settings).get("google") is None
    configured = settings.model_copy(update={"microsoft_client_id": "client"})
    registry = HttpConnectorRegistry(configured)
    connector = registry.get("microsoft")
    assert connector is not None and registry.get("google") is None
    assert connector.scopes_for(["calendar"]) == [
        "openid",
        "offline_access",
        "User.Read",
        "Calendars.Read",
    ]
    assert connector.granted(["Calendars.Read", "Mail.Read", "User.Read"]) == ("calendar", "mail")
