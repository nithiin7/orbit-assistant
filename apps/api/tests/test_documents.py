"""The documents API: uploads and file validation, downloads, metadata, folders, categories,
tags, search, trash and permanent deletion, versions, renewals, expiry reminders through the
reminder system, links to other modules, export, file cleanup, and workspace isolation.

The API uses the real clock; expiry dates are relative to today (UTC is every user's zone
here). Reminders delivered by the worker use dates in 2030.
"""

import hashlib
import io
import json
import os
import time
import uuid
import zipfile
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.repositories.documents import SqlDocumentStore
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.services.transactions import ConflictError
from orbit_api.system.attachment_store import FileAttachmentStore
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
PDF = b"%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

Headers = dict[str, str]
Json = dict[str, Any]


def office(part: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr(part, "<x/>")
    return buffer.getvalue()


def today() -> date:
    return datetime.now(UTC).date()


def days(n: int) -> str:
    return (today() + timedelta(days=n)).isoformat()


@pytest.fixture
def settings_open(migrated_settings: Settings) -> Settings:
    return migrated_settings.model_copy(
        update={"local_open_registration": True, "document_max_bytes": 64 * 1024}
    )


@pytest.fixture
def client(settings_open: Settings) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    app = create_app(settings_open)
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def personal(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    return personal(client, ada)


def upload(
    client: TestClient,
    ws: str,
    headers: Headers,
    filename: str = "passport.pdf",
    data: bytes = PDF,
    **params: Any,
) -> Json:
    response = client.post(
        f"{ws}/documents/upload",
        params={"filename": filename, **params},
        content=data,
        headers={**headers, "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 201, response.text
    detail: Json = response.json()
    return detail


def create(client: TestClient, ws: str, headers: Headers, **fields: Any) -> Json:
    response = client.post(f"{ws}/documents", json={"title": "Passport", **fields}, headers=headers)
    assert response.status_code == 201, response.text
    detail: Json = response.json()
    return detail


def patch(client: TestClient, ws: str, headers: Headers, document: Json, **fields: Any) -> Json:
    response = client.patch(
        f"{ws}/documents/{document['document']['id']}", json=fields, headers=headers
    )
    assert response.status_code == 200, response.text
    detail: Json = response.json()
    return detail


def titles(client: TestClient, ws: str, headers: Headers, **params: Any) -> list[str]:
    response = client.get(f"{ws}/documents", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [d["title"] for d in response.json()["documents"]]


def stored_files(settings: Settings) -> list[Path]:
    root = settings.attachments_dir
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


def managed(client: TestClient, ws: str, headers: Headers) -> list[Json]:
    reminders: list[Json] = client.get(f"{ws}/reminders", headers=headers).json()["reminders"]
    return [r for r in reminders if r["commitment"] and r["commitment"]["kind"] == "document"]


def new_version(
    client: TestClient, ws: str, headers: Headers, document: Json, filename: str, data: bytes
) -> Json:
    response = client.post(
        f"{ws}/documents/{document['document']['id']}/versions",
        params={"filename": filename},
        content=data,
        headers={**headers, "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 201, response.text
    detail: Json = response.json()
    return detail


class TestUploads:
    def test_upload_download_and_file_storage(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        detail = upload(client, ws, ada, filename="My passport.pdf")
        document = detail["document"]
        assert document["title"] == "My passport"
        assert document["file"]["filename"] == "My passport.pdf"
        assert document["file"]["content_type"] == "application/pdf"
        assert document["file"]["size_bytes"] == len(PDF)
        assert document["version_count"] == 1
        [version] = detail["versions"]
        assert version["sha256"] == hashlib.sha256(PDF).hexdigest()
        assert version["is_current"] is True
        # Nothing in a response names a storage location.
        assert "blob" not in json.dumps(detail) and "attachments" not in json.dumps(detail)

        # The stored file is named by a server-generated ID, never by the upload's name.
        [stored] = stored_files(settings_open)
        assert stored.parent.name == document["workspace_id"]
        uuid.UUID(stored.name)
        assert stored.read_bytes() == PDF
        assert oct(stored.stat().st_mode & 0o777) == "0o600"

        download = client.get(f"{ws}/documents/{document['id']}/file", headers=ada)
        assert download.status_code == 200
        assert download.content == PDF
        assert download.headers["content-type"] == "application/pdf"
        assert download.headers["content-disposition"].startswith("attachment;")
        assert "My%20passport.pdf" in download.headers["content-disposition"]
        assert download.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in download.headers["content-security-policy"]
        assert "no-store" in download.headers["cache-control"]

    def test_downloads_need_a_session(self, client: TestClient, ws: str, ada: Headers) -> None:
        document = upload(client, ws, ada)["document"]
        assert client.get(f"{ws}/documents/{document['id']}/file").status_code == 401

    def test_accepted_types_and_detection(self, client: TestClient, ws: str, ada: Headers) -> None:
        cases = [
            ("scan.png", PNG, "image/png"),
            ("photo.jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 16, "image/jpeg"),
            ("photo.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
            ("notes.txt", b"plain text", "text/plain"),
            ("data.csv", b"a,b\n1,2\n", "text/csv"),
            ("letter.docx", office("word/document.xml"), "wordprocessingml"),
            ("sheet.xlsx", office("xl/workbook.xml"), "spreadsheetml"),
            ("deck.pptx", office("ppt/presentation.xml"), "presentationml"),
        ]
        for filename, data, expected in cases:
            document = upload(client, ws, ada, filename=filename, data=data)["document"]
            assert expected in document["file"]["content_type"], filename

    @pytest.mark.parametrize(
        ("filename", "data"),
        [
            ("page.html", b"<script>alert(1)</script>"),
            ("image.svg", b"<svg onload='alert(1)'/>"),
            ("tool.exe", b"MZ\x90\x00"),
            ("no-extension", PDF),
            ("fake.pdf", b"<html>not a pdf</html>"),
            ("fake.png", PDF),
            ("binary.txt", b"text\x00with nul"),
            # A ZIP that isn't a Word document.
            ("fake.docx", office("other.xml")),
            ("truncated.docx", b"PK\x03\x04garbage"),
        ],
    )
    def test_rejected_files(
        self,
        client: TestClient,
        ws: str,
        ada: Headers,
        settings_open: Settings,
        filename: str,
        data: bytes,
    ) -> None:
        response = client.post(
            f"{ws}/documents/upload", params={"filename": filename}, content=data, headers=ada
        )
        assert response.status_code == 415, response.text
        # Nothing is left behind.
        assert stored_files(settings_open) == []
        assert client.get(f"{ws}/documents", headers=ada).json()["total"] == 0

    def test_size_limit_and_empty_files(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        too_big = PDF + b"0" * settings_open.document_max_bytes
        url = f"{ws}/documents/upload"
        response = client.post(url, params={"filename": "big.pdf"}, content=too_big, headers=ada)
        assert response.status_code == 413
        empty = client.post(url, params={"filename": "empty.pdf"}, content=b"", headers=ada)
        assert empty.status_code == 422
        assert stored_files(settings_open) == []
        limits = client.get(f"{ws}/documents/settings", headers=ada).json()
        assert limits["max_bytes"] == settings_open.document_max_bytes
        assert "pdf" in limits["accepted_extensions"]
        assert "svg" not in limits["accepted_extensions"]

    def test_file_names_are_names_not_paths(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        for filename in ("../../etc/passwd.pdf", "..\\..\\boot.pdf", "/abs/path/x.pdf"):
            document = upload(client, ws, ada, filename=filename)["document"]
            assert "/" not in document["file"]["filename"]
            assert "\\" not in document["file"]["filename"]
            assert not document["file"]["filename"].startswith(".")
        # Every file is inside the workspace's folder, named by ID.
        root = settings_open.attachments_dir.resolve()
        for path in stored_files(settings_open):
            assert path.resolve().parent.parent == root
            uuid.UUID(path.name)

    def test_same_names_never_collide(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        first = upload(client, ws, ada, filename="scan.pdf", data=PDF + b"1")["document"]
        second = upload(client, ws, ada, filename="scan.pdf", data=PDF + b"2")["document"]
        assert first["id"] != second["id"]
        assert len(stored_files(settings_open)) == 2
        assert client.get(f"{ws}/documents/{first['id']}/file", headers=ada).content == PDF + b"1"
        assert client.get(f"{ws}/documents/{second['id']}/file", headers=ada).content == PDF + b"2"

    def test_failed_metadata_save_removes_the_file(
        self,
        client: TestClient,
        ws: str,
        ada: Headers,
        settings_open: Settings,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def fail(*_: object) -> None:
            raise ConflictError

        monkeypatch.setattr(SqlDocumentStore, "add_version", fail)
        response = client.post(
            f"{ws}/documents/upload", params={"filename": "a.pdf"}, content=PDF, headers=ada
        )
        assert response.status_code == 409
        assert stored_files(settings_open) == []
        assert query(settings_open.sqlite_path, "SELECT count(*) FROM documents") == [(0,)]

    def test_upload_into_a_folder_and_category(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        folder = client.post(f"{ws}/document-folders", json={"name": "IDs"}, headers=ada).json()
        categories = client.get(f"{ws}/document-categories", headers=ada).json()["categories"]
        identity = next(c for c in categories if c["name"] == "Identity Documents")
        document = upload(
            client,
            ws,
            ada,
            title="Passport",
            folder_id=folder["id"],
            category_id=identity["id"],
        )["document"]
        assert (document["title"], document["folder_id"], document["category_id"]) == (
            "Passport",
            folder["id"],
            identity["id"],
        )
        missing = client.post(
            f"{ws}/documents/upload",
            params={"filename": "a.pdf", "folder_id": str(uuid.uuid4())},
            content=PDF,
            headers=ada,
        )
        assert missing.status_code == 422


class TestMetadata:
    def test_metadata_only_documents(self, client: TestClient, ws: str, ada: Headers) -> None:
        detail = create(
            client,
            ws,
            ada,
            reference_number="P1234567",
            issuing_authority="Passport Office",
            issue_date="2020-01-01",
            expiry_date="2030-01-01",
            amount=150000,
            currency="INR",
            custom_fields=[{"label": "Place of issue", "value": "Chennai"}],
            tags=["Travel", "travel ", "ID"],
        )
        document = detail["document"]
        assert document["file"] is None
        assert document["version_count"] == 0
        assert document["reference_number"] == "P1234567"
        assert document["custom_fields"] == [{"label": "Place of issue", "value": "Chennai"}]
        assert document["tags"] == ["ID", "Travel"]
        assert document["reminder_days"] == [30, 7, 0]
        assert document["timezone"] == "UTC"
        assert detail["versions"] == []
        # Without a file there's nothing to download.
        file = client.get(f"{ws}/documents/{document['id']}/file", headers=ada)
        assert file.status_code == 404

    def test_validation(self, client: TestClient, ws: str, ada: Headers) -> None:
        url = f"{ws}/documents"
        bad = [
            {"title": ""},
            {"title": "x" * 201},
            {"title": "Tab\x07"},
            {"title": "A", "amount": 100},
            {"title": "A", "issue_date": "2030-01-02", "expiry_date": "2030-01-01"},
            {"title": "A", "reminder_days": [7, 7]},
            {"title": "A", "reminder_days": [400]},
            {"title": "A", "timezone": "Mars/Base"},
            {"title": "A", "workspace_id": str(uuid.uuid4())},
            {"title": "A", "tags": ["x" * 51]},
        ]
        for body in bad:
            assert client.post(url, json=body, headers=ada).status_code == 422, body

    def test_update_rename_and_clear(self, client: TestClient, ws: str, ada: Headers) -> None:
        detail = create(client, ws, ada, provider="Acme", expiry_date="2031-01-01")
        updated = patch(
            client,
            ws,
            ada,
            detail,
            title="Renamed",
            description="Blue cover",
            provider=None,
            expiry_date=None,
            is_favorite=True,
            tags=["Kept"],
            reminder_days=[15, 0],
        )["document"]
        assert updated["title"] == "Renamed"
        assert updated["description"] == "Blue cover"
        assert updated["provider"] is None
        assert updated["expiry_date"] is None
        assert updated["is_favorite"] is True
        assert updated["tags"] == ["Kept"]
        assert updated["reminder_days"] == [15, 0]
        url = f"{ws}/documents/{updated['id']}"
        assert client.patch(url, json={}, headers=ada).status_code == 422
        assert client.patch(url, json={"title": None}, headers=ada).status_code == 422

    def test_sensitive_details_stay_out_of_lists_and_search(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        create(client, ws, ada, reference_number="SECRET-123", notes="Kept in the safe")
        listed = client.get(f"{ws}/documents", headers=ada).json()["documents"][0]
        for field in ("reference_number", "notes", "amount", "custom_fields"):
            assert field not in listed
        assert "SECRET-123" not in json.dumps(listed)
        assert titles(client, ws, ada, q="SECRET-123") == []
        overview = client.get(f"{ws}/documents/overview", headers=ada).json()
        assert "SECRET-123" not in json.dumps(overview)
        # A reminder never carries the reference number either.
        assert all("SECRET" not in json.dumps(r) for r in managed(client, ws, ada))


class TestOrganization:
    def test_categories_defaults_custom_and_delete(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        url = f"{ws}/document-categories"
        categories = client.get(url, headers=ada).json()["categories"]
        assert len(categories) == 14
        assert categories[0]["name"] == "Identity Documents"
        assert categories[-1]["name"] == "Other"
        # Listing again doesn't add more.
        assert len(client.get(url, headers=ada).json()["categories"]) == 14

        pets = client.post(url, json={"name": "Pets", "icon": "heart-pulse"}, headers=ada)
        assert pets.status_code == 201
        assert client.post(url, json={"name": " pets "}, headers=ada).status_code == 409
        renamed = client.patch(
            f"{url}/{pets.json()['id']}", json={"name": "Pet records"}, headers=ada
        )
        assert renamed.json()["name"] == "Pet records"
        insurance = next(c for c in categories if c["name"] == "Insurance")
        taken = client.patch(f"{url}/{pets.json()['id']}", json={"name": "insurance"}, headers=ada)
        assert taken.status_code == 409

        detail = create(client, ws, ada, category_id=insurance["id"])
        counts = {
            c["name"]: c["document_count"]
            for c in client.get(url, headers=ada).json()["categories"]
        }
        assert counts["Insurance"] == 1
        assert client.delete(f"{url}/{insurance['id']}", headers=ada).status_code == 204
        document = client.get(f"{ws}/documents/{detail['document']['id']}", headers=ada).json()
        assert document["document"]["category_id"] is None
        assert client.delete(f"{url}/{insurance['id']}", headers=ada).status_code == 404

    def test_folders_nest_move_and_refuse_cycles(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        url = f"{ws}/document-folders"
        top = client.post(url, json={"name": "Home"}, headers=ada).json()
        child = client.post(url, json={"name": "Car", "parent_id": top["id"]}, headers=ada).json()
        grandchild = client.post(
            url, json={"name": "Insurance", "parent_id": child["id"]}, headers=ada
        ).json()
        # A folder can't move into itself or below itself.
        for parent in (top["id"], grandchild["id"]):
            moved = client.patch(f"{url}/{top['id']}", json={"parent_id": parent}, headers=ada)
            assert moved.status_code == 422
        moved = client.patch(f"{url}/{grandchild['id']}", json={"parent_id": None}, headers=ada)
        assert moved.json()["parent_id"] is None
        renamed = client.patch(f"{url}/{child['id']}", json={"name": "Vehicle"}, headers=ada)
        assert renamed.json()["name"] == "Vehicle"
        # Depth is limited.
        parent = top["id"]
        statuses: list[int] = []
        for level in range(9):
            response = client.post(
                url, json={"name": f"L{level}", "parent_id": parent}, headers=ada
            )
            statuses.append(response.status_code)
            if response.status_code == 201:
                parent = response.json()["id"]
        assert statuses[-1] == 422

    def test_moving_documents_and_folder_contents(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        url = f"{ws}/document-folders"
        home = client.post(url, json={"name": "Home"}, headers=ada).json()
        sub = client.post(url, json={"name": "Bills", "parent_id": home["id"]}, headers=ada).json()
        a = create(client, ws, ada, title="A", folder_id=home["id"])
        b = create(client, ws, ada, title="B", folder_id=sub["id"])
        create(client, ws, ada, title="Loose")
        assert titles(client, ws, ada, folder_id=home["id"]) == ["A"]
        assert sorted(titles(client, ws, ada, folder_id=home["id"], include_subfolders=True)) == [
            "A",
            "B",
        ]
        assert titles(client, ws, ada, unfiled=True) == ["Loose"]
        folders = {f["name"]: f for f in client.get(url, headers=ada).json()["folders"]}
        assert folders["Home"]["document_count"] == 1
        moved = patch(client, ws, ada, a, folder_id=sub["id"])
        assert moved["document"]["folder_id"] == sub["id"]
        patch(client, ws, ada, b, folder_id=None)
        assert sorted(titles(client, ws, ada, unfiled=True)) == ["B", "Loose"]

    @pytest.mark.parametrize("mode", ["parent", "unfiled", "folder"])
    def test_deleting_a_folder_keeps_its_documents(
        self, client: TestClient, ws: str, ada: Headers, mode: str
    ) -> None:
        url = f"{ws}/document-folders"
        home = client.post(url, json={"name": "Home"}, headers=ada).json()
        doomed = client.post(url, json={"name": "Old", "parent_id": home["id"]}, headers=ada).json()
        inner = client.post(
            url, json={"name": "Inner", "parent_id": doomed["id"]}, headers=ada
        ).json()
        other = client.post(url, json={"name": "Other"}, headers=ada).json()
        a = create(client, ws, ada, title="A", folder_id=doomed["id"])
        b = create(client, ws, ada, title="B", folder_id=inner["id"])
        trashed = create(client, ws, ada, title="T", folder_id=doomed["id"])
        client.post(f"{ws}/documents/{trashed['document']['id']}/trash", headers=ada)

        params: dict[str, str] = {"documents": mode}
        if mode == "folder":
            params["target_id"] = other["id"]
        response = client.delete(f"{url}/{doomed['id']}", params=params, headers=ada)
        assert response.status_code == 204, response.text

        def folder_of(detail: Json) -> str | None:
            document = client.get(f"{ws}/documents/{detail['document']['id']}", headers=ada)
            assert document.status_code == 200
            value: str | None = document.json()["document"]["folder_id"]
            return value

        remaining = {f["id"] for f in client.get(url, headers=ada).json()["folders"]}
        match mode:
            case "parent":
                assert folder_of(a) == home["id"] and folder_of(b) == inner["id"]
                assert inner["id"] in remaining
            case "unfiled":
                assert folder_of(a) is None and folder_of(b) is None
                assert inner["id"] not in remaining
            case _:
                assert folder_of(a) == other["id"] and folder_of(b) == other["id"]
        assert folder_of(trashed) in (home["id"], None, other["id"])
        assert doomed["id"] not in remaining

    def test_folder_delete_needs_a_valid_target(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        url = f"{ws}/document-folders"
        home = client.post(url, json={"name": "Home"}, headers=ada).json()
        sub = client.post(url, json={"name": "Sub", "parent_id": home["id"]}, headers=ada).json()
        into_itself = {"documents": "folder", "target_id": sub["id"]}
        assert (
            client.delete(f"{url}/{home['id']}", params=into_itself, headers=ada).status_code == 422
        )
        assert (
            client.delete(
                f"{url}/{home['id']}", params={"documents": "folder"}, headers=ada
            ).status_code
            == 422
        )
        unknown = client.delete(
            f"{url}/{uuid.uuid4()}", params={"documents": "parent"}, headers=ada
        )
        assert unknown.status_code == 404


class TestSearchAndFilters:
    def test_search_across_fields(self, client: TestClient, ws: str, ada: Headers) -> None:
        folder = client.post(f"{ws}/document-folders", json={"name": "Garage"}, headers=ada).json()
        categories = client.get(f"{ws}/document-categories", headers=ada).json()["categories"]
        vehicle = next(c for c in categories if c["name"] == "Vehicle Documents")
        upload(client, ws, ada, filename="rc_book_scan.pdf", title="Registration")
        create(client, ws, ada, title="Policy", provider="Shield Insurance Co", tags=["Car"])
        create(client, ws, ada, title="Pollution", folder_id=folder["id"])
        create(client, ws, ada, title="Permit", category_id=vehicle["id"], description="Blue")
        assert titles(client, ws, ada, q="rc_book") == ["Registration"]
        assert titles(client, ws, ada, q="shield") == ["Policy"]
        assert titles(client, ws, ada, q="car") == ["Policy"]
        assert titles(client, ws, ada, q="garage") == ["Pollution"]
        assert titles(client, ws, ada, q="vehicle blue") == ["Permit"]
        assert titles(client, ws, ada, q="vehicle red") == []
        # LIKE wildcards are literal.
        assert titles(client, ws, ada, q="%") == []

    def test_filters_sorting_and_paging(self, client: TestClient, ws: str, ada: Headers) -> None:
        upload(client, ws, ada, filename="big.pdf", data=PDF + b"x" * 500, title="Big")
        upload(client, ws, ada, filename="pic.png", data=PNG, title="Picture")
        soon = create(client, ws, ada, title="Soon", expiry_date=days(5), tags=["Urgent"])
        create(client, ws, ada, title="Later", expiry_date=days(60), renewal_date=days(20))
        create(client, ws, ada, title="Gone", expiry_date=days(-3))
        patch(client, ws, ada, soon, is_favorite=True)

        assert titles(client, ws, ada, file_kind="pdf") == ["Big"]
        assert titles(client, ws, ada, file_kind="image") == ["Picture"]
        assert sorted(titles(client, ws, ada, file_kind="none")) == ["Gone", "Later", "Soon"]
        assert titles(client, ws, ada, favorite=True) == ["Soon"]
        assert titles(client, ws, ada, tag="urgent") == ["Soon"]
        assert titles(client, ws, ada, expires_within=7) == ["Soon"]
        assert titles(client, ws, ada, expires_within=90, sort="expiry") == ["Soon", "Later"]
        assert titles(client, ws, ada, expired=True) == ["Gone"]
        assert titles(client, ws, ada, renewal_within=30) == ["Later"]
        assert titles(client, ws, ada, sort="size")[:2] == ["Big", "Picture"]
        assert titles(client, ws, ada, sort="expiry")[:3] == ["Gone", "Soon", "Later"]
        assert titles(client, ws, ada, sort="title") == ["Big", "Gone", "Later", "Picture", "Soon"]
        assert titles(client, ws, ada, added_from=today().isoformat()) != []
        assert titles(client, ws, ada, added_to=days(-1)) == []
        page = client.get(
            f"{ws}/documents", params={"sort": "title", "limit": 2, "offset": 2}, headers=ada
        ).json()
        assert page["total"] == 5
        assert [d["title"] for d in page["documents"]] == ["Later", "Picture"]

        statuses = {
            d["title"]: d["expiry_status"]
            for d in client.get(f"{ws}/documents", headers=ada).json()["documents"]
        }
        assert statuses == {
            "Big": "none",
            "Picture": "none",
            "Soon": "expiring",
            "Later": "valid",
            "Gone": "expired",
        }
        counts = client.get(f"{ws}/documents/counts", headers=ada).json()
        assert (counts["all"], counts["expiring_7"], counts["expiring_90"]) == (5, 1, 2)
        assert (counts["expired"], counts["renewals"], counts["without_file"]) == (1, 1, 3)
        assert counts["total_bytes"] == len(PDF) + 500 + len(PNG)

    def test_overview(self, client: TestClient, ws: str, ada: Headers) -> None:
        create(client, ws, ada, title="Soon", expiry_date=days(10))
        create(client, ws, ada, title="Gone", expiry_date=days(-1))
        overview = client.get(f"{ws}/documents/overview", headers=ada).json()
        assert overview["counts"]["all"] == 2
        assert [d["title"] for d in overview["expiring"]] == ["Soon"]
        assert [d["title"] for d in overview["expired"]] == ["Gone"]
        assert len(overview["recently_added"]) == 2
        assert len(overview["categories"]) == 14


class TestLifecycle:
    def test_archive_trash_restore_and_delete(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        detail = upload(client, ws, ada)
        document_id = detail["document"]["id"]
        url = f"{ws}/documents/{document_id}"

        archived = patch(client, ws, ada, detail, archived=True)["document"]
        assert archived["state"] == "archived"
        assert titles(client, ws, ada) == []
        assert titles(client, ws, ada, state="archived") == ["passport"]
        patch(client, ws, ada, detail, archived=False)

        # Only trashed documents can be deleted for good.
        assert client.delete(url, headers=ada).status_code == 409
        trashed = client.post(f"{url}/trash", headers=ada).json()["document"]
        assert trashed["state"] == "trashed"
        assert titles(client, ws, ada, state="trashed") == ["passport"]
        # Trashed documents are read-only.
        assert client.patch(url, json={"title": "X"}, headers=ada).status_code == 409
        restored = client.post(f"{url}/restore", headers=ada).json()["document"]
        assert restored["state"] == "active"
        # Trashing keeps the file until permanent deletion.
        client.post(f"{url}/trash", headers=ada)
        assert len(stored_files(settings_open)) == 1
        assert client.get(f"{url}/file", headers=ada).status_code == 200
        assert client.delete(url, headers=ada).status_code == 204
        assert client.get(url, headers=ada).status_code == 404
        assert stored_files(settings_open) == []

    def test_empty_trash(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        for name in ("a.pdf", "b.pdf"):
            document = upload(client, ws, ada, filename=name, data=PDF + name.encode())["document"]
            client.post(f"{ws}/documents/{document['id']}/trash", headers=ada)
        kept = upload(client, ws, ada, filename="kept.pdf")["document"]
        response = client.post(f"{ws}/documents/empty-trash", headers=ada)
        assert response.json() == {"deleted": 2}
        assert titles(client, ws, ada) == ["kept"]
        assert len(stored_files(settings_open)) == 1
        assert client.get(f"{ws}/documents/{kept['id']}/file", headers=ada).status_code == 200

    def test_opening_feeds_recent(self, client: TestClient, ws: str, ada: Headers) -> None:
        old = create(client, ws, ada, title="Old")
        create(client, ws, ada, title="New")
        url = f"{ws}/documents/{old['document']['id']}/open"
        assert client.post(url, headers=ada).status_code == 204
        assert titles(client, ws, ada, sort="recent")[0] == "Old"


class TestVersions:
    def test_replace_history_download_and_restore(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        detail = upload(client, ws, ada, filename="policy-2024.pdf", data=PDF + b"v1")
        document_id = detail["document"]["id"]
        url = f"{ws}/documents/{document_id}"
        second = new_version(client, ws, ada, detail, "policy-2025.pdf", PDF + b"v2")
        assert second["document"]["version_count"] == 2
        assert second["document"]["file"]["filename"] == "policy-2025.pdf"
        assert [v["number"] for v in second["versions"]] == [2, 1]
        assert [v["is_current"] for v in second["versions"]] == [True, False]
        assert client.get(f"{url}/file", headers=ada).content == PDF + b"v2"
        first = second["versions"][1]
        old = client.get(f"{url}/versions/{first['id']}/file", headers=ada)
        assert old.content == PDF + b"v1"
        assert hashlib.sha256(old.content).hexdigest() == first["sha256"]
        assert len(stored_files(settings_open)) == 2

        restored = client.post(f"{url}/versions/{first['id']}/restore", headers=ada).json()
        assert [v["number"] for v in restored["versions"]] == [3, 2, 1]
        assert restored["versions"][0]["restored_from"] == 1
        assert restored["document"]["file"]["filename"] == "policy-2024.pdf"
        assert client.get(f"{url}/file", headers=ada).content == PDF + b"v1"
        # The restore reuses the stored file rather than copying it.
        assert len(stored_files(settings_open)) == 2

    def test_identical_uploads_are_not_stored_twice(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        detail = upload(client, ws, ada, filename="a.pdf")
        same = new_version(client, ws, ada, detail, "a.pdf", PDF)
        assert same["document"]["version_count"] == 1
        renamed = new_version(client, ws, ada, detail, "a-copy.pdf", PDF)
        assert renamed["document"]["version_count"] == 2
        assert len(stored_files(settings_open)) == 1

    def test_deleting_versions(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        detail = upload(client, ws, ada, filename="a.pdf", data=PDF + b"1")
        url = f"{ws}/documents/{detail['document']['id']}"
        latest = new_version(client, ws, ada, detail, "b.pdf", PDF + b"2")
        current, first = latest["versions"]
        assert client.delete(f"{url}/versions/{current['id']}", headers=ada).status_code == 422
        # A version whose file another version shares keeps the file.
        client.post(f"{url}/versions/{first['id']}/restore", headers=ada)
        assert client.delete(f"{url}/versions/{first['id']}", headers=ada).status_code == 204
        assert len(stored_files(settings_open)) == 2
        assert client.get(f"{url}/file", headers=ada).content == PDF + b"1"
        assert client.delete(f"{url}/versions/{current['id']}", headers=ada).status_code == 204
        assert len(stored_files(settings_open)) == 1
        versions = client.get(url, headers=ada).json()["versions"]
        assert [v["number"] for v in versions] == [3]
        assert client.get(f"{url}/versions/{uuid.uuid4()}/file", headers=ada).status_code == 404

    def test_first_file_for_a_metadata_only_document(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        detail = create(client, ws, ada)
        updated = new_version(client, ws, ada, detail, "scan.png", PNG)
        assert updated["document"]["file"]["content_type"] == "image/png"
        assert updated["document"]["title"] == "Passport"

    def test_trashed_documents_take_no_versions(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        detail = upload(client, ws, ada)
        url = f"{ws}/documents/{detail['document']['id']}"
        client.post(f"{url}/trash", headers=ada)
        response = client.post(
            f"{url}/versions", params={"filename": "b.pdf"}, content=PDF + b"b", headers=ada
        )
        assert response.status_code == 409


class TestRemindersAndRenewals:
    def test_expiry_creates_one_managed_reminder(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        detail = create(client, ws, ada, expiry_date="2030-03-31", reminder_days=[30, 0])
        [reminder] = managed(client, ws, ada)
        assert reminder["commitment"]["id"] == detail["document"]["id"]
        assert reminder["title"] == "Passport expires in 30 days"
        assert reminder["next_occurrence_at"] == "2030-03-01T09:00:00Z"
        assert detail["next_reminder_at"] == "2030-03-01T09:00:00Z"

        # Changing the date re-points the same reminder; nothing is duplicated.
        patch(client, ws, ada, detail, expiry_date="2030-06-30")
        patch(client, ws, ada, detail, title="Old passport")
        [moved] = managed(client, ws, ada)
        assert moved["id"] == reminder["id"]
        assert moved["next_occurrence_at"] == "2030-05-31T09:00:00Z"
        assert moved["title"] == "Old passport expires in 30 days"

        # It can't be edited or deleted through the reminders API.
        url = f"{ws}/reminders/{reminder['id']}"
        assert client.patch(url, json={"title": "x"}, headers=ada).status_code == 409
        assert client.delete(url, headers=ada).status_code == 409

    def test_timing_time_zone_and_review_dates(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        create(
            client,
            ws,
            ada,
            title="Will",
            review_date="2030-07-01",
            reminder_days=[0],
            reminder_time="08:30",
            timezone="Asia/Kolkata",
        )
        [reminder] = managed(client, ws, ada)
        assert reminder["title"] == "Will is due for review today"
        assert reminder["next_occurrence_at"] == "2030-07-01T03:00:00Z"

    def test_archive_trash_and_empty_days_cancel_reminders(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        detail = create(client, ws, ada, expiry_date="2030-03-31")
        url = f"{ws}/documents/{detail['document']['id']}"
        assert len(managed(client, ws, ada)) == 1
        patch(client, ws, ada, detail, archived=True)
        assert managed(client, ws, ada) == []
        patch(client, ws, ada, detail, archived=False)
        assert len(managed(client, ws, ada)) == 1
        client.post(f"{url}/trash", headers=ada)
        assert managed(client, ws, ada) == []
        client.post(f"{url}/restore", headers=ada)
        patch(client, ws, ada, detail, reminder_days=[])
        assert managed(client, ws, ada) == []
        # Alerts already in the past aren't sent late.
        patch(client, ws, ada, detail, reminder_days=[30], expiry_date=days(3))
        assert managed(client, ws, ada) == []
        # Deleting the document deletes its reminder.
        patch(client, ws, ada, detail, expiry_date="2030-03-31")
        client.post(f"{url}/trash", headers=ada)
        client.post(f"{url}/restore", headers=ada)
        assert len(managed(client, ws, ada)) == 1
        client.post(f"{url}/trash", headers=ada)
        client.delete(url, headers=ada)
        assert managed(client, ws, ada) == []

    def test_renewal_keeps_history_and_moves_reminders(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        detail = create(
            client, ws, ada, issue_date="2020-04-01", expiry_date="2030-03-31", reminder_days=[0]
        )
        url = f"{ws}/documents/{detail['document']['id']}/renew"
        renewed = client.post(
            url,
            json={"expiry_date": "2040-03-31", "issue_date": "2030-03-15", "note": "Renewed"},
            headers=ada,
        )
        assert renewed.status_code == 200, renewed.text
        body = renewed.json()
        assert body["document"]["expiry_date"] == "2040-03-31"
        assert body["document"]["issue_date"] == "2030-03-15"
        [history] = body["renewals"]
        assert history["previous_expiry_date"] == "2030-03-31"
        assert history["previous_issue_date"] == "2020-04-01"
        assert history["note"] == "Renewed"
        [reminder] = managed(client, ws, ada)
        assert reminder["next_occurrence_at"] == "2040-03-31T09:00:00Z"
        bad = client.post(url, json={"expiry_date": "2000-01-01"}, headers=ada)
        assert bad.status_code == 422


@pytest.fixture
async def database(settings_open: Settings) -> AsyncIterator[Database]:
    database = await open_database(settings_open)
    yield database
    await database.dispose()


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.mark.anyio
async def test_worker_delivers_and_moves_to_the_next_alert(
    client: TestClient, ws: str, ada: Headers, database: Database
) -> None:
    create(client, ws, ada, expiry_date="2030-03-31", reminder_days=[30, 7])
    clock = Clock(datetime(2030, 3, 1, 9, 0, 30, tzinfo=UTC))
    worker = ReminderWorker(database, clock=clock)
    report = await worker.run_once()
    assert report.claimed == 1
    inbox = client.get("/api/v1/me/notifications", headers=ada).json()["notifications"]
    assert [n["title"] for n in inbox] == ["Passport expires in 30 days"]
    [reminder] = managed(client, ws, ada)
    assert reminder["next_occurrence_at"] == "2030-03-24T09:00:00Z"
    assert reminder["title"] == "Passport expires in 7 days"
    assert (await worker.run_once()).claimed == 0

    clock.now = datetime(2030, 3, 24, 9, 1, tzinfo=UTC)
    assert (await worker.run_once()).claimed == 1
    # No alerts are left, so the reminder is gone; its notifications stay.
    assert managed(client, ws, ada) == []
    inbox = client.get("/api/v1/me/notifications", headers=ada).json()["notifications"]
    assert len(inbox) == 2


class TestLinks:
    def test_link_records_from_other_modules(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        detail = create(client, ws, ada, title="Car insurance")
        document_id = detail["document"]["id"]
        task = client.post(f"{ws}/tasks", json={"title": "Renew insurance"}, headers=ada).json()
        note = client.post(f"{ws}/notes", json={"title": "Claim notes"}, headers=ada).json()
        event = client.post(
            f"{ws}/calendar/events",
            json={
                "title": "Garage visit",
                "start": "2030-01-14T09:00",
                "end": "2030-01-14T10:00",
                "timezone": "UTC",
            },
            headers=ada,
        ).json()
        asset = client.post(
            f"{ws}/finance/assets", json={"name": "Hatchback", "category": "vehicle"}, headers=ada
        )
        assert asset.status_code == 201, asset.text
        targets = [
            ("task", task["id"]),
            ("note", note["id"]),
            ("event", event["id"]),
            ("asset", asset.json()["id"]),
        ]
        for kind, target in targets:
            url = f"{ws}/documents/{document_id}/links/{kind}/{target}"
            assert client.put(url, headers=ada).status_code == 204
            assert client.put(url, headers=ada).status_code == 204  # idempotent
        links = client.get(f"{ws}/documents/{document_id}", headers=ada).json()["links"]
        assert sorted((link["kind"], link["title"]) for link in links) == [
            ("asset", "Hatchback"),
            ("event", "Garage visit"),
            ("note", "Claim notes"),
            ("task", "Renew insurance"),
        ]
        # From the other side: documents linked to a record.
        linked = titles(client, ws, ada, linked_kind="task", linked_id=task["id"])
        assert linked == ["Car insurance"]
        # Unlinking, and deleting the record, remove links.
        url = f"{ws}/documents/{document_id}/links/note/{note['id']}"
        assert client.delete(url, headers=ada).status_code == 204
        client.delete(f"{ws}/tasks/{task['id']}", headers=ada)
        links = client.get(f"{ws}/documents/{document_id}", headers=ada).json()["links"]
        assert sorted(link["kind"] for link in links) == ["asset", "event"]

    def test_unknown_records_and_candidates(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        detail = create(client, ws, ada)
        url = f"{ws}/documents/{detail['document']['id']}/links"
        assert client.put(f"{url}/task/{uuid.uuid4()}", headers=ada).status_code == 422
        assert client.put(f"{url}/spaceship/{uuid.uuid4()}", headers=ada).status_code == 422
        client.post(f"{ws}/tasks", json={"title": "Pay premium"}, headers=ada)
        client.post(f"{ws}/tasks", json={"title": "Water plants"}, headers=ada)
        candidates = client.get(
            f"{ws}/documents/link-candidates", params={"kind": "task", "q": "premium"}, headers=ada
        ).json()["records"]
        assert [c["title"] for c in candidates] == ["Pay premium"]


class TestIsolation:
    def test_other_workspaces_cannot_reach_documents(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        detail = upload(client, ws, ada)
        document_id = detail["document"]["id"]
        version_id = detail["versions"][0]["id"]
        folder = client.post(f"{ws}/document-folders", json={"name": "Mine"}, headers=ada).json()
        theirs = personal(client, grace)

        # Through Ada's workspace URL: the workspace itself is refused.
        assert client.get(f"{ws}/documents/{document_id}", headers=grace).status_code == 404
        assert client.get(f"{ws}/documents/{document_id}/file", headers=grace).status_code == 404
        assert client.get(f"{ws}/documents", headers=grace).status_code == 404
        # Through Grace's own workspace: Ada's IDs behave like missing ones.
        for path in (
            f"/documents/{document_id}",
            f"/documents/{document_id}/file",
            f"/documents/{document_id}/versions/{version_id}/file",
        ):
            assert client.get(f"{theirs}{path}", headers=grace).status_code == 404, path
        assert (
            client.patch(
                f"{theirs}/documents/{document_id}", json={"title": "Mine now"}, headers=grace
            ).status_code
            == 404
        )
        assert (
            client.post(f"{theirs}/documents/{document_id}/trash", headers=grace).status_code == 404
        )
        assert client.get(f"{theirs}/documents", headers=grace).json()["total"] == 0
        # Grace can't file her documents into Ada's folder or link Ada's task.
        mine = create(client, theirs, grace, title="Grace's")
        moved = client.patch(
            f"{theirs}/documents/{mine['document']['id']}",
            json={"folder_id": folder["id"]},
            headers=grace,
        )
        assert moved.status_code == 422
        task = client.post(f"{ws}/tasks", json={"title": "Ada's task"}, headers=ada).json()
        link = f"{theirs}/documents/{mine['document']['id']}/links/task/{task['id']}"
        assert client.put(link, headers=grace).status_code == 422
        candidates = client.get(
            f"{theirs}/documents/link-candidates", params={"kind": "task"}, headers=grace
        ).json()["records"]
        assert candidates == []
        exported = client.post(
            f"{theirs}/documents/export", json={"document_ids": [document_id]}, headers=grace
        )
        assert exported.status_code == 404
        # Ada's document is untouched.
        title = client.get(f"{ws}/documents/{document_id}", headers=ada).json()["document"]["title"]
        assert title == "passport"


class TestExport:
    def _archive(self, response: Any) -> zipfile.ZipFile:
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/zip"
        return zipfile.ZipFile(io.BytesIO(response.content))

    def test_export_selected_documents_with_metadata(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        folder = client.post(f"{ws}/document-folders", json={"name": "Car"}, headers=ada).json()
        sub = client.post(
            f"{ws}/document-folders",
            json={"name": "Insurance", "parent_id": folder["id"]},
            headers=ada,
        ).json()
        a = upload(client, ws, ada, filename="scan.pdf", data=PDF + b"a", folder_id=sub["id"])
        b = upload(client, ws, ada, filename="scan.pdf", data=PDF + b"b", folder_id=sub["id"])
        c = create(client, ws, ada, title="No file", reference_number="REF-9")
        new_version(client, ws, ada, a, "scan-v2.pdf", PDF + b"a2")
        ids = [a["document"]["id"], b["document"]["id"], c["document"]["id"]]
        response = client.post(
            f"{ws}/documents/export",
            json={"document_ids": ids, "include_versions": True},
            headers=ada,
        )
        archive = self._archive(response)
        names = sorted(archive.namelist())
        assert "Orbit documents/metadata.json" in names
        assert "Orbit documents/Car/Insurance/scan-v2.pdf" in names
        assert "Orbit documents/Car/Insurance/scan.pdf" in names
        assert "Orbit documents/Car/Insurance/scan-v2 (versions)/v1 scan.pdf" in names
        assert archive.read("Orbit documents/Car/Insurance/scan.pdf") == PDF + b"b"
        metadata = json.loads(archive.read("Orbit documents/metadata.json"))
        assert metadata["format"] == "orbit-documents-v1"
        by_title = {d["title"]: d for d in metadata["documents"]}
        assert by_title["No file"]["reference_number"] == "REF-9"
        assert by_title["No file"]["versions"] == []
        assert by_title["scan"]["folder"] == "Car/Insurance"
        sha = {v["sha256"] for d in metadata["documents"] for v in d["versions"]}
        assert hashlib.sha256(PDF + b"a2").hexdigest() in sha

    def test_export_a_folder_or_category(self, client: TestClient, ws: str, ada: Headers) -> None:
        folder = client.post(f"{ws}/document-folders", json={"name": "Home"}, headers=ada).json()
        sub = client.post(
            f"{ws}/document-folders", json={"name": "Deeds", "parent_id": folder["id"]}, headers=ada
        ).json()
        categories = client.get(f"{ws}/document-categories", headers=ada).json()["categories"]
        tax = next(c for c in categories if c["name"] == "Tax & Compliance")
        upload(client, ws, ada, filename="deed.pdf", folder_id=sub["id"])
        upload(client, ws, ada, filename="return.pdf", data=PDF + b"t", category_id=tax["id"])
        trashed = upload(
            client, ws, ada, filename="old.pdf", data=PDF + b"o", folder_id=folder["id"]
        )
        client.post(f"{ws}/documents/{trashed['document']['id']}/trash", headers=ada)

        by_folder = self._archive(
            client.post(f"{ws}/documents/export", json={"folder_id": folder["id"]}, headers=ada)
        )
        files = [n for n in by_folder.namelist() if not n.endswith("metadata.json")]
        assert files == ["Orbit documents/Home/Deeds/deed.pdf"]
        by_category = self._archive(
            client.post(f"{ws}/documents/export", json={"category_id": tax["id"]}, headers=ada)
        )
        files = [n for n in by_category.namelist() if not n.endswith("metadata.json")]
        assert files == ["Orbit documents/Unfiled/return.pdf"]
        both = client.post(
            f"{ws}/documents/export",
            json={"folder_id": folder["id"], "category_id": tax["id"]},
            headers=ada,
        )
        assert both.status_code == 422


@pytest.mark.anyio
async def test_sweep_removes_only_old_unreferenced_files(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings, database: Database
) -> None:
    kept = upload(client, ws, ada)["document"]
    directory = settings_open.attachments_dir / kept["workspace_id"]
    old = time.time() - 2 * 3600
    stray = directory / str(uuid.uuid4())
    stray.write_bytes(b"left over")
    partial = directory / f"{uuid.uuid4()}.partial"
    partial.write_bytes(b"half")
    fresh = directory / str(uuid.uuid4())
    fresh.write_bytes(b"just uploaded")
    foreign = directory / "README"
    foreign.write_bytes(b"not ours")
    for path in (stray, partial, foreign, *directory.iterdir()):
        if path != fresh:
            os.utime(path, (old, old))

    worker = ReminderWorker(database, files=FileAttachmentStore(settings_open.attachments_dir))
    assert await worker.sweep_files() == 2
    remaining = {p.name for p in directory.iterdir()}
    assert stray.name not in remaining and partial.name not in remaining
    assert {fresh.name, foreign.name} <= remaining
    assert client.get(f"{ws}/documents/{kept['id']}/file", headers=ada).status_code == 200


def test_deleting_a_workspace_deletes_its_files(
    client: TestClient, ada: Headers, settings_open: Settings
) -> None:
    created = client.post(WORKSPACES, json={"name": "Scratch"}, headers=ada)
    workspace = f"{WORKSPACES}/{created.json()['id']}"
    upload(client, workspace, ada)
    assert len(stored_files(settings_open)) == 1
    assert client.delete(workspace, headers=ada).status_code == 204
    assert stored_files(settings_open) == []
