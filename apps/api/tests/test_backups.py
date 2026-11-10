"""Backups, restores, imports, and exports through the API, on a workspace with data in every
module: round trips (IDs, relationships, timestamps, recurrence, money, files), restore
strategies, ID remapping, encryption, damaged and incompatible archives, imports with duplicate
detection, scheduled backups, and workspace isolation."""

import hashlib
import io
import json
import sqlite3
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import anyio
import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import open_database
from orbit_api.main import create_app
from orbit_api.repositories.backup import build_backup_service
from orbit_api.scheduler.worker import BackupJobs, ReminderWorker
from orbit_api.system.attachment_store import FileAttachmentStore
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

Json = dict[str, Any]
Headers = dict[str, str]

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"
PASSWORD = "a long backup password"
WORKSPACES = "/api/v1/workspaces"
# Rows every backup of the populated workspace must restore exactly.
CHECKED_TABLES = (
    "tasks",
    "notes",
    "note_folders",
    "note_tags",
    "note_tag_assignments",
    "note_links",
    "note_attachments",
    "calendar_events",
    "calendar_event_exceptions",
    "calendar_event_alerts",
    "finance_accounts",
    "finance_transactions",
    "documents",
    "document_versions",
    "habits",
    "habit_logs",
    "fitness_measurements",
    "fitness_photos",
    "reminders",
    "shopping_lists",
    "shopping_items",
)


@pytest.fixture
def settings_open(migrated_settings: Settings) -> Settings:
    return migrated_settings.model_copy(update={"local_open_registration": True})


@pytest.fixture
def client(settings_open: Settings) -> Iterator[TestClient]:
    app = create_app(settings_open)
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, "ada@example.com"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, "grace@example.com", display_name="Grace"))


def ok(response: Any, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if code != 204 else None


def personal(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    return personal(client, ada)


def doc(text: str, link_to: str | None = None) -> Json:
    content: list[Json] = [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}
    ]
    if link_to:
        content.append(
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "See "},
                    {
                        "type": "text",
                        "text": "the other note",
                        "marks": [{"type": "link", "attrs": {"href": f"/notes?note={link_to}"}}],
                    },
                ],
            }
        )
    return {"type": "doc", "content": content}


def populate(client: TestClient, ws: str, headers: Headers) -> Json:
    """Data in every module, with relationships between them."""
    admin = ok(client.post(f"{ws}/task-lists", json={"name": "Admin"}, headers=headers), 201)
    task = ok(
        client.post(
            f"{ws}/tasks", json={"title": "File taxes", "list_id": admin["id"]}, headers=headers
        ),
        201,
    )
    folder = ok(
        client.post(
            f"{ws}/note-folders", json={"name": "Projects", "parent_id": None}, headers=headers
        ),
        201,
    )
    sub = ok(
        client.post(
            f"{ws}/note-folders", json={"name": "Orbit", "parent_id": folder["id"]}, headers=headers
        ),
        201,
    )
    target = ok(
        client.post(
            f"{ws}/notes", json={"title": "Target", "content": doc("Target")}, headers=headers
        ),
        201,
    )
    note = ok(
        client.post(
            f"{ws}/notes",
            json={
                "title": "Plan",
                "content": doc("Plan", link_to=target["id"]),
                "folder_id": sub["id"],
                "tags": ["work"],
            },
            headers=headers,
        ),
        201,
    )
    ok(
        client.post(
            f"{ws}/notes/{note['id']}/attachments",
            params={"filename": "photo.png"},
            content=PNG,
            headers={**headers, "Content-Type": "application/octet-stream"},
        ),
        201,
    )
    cal = f"{ws}/calendar"
    event = ok(
        client.post(
            f"{cal}/events",
            json={
                "title": "Rent",
                "start": "2030-01-31T10:00",
                "end": "2030-01-31T10:15",
                "timezone": "Europe/London",
                "recurrence": {"frequency": "monthly"},
                "alerts": [15],
            },
            headers=headers,
        ),
        201,
    )
    ok(
        client.patch(
            f"{cal}/events/{event['id']}/occurrences/2030-02-28T10:00",
            json={"scope": "this", "title": "Rent (late)", "start": "2030-02-28T12:00"},
            headers=headers,
        )
    )
    fin = f"{ws}/finance"
    account = ok(
        client.post(
            f"{fin}/accounts",
            json={"name": "Savings", "type": "bank", "opening_balance": 1_000_050},
            headers=headers,
        ),
        201,
    )
    ok(
        client.post(
            f"{fin}/transactions",
            json={
                "type": "expense",
                "amount": 12_345,
                "occurred_on": "2026-02-11",
                "description": "=SUM(A1)",
                "account_id": account["id"],
            },
            headers=headers,
        ),
        201,
    )
    document = ok(
        client.post(
            f"{ws}/documents/upload",
            params={"filename": "passport.pdf"},
            content=PDF,
            headers={**headers, "Content-Type": "application/octet-stream"},
        ),
        201,
    )
    habit = ok(
        client.post(
            f"{ws}/habits",
            json={
                "name": "Read",
                "schedule": {"type": "daily"},
                "start_date": "2026-01-01",
                "timezone": "UTC",
            },
            headers=headers,
        ),
        201,
    )["habit"]
    ok(client.put(f"{ws}/habits/{habit['id']}/log/2026-01-02", json={}, headers=headers))
    fit = f"{ws}/fitness"
    ok(
        client.post(
            f"{fit}/measurements", json={"day": "2026-01-01", "weight_g": 80_000}, headers=headers
        ),
        201,
    )
    ok(
        client.post(
            f"{fit}/photos?filename=front.png&day=2026-01-01&note=Front",
            content=PNG,
            headers={**headers, "Content-Type": "application/octet-stream"},
        ),
        201,
    )
    ok(
        client.post(
            f"{ws}/reminders",
            json={
                "title": "Pay taxes",
                "start_date": "2030-01-01",
                "time_of_day": "09:00",
                "timezone": "Europe/Paris",
                "task_id": task["id"],
            },
            headers=headers,
        ),
        201,
    )
    ok(client.post(f"{ws}/shopping/lists", json={"name": "Groceries"}, headers=headers), 201)
    return {"task": task, "note": note, "target": target, "event": event, "document": document}


def rows(database: Path, table: str, workspace_id: str) -> list[tuple[Any, ...]]:
    with sqlite3.connect(database) as connection:
        columns = [c[1] for c in connection.execute(f"PRAGMA table_info({table})")]
        select = ", ".join(c for c in columns if c != "workspace_id")
        return sorted(
            connection.execute(
                f"SELECT {select} FROM {table} WHERE workspace_id = ?",
                (workspace_id.replace("-", ""),),
            ).fetchall(),
            key=repr,
        )


def workspace_id(ws: str) -> str:
    return ws.rsplit("/", 1)[-1]


def create_backup(client: TestClient, ws: str, headers: Headers, **body: Any) -> Json:
    backup: Json = ok(client.post(f"{ws}/backups", json=body, headers=headers), 201)
    return backup


def download(client: TestClient, ws: str, headers: Headers, backup_id: str) -> bytes:
    response = client.get(f"{ws}/backups/{backup_id}/download", headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["content-disposition"].startswith("attachment;")
    return response.content


def upload(
    client: TestClient, ws: str, headers: Headers, data: bytes, name: str = "backup.zip"
) -> Json:
    response = client.post(
        f"{ws}/backup-uploads",
        params={"filename": name},
        content=data,
        headers={**headers, "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 201, response.text
    result: Json = response.json()
    return result


def restore(
    client: TestClient, ws: str, headers: Headers, upload_id: str, code: int = 200, **body: Any
) -> Any:
    return ok(
        client.post(f"{ws}/backup-uploads/{upload_id}/restore", json=body, headers=headers), code
    )


def rewrite(data: bytes, change: Any) -> bytes:
    """A copy of a ZIP with `change(name, bytes)` applied to each entry (return None to drop)."""
    source = zipfile.ZipFile(io.BytesIO(data))
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as target:
        for info in source.infolist():
            changed = change(info.filename, source.read(info))
            if changed is not None:
                target.writestr(info.filename, changed)
    return output.getvalue()


class TestBackupRoundTrip:
    def test_a_backup_holds_every_module_with_checksums(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        populate(client, ws, ada)
        backup = create_backup(client, ws, ada)
        assert backup["status"] == "succeeded"
        assert backup["encrypted"] is False
        assert backup["file_count"] == 3  # note attachment, document, progress photo
        assert {"tasks", "notes", "calendar", "finance", "documents", "habits", "fitness"} <= set(
            backup["modules"]
        )
        data = download(client, ws, ada, backup["id"])
        assert hashlib.sha256(data).hexdigest() == backup["sha256"]
        archive = zipfile.ZipFile(io.BytesIO(data))
        manifest = json.loads(archive.read("orbit-backup/manifest.json"))
        assert manifest["format"] == "orbit-backup" and manifest["format_version"] == 1
        assert manifest["schema_revision"] == "0031"
        for name, entry in manifest["tables"].items():
            content = archive.read(f"orbit-backup/database/{name}.jsonl")
            assert hashlib.sha256(content).hexdigest() == entry["sha256"]
            assert len(content.splitlines()) == entry["rows"]
        for entry in manifest["files"]:
            content = archive.read(f"orbit-backup/files/{entry['id']}")
            assert hashlib.sha256(content).hexdigest() == entry["sha256"]
        # Secrets and other people's data never go in.
        names = set(manifest["tables"])
        assert not names & {
            "local_credentials",
            "local_sessions",
            "users",
            "ai_providers",
            "integration_connections",
        }
        # Money stays integer minor units; times keep their offsets or local wall-clock form.
        transactions = [
            json.loads(line)
            for line in archive.read(
                "orbit-backup/database/finance_transactions.jsonl"
            ).splitlines()
        ]
        assert transactions[0]["amount"] == 12_345
        events = [
            json.loads(line)
            for line in archive.read("orbit-backup/database/calendar_events.jsonl").splitlines()
        ]
        assert events[0]["start_local"] == "2030-01-31T10:00:00"
        assert events[0]["start_at"].endswith("+00:00")
        assert events[0]["recurrence"]["frequency"] == "monthly"

    def test_restoring_into_a_new_workspace_reproduces_everything(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        populate(client, ws, ada)
        backup = create_backup(client, ws, ada)
        data = download(client, ws, ada, backup["id"])
        staged = upload(client, ws, ada, data)
        assert staged["kind"] == "backup" and staged["encrypted"] is False

        inspection = ok(
            client.post(f"{ws}/backup-uploads/{staged['id']}/inspect", json={}, headers=ada)
        )
        assert inspection["compatible"] is True, inspection["issues"]
        assert inspection["summary"]["file_count"] == 3
        assert inspection["dry_run"]["dry_run"] is True
        # The original still exists, so every ID would clash: the copy gets new ones.
        assert inspection["dry_run"]["remapped"] > 0

        report = restore(
            client, ws, ada, staged["id"], strategy="new_workspace", workspace_name="Copy"
        )
        assert report["files_restored"] == 3 and report["files_missing"] == 0
        assert report["totals"]["skipped"] == 0
        copy = f"{WORKSPACES}/{report['workspace_id']}"
        assert report["workspace_id"] != workspace_id(ws)

        source_id, copy_id = workspace_id(ws), report["workspace_id"]
        for table in ("tasks", "finance_transactions", "habit_logs", "calendar_event_exceptions"):
            assert len(rows(settings_open.sqlite_path, table, copy_id)) == len(
                rows(settings_open.sqlite_path, table, source_id)
            ), table
        # Relationships follow the new IDs: the note's link, its folder path, tag, and file.
        notes = ok(client.get(f"{copy}/notes", headers=ada))["notes"]
        plan = next(n for n in notes if n["title"] == "Plan")
        target = next(n for n in notes if n["title"] == "Target")
        detail = ok(client.get(f"{copy}/notes/{plan['id']}", headers=ada))
        assert target["id"] in json.dumps(detail["content"])
        assert [t["name"] for t in detail["tags"]] == ["work"]
        attachments = ok(client.get(f"{copy}/notes/{plan['id']}/attachments", headers=ada))[
            "attachments"
        ]
        file = client.get(
            f"{copy}/notes/{plan['id']}/attachments/{attachments[0]['id']}", headers=ada
        )
        assert file.status_code == 200 and file.content == PNG
        documents = ok(client.get(f"{copy}/documents", headers=ada))["documents"]
        assert client.get(f"{copy}/documents/{documents[0]['id']}/file", headers=ada).content == PDF
        # Recurrence and its exception survive.
        view = ok(
            client.get(
                f"{copy}/calendar/range",
                params={"start": "2030-02-01", "end": "2030-04-01", "timezone": "Europe/London"},
                headers=ada,
            )
        )
        assert [(o["title"], o["start"]) for o in view["occurrences"]] == [
            ("Rent (late)", "2030-02-28T12:00:00"),
            ("Rent", "2030-03-31T10:00:00"),
        ]
        # The original is untouched.
        assert len(ok(client.get(f"{ws}/notes", headers=ada))["notes"]) == 2
        history = ok(client.get(f"{ws}/backups", headers=ada))["uploads"]
        assert history[0]["status"] == "completed"
        assert history[0]["result"]["workspace_id"] == copy_id

    def test_restoring_after_the_workspace_is_gone_keeps_original_ids(
        self, client: TestClient, ada: Headers
    ) -> None:
        home = personal(client, ada)
        work = ok(client.post(WORKSPACES, json={"name": "Work"}, headers=ada), 201)
        ws = f"{WORKSPACES}/{work['id']}"
        made = populate(client, ws, ada)
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        ok(client.delete(ws, headers=ada), 204)

        staged = upload(client, home, ada, data)
        report = restore(client, home, ada, staged["id"], strategy="new_workspace")
        assert report["remapped"] == 0
        copy = f"{WORKSPACES}/{report['workspace_id']}"
        assert (
            ok(client.get(f"{copy}/tasks/{made['task']['id']}", headers=ada))["title"]
            == "File taxes"
        )
        assert ok(client.get(copy, headers=ada))["name"] == "Work (restored)"

    def test_replace_takes_a_pre_restore_backup_and_restores_exactly(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        made = populate(client, ws, ada)
        before = {
            table: rows(settings_open.sqlite_path, table, workspace_id(ws))
            for table in CHECKED_TABLES
        }
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        # Changes after the backup: a new task, a deleted note.
        ok(client.post(f"{ws}/tasks", json={"title": "Later"}, headers=ada), 201)
        ok(client.delete(f"{ws}/tasks/{made['task']['id']}", headers=ada), 204)

        staged = upload(client, ws, ada, data)
        name = ok(client.get(ws, headers=ada))["name"]
        refused = client.post(
            f"{ws}/backup-uploads/{staged['id']}/restore",
            json={"strategy": "replace", "confirm_name": "wrong"},
            headers=ada,
        )
        assert refused.status_code == 409
        report = restore(client, ws, ada, staged["id"], strategy="replace", confirm_name=name)
        assert report["remapped"] == 0
        assert report["pre_restore_backup_id"] is not None
        after = {
            table: rows(settings_open.sqlite_path, table, workspace_id(ws))
            for table in CHECKED_TABLES
        }
        assert after == before
        titles = [t["title"] for t in ok(client.get(f"{ws}/tasks", headers=ada))["tasks"]]
        assert titles == ["File taxes"]
        # The pre-restore backup holds the state that was replaced, and the history survived.
        backups = ok(client.get(f"{ws}/backups", headers=ada))["backups"]
        pre = next(b for b in backups if b["id"] == report["pre_restore_backup_id"])
        assert pre["kind"] == "pre_restore" and pre["status"] == "succeeded"
        assert len(backups) == 2

    def test_into_empty_refuses_a_workspace_with_data(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        populate(client, ws, ada)
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        staged = upload(client, ws, ada, data)
        refused = restore(client, ws, ada, staged["id"], code=409, strategy="into_empty")
        assert "isn't empty" in refused["detail"]
        empty = ok(client.post(WORKSPACES, json={"name": "Empty"}, headers=ada), 201)
        target = f"{WORKSPACES}/{empty['id']}"
        staged = upload(client, target, ada, data)
        report = restore(client, target, ada, staged["id"], strategy="into_empty")
        assert report["workspace_id"] == empty["id"]
        assert len(ok(client.get(f"{target}/tasks", headers=ada))["tasks"]) == 1

    def test_a_backup_without_files_restores_records_and_reports_missing_files(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        populate(client, ws, ada)
        backup = create_backup(client, ws, ada, include_files=False)
        assert backup["file_count"] == 0
        staged = upload(client, ws, ada, download(client, ws, ada, backup["id"]))
        inspection = ok(
            client.post(f"{ws}/backup-uploads/{staged['id']}/inspect", json={}, headers=ada)
        )
        assert any("doesn't include files" in w for w in inspection["warnings"])
        report = restore(client, ws, ada, staged["id"], strategy="new_workspace")
        assert report["files_missing"] == 3 and report["files_restored"] == 0


class TestEncryption:
    def test_password_backups_round_trip_and_refuse_wrong_passwords(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        populate(client, ws, ada)
        backup = create_backup(client, ws, ada, encryption="password", password=PASSWORD)
        assert backup["encrypted"] is True
        data = download(client, ws, ada, backup["id"])
        assert data.startswith(b"ORBITENC")
        assert b"File taxes" not in data and PDF not in data

        verify = ok(client.post(f"{ws}/backups/{backup['id']}/verify", json={}, headers=ada))
        assert verify == {"ok": True, "level": "checksum", "message": verify["message"]}
        full = ok(
            client.post(
                f"{ws}/backups/{backup['id']}/verify", json={"password": PASSWORD}, headers=ada
            )
        )
        assert full["ok"] is True and full["level"] == "full"

        staged = upload(client, ws, ada, data, "backup.orbit-backup")
        assert staged["encrypted"] is True
        missing = client.post(f"{ws}/backup-uploads/{staged['id']}/inspect", json={}, headers=ada)
        assert missing.status_code == 422 and "encrypted" in missing.json()["detail"]
        wrong = client.post(
            f"{ws}/backup-uploads/{staged['id']}/inspect",
            json={"password": "not the password"},
            headers=ada,
        )
        assert (
            wrong.status_code == 422
            and wrong.json()["detail"] == "That password doesn't open this backup."
        )
        restore(
            client,
            ws,
            ada,
            staged["id"],
            code=422,
            strategy="new_workspace",
            password="nope nope nope",
        )
        report = restore(client, ws, ada, staged["id"], strategy="new_workspace", password=PASSWORD)
        assert report["files_restored"] == 3

    def test_automatic_backups_encrypt_with_the_backup_password_without_storing_it(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        populate(client, ws, ada)
        refused = client.put(
            f"{ws}/backups/settings",
            json={
                "frequency": "daily",
                "retention_count": 3,
                "include_files": True,
                "encrypt": True,
            },
            headers=ada,
        )
        assert refused.status_code == 422
        settings = ok(
            client.put(
                f"{ws}/backups/settings",
                json={
                    "frequency": "daily",
                    "retention_count": 3,
                    "include_files": True,
                    "encrypt": True,
                    "password": PASSWORD,
                },
                headers=ada,
            )
        )
        assert settings["has_backup_password"] is True and settings["next_run_at"] is not None
        with sqlite3.connect(settings_open.sqlite_path) as connection:
            stored = connection.execute("SELECT key_material FROM backup_settings").fetchone()[0]
        assert PASSWORD not in stored

        backup = create_backup(client, ws, ada, encryption="backup_key")
        assert backup["encrypted"] is True
        staged = upload(
            client, ws, ada, download(client, ws, ada, backup["id"]), "auto.orbit-backup"
        )
        report = restore(client, ws, ada, staged["id"], strategy="new_workspace", password=PASSWORD)
        assert report["totals"]["added"] > 0

    def test_backup_key_encryption_needs_a_backup_password(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        response = client.post(f"{ws}/backups", json={"encryption": "backup_key"}, headers=ada)
        assert response.status_code == 500
        assert "backup password" in response.json()["detail"]
        assert ok(client.get(f"{ws}/backups", headers=ada))["backups"][0]["status"] == "failed"

    def test_short_passwords_are_refused(self, client: TestClient, ws: str, ada: Headers) -> None:
        response = client.post(
            f"{ws}/backups", json={"encryption": "password", "password": "Tiny-pw"}, headers=ada
        )
        assert response.status_code == 422
        assert "Tiny-pw" not in response.text


class TestDamagedArchives:
    @pytest.fixture
    def archive(self, client: TestClient, ws: str, ada: Headers) -> bytes:
        populate(client, ws, ada)
        return download(client, ws, ada, create_backup(client, ws, ada)["id"])

    def inspect(self, client: TestClient, ws: str, ada: Headers, data: bytes) -> Json:
        staged = upload(client, ws, ada, data)
        inspection: Json = ok(
            client.post(f"{ws}/backup-uploads/{staged['id']}/inspect", json={}, headers=ada)
        )
        return inspection

    def test_a_changed_record_fails_the_checksum(
        self, client: TestClient, ws: str, ada: Headers, archive: bytes
    ) -> None:
        def tamper(name: str, content: bytes) -> bytes:
            return (
                content.replace(b"File taxes", b"File faxes")
                if name.endswith("tasks.jsonl")
                else content
            )

        inspection = self.inspect(client, ws, ada, rewrite(archive, tamper))
        assert inspection["compatible"] is False
        assert "checksum" in inspection["issues"][0]

    def test_a_missing_file_is_refused(
        self, client: TestClient, ws: str, ada: Headers, archive: bytes
    ) -> None:
        def drop(name: str, content: bytes) -> bytes | None:
            return None if "/files/" in name else content

        response = client.post(
            f"{ws}/backup-uploads",
            params={"filename": "b.zip"},
            content=rewrite(archive, drop),
            headers={**ada, "Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 422
        assert "incomplete" in response.json()["detail"]

    @pytest.mark.parametrize(
        "name",
        ["../evil.txt", "orbit-backup/files/../../evil", "/etc/passwd", "orbit-backup/extra.txt"],
    )
    def test_unexpected_or_traversing_paths_are_refused(
        self, client: TestClient, ws: str, ada: Headers, archive: bytes, name: str
    ) -> None:
        output = io.BytesIO(archive)
        with zipfile.ZipFile(output, "a") as target:
            target.writestr(name, b"x")
        response = client.post(
            f"{ws}/backup-uploads",
            params={"filename": "b.zip"},
            content=output.getvalue(),
            headers={**ada, "Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 422
        assert "unexpected" in response.json()["detail"]

    def test_decompression_bombs_are_refused(
        self, client: TestClient, ws: str, ada: Headers, archive: bytes
    ) -> None:
        def bomb(name: str, content: bytes) -> bytes:
            return content + b" " * 5_000_000 if name.endswith("tasks.jsonl") else content

        output = io.BytesIO()
        source = zipfile.ZipFile(io.BytesIO(archive))
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for info in source.infolist():
                target.writestr(info.filename, bomb(info.filename, source.read(info)))
        response = client.post(
            f"{ws}/backup-uploads",
            params={"filename": "b.zip"},
            content=output.getvalue(),
            headers={**ada, "Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 422
        assert "compressed" in response.json()["detail"]

    def test_a_newer_schema_is_incompatible(
        self, client: TestClient, ws: str, ada: Headers, archive: bytes
    ) -> None:
        def newer(name: str, content: bytes) -> bytes:
            if not name.endswith("manifest.json"):
                return content
            manifest = json.loads(content)
            manifest["schema_revision"] = "9999"
            return json.dumps(manifest).encode()

        inspection = self.inspect(client, ws, ada, rewrite(archive, newer))
        assert inspection["compatible"] is False
        assert "newer version" in inspection["issues"][0]

    def test_a_newer_format_is_refused(
        self, client: TestClient, ws: str, ada: Headers, archive: bytes
    ) -> None:
        def newer(name: str, content: bytes) -> bytes:
            if not name.endswith("manifest.json"):
                return content
            return json.dumps({**json.loads(content), "format_version": 2}).encode()

        response = client.post(
            f"{ws}/backup-uploads",
            params={"filename": "b.zip"},
            content=rewrite(archive, newer),
            headers={**ada, "Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 422 and "newer version" in response.json()["detail"]

    def test_files_that_arent_backups_are_refused(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        for data in (b"hello", PDF, b"{not json"):
            response = client.post(
                f"{ws}/backup-uploads",
                params={"filename": "x"},
                content=data,
                headers={**ada, "Content-Type": "application/octet-stream"},
            )
            assert response.status_code == 422, data

    def test_a_tampered_encrypted_backup_is_refused(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        populate(client, ws, ada)
        backup = create_backup(client, ws, ada, encryption="password", password=PASSWORD)
        data = bytearray(download(client, ws, ada, backup["id"]))
        data[-40] ^= 0xFF
        staged = upload(client, ws, ada, bytes(data), "b.orbit-backup")
        response = client.post(
            f"{ws}/backup-uploads/{staged['id']}/inspect", json={"password": PASSWORD}, headers=ada
        )
        assert response.status_code == 422
        assert "damaged" in response.json()["detail"]
        truncated = upload(client, ws, ada, bytes(data[:-100]), "b.orbit-backup")
        response = client.post(
            f"{ws}/backup-uploads/{truncated['id']}/inspect",
            json={"password": PASSWORD},
            headers=ada,
        )
        assert response.status_code == 422


class TestFailedRestores:
    def test_a_failing_restore_rolls_back_records_and_files(
        self,
        client: TestClient,
        ws: str,
        ada: Headers,
        settings_open: Settings,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        populate(client, ws, ada)
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        staged = upload(client, ws, ada, data)
        workspaces_before = len(ok(client.get(WORKSPACES, headers=ada))["workspaces"])

        original = FileAttachmentStore.write_stream
        copied = 0

        async def power_cut(self: FileAttachmentStore, *args: Any) -> str:
            # The second file is written, then the process "dies".
            nonlocal copied
            digest = await original(self, *args)
            copied += 1
            if copied == 2:
                raise RuntimeError("power cut")
            return digest

        monkeypatch.setattr(FileAttachmentStore, "write_stream", power_cut)
        with pytest.raises(RuntimeError):
            client.post(
                f"{ws}/backup-uploads/{staged['id']}/restore",
                json={"strategy": "new_workspace"},
                headers=ada,
            )
        monkeypatch.undo()
        assert len(ok(client.get(WORKSPACES, headers=ada))["workspaces"]) == workspaces_before
        # Only the original workspace's files remain.
        stored = {p.parent.name for p in settings_open.attachments_dir.rglob("*") if p.is_file()}
        assert stored == {workspace_id(ws)}
        upload_state = ok(client.get(f"{ws}/backup-uploads", headers=ada))[0]
        assert upload_state["status"] == "failed"
        # A failed restore can be tried again.
        report = restore(client, ws, ada, staged["id"], strategy="new_workspace")
        assert report["files_restored"] == 3

    def test_replace_is_refused_while_integrations_are_connected(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        populate(client, ws, ada)
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        staged = upload(client, ws, ada, data)
        with sqlite3.connect(settings_open.sqlite_path) as connection:
            user_id = connection.execute("SELECT id FROM users").fetchone()[0]
            connection.execute(
                "INSERT INTO integration_connections (id, user_id, workspace_id, provider,"
                " account_id, account_email, display_name, scopes, capabilities, status,"
                " access_token_ciphertext, token_version, mail_days, created_at, updated_at)"
                " VALUES (?, ?, ?, 'google', 'x', 'a@example.com', 'A', '[]', '[]', 'active',"
                " 't', 1, 30, '2026-01-01 00:00:00', '2026-01-01 00:00:00')",
                ("0" * 32, user_id, workspace_id(ws).replace("-", "")),
            )
        name = ok(client.get(ws, headers=ada))["name"]
        refused = restore(
            client, ws, ada, staged["id"], code=409, strategy="replace", confirm_name=name
        )
        assert "integrations" in refused["detail"]


class TestExportsAndImports:
    def test_module_exports(self, client: TestClient, ws: str, ada: Headers) -> None:
        populate(client, ws, ada)
        # Tasks has two tables (tasks and their lists), so its CSV export is a zip of both.
        csv = client.post(f"{ws}/exports", json={"module": "tasks", "format": "csv"}, headers=ada)
        assert csv.status_code == 200 and csv.headers["content-type"] == "application/zip"
        tables = zipfile.ZipFile(io.BytesIO(csv.content))
        assert "File taxes" in next(
            tables.read(name).decode() for name in tables.namelist() if name.endswith("/tasks.csv")
        )
        assert any(name.endswith("/task_lists.csv") for name in tables.namelist())
        finance = client.post(
            f"{ws}/exports", json={"module": "finance", "format": "json"}, headers=ada
        ).json()
        assert finance["format"] == "orbit-export" and finance["modules"] == ["finance"]
        assert finance["tables"]["finance_transactions"][0]["amount"] == 12_345
        assert finance["tables"]["finance_transactions"][0]["currency"] == "INR"
        ics = client.post(
            f"{ws}/exports", json={"module": "calendar", "format": "ics"}, headers=ada
        ).text
        assert (
            ics.startswith("BEGIN:VCALENDAR\r\n") and "BEGIN:VTIMEZONE\r\nTZID=Europe/London" in ics
        )
        assert "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1" in ics
        assert "RECURRENCE-ID;TZID=Europe/London:20300228T100000" in ics
        assert "TRIGGER:-PT15M" in ics
        markdown = client.post(
            f"{ws}/exports", json={"module": "notes", "format": "markdown"}, headers=ada
        )
        notes = zipfile.ZipFile(io.BytesIO(markdown.content))
        plan = notes.read(
            "orbit-notes-" + datetime.now(UTC).date().isoformat() + "/Projects/Orbit/Plan.md"
        ).decode()
        assert (
            plan.startswith('---\ntitle: "Plan"') and 'tags: ["work"]' in plan and "## Plan" in plan
        )
        habits = client.post(
            f"{ws}/exports", json={"module": "habits", "format": "csv"}, headers=ada
        )
        assert {Path(n).name for n in zipfile.ZipFile(io.BytesIO(habits.content)).namelist()} >= {
            "habits.csv",
            "habit_logs.csv",
        }
        unsupported = client.post(
            f"{ws}/exports", json={"module": "tasks", "format": "ics"}, headers=ada
        )
        assert unsupported.status_code == 422
        whole = client.post(
            f"{ws}/exports", json={"module": None, "format": "json"}, headers=ada
        ).json()
        assert {"tasks", "notes", "fitness_photos"} <= set(whole["tables"])

    def test_importing_an_export_is_previewed_and_idempotent(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        populate(client, ws, ada)
        export = client.post(
            f"{ws}/exports", json={"module": "notes", "format": "json"}, headers=ada
        ).content
        other = ok(client.post(WORKSPACES, json={"name": "Other"}, headers=ada), 201)
        target = f"{WORKSPACES}/{other['id']}"

        staged = upload(client, target, ada, export, "notes.json")
        assert staged["kind"] == "export"
        preview = ok(
            client.post(f"{target}/backup-uploads/{staged['id']}/inspect", json={}, headers=ada)
        )
        assert preview["compatible"] is True
        assert preview["dry_run"]["strategy"] == "merge"
        assert preview["dry_run"]["totals"]["added"] > 0
        # The dry run changed nothing.
        assert ok(client.get(f"{target}/notes", headers=ada))["notes"] == []

        report = restore(client, target, ada, staged["id"])
        notes = {n["title"] for n in ok(client.get(f"{target}/notes", headers=ada))["notes"]}
        assert notes == {"Plan", "Target"}
        assert report["warnings"]  # the attachment's file isn't in a JSON export

        again = upload(client, target, ada, export, "notes.json")
        refused = restore(client, target, ada, again["id"], code=409)
        assert "already used" in refused["detail"]

        # Importing into the workspace it came from finds every record already there.
        same = upload(client, ws, ada, export, "notes.json")
        report = restore(client, ws, ada, same["id"])
        assert report["totals"]["added"] == 0
        assert report["totals"]["duplicates"] > 0

    def test_imported_categories_match_existing_ones_by_name(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        fin = f"{ws}/finance"
        ok(client.get(f"{fin}/categories", headers=ada))  # creates the defaults
        export = client.post(
            f"{ws}/exports", json={"module": "finance", "format": "json"}, headers=ada
        ).content
        other = ok(client.post(WORKSPACES, json={"name": "Other"}, headers=ada), 201)
        target = f"{WORKSPACES}/{other['id']}"
        ok(client.get(f"{target}/finance/categories", headers=ada))
        staged = upload(client, target, ada, export, "finance.json")
        report = restore(client, target, ada, staged["id"])
        categories = next(t for t in report["tables"] if t["table"] == "finance_categories")
        assert categories["matched"] > 0 and categories["added"] == 0 and categories["skipped"] == 0

    def test_full_workspace_archive_download_isnt_kept(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        populate(client, ws, ada)
        response = client.post(f"{ws}/exports/archive", json={"include_files": True}, headers=ada)
        assert response.status_code == 200
        assert zipfile.ZipFile(io.BytesIO(response.content)).read("orbit-backup/manifest.json")
        assert ok(client.get(f"{ws}/backups", headers=ada))["backups"] == []
        leftovers = (
            list((settings_open.backups_dir / "tmp").glob("*"))
            if (settings_open.backups_dir / "tmp").exists()
            else []
        )
        assert leftovers == []


class TestIsolation:
    def test_another_person_cant_reach_backups_uploads_or_exports(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        populate(client, ws, ada)
        backup = create_backup(client, ws, ada)
        staged = upload(client, ws, ada, download(client, ws, ada, backup["id"]))
        for method, path, body in (
            ("get", f"{ws}/backups", None),
            ("post", f"{ws}/backups", {}),
            ("get", f"{ws}/backups/{backup['id']}/download", None),
            ("delete", f"{ws}/backups/{backup['id']}", None),
            ("post", f"{ws}/exports", {"module": "tasks", "format": "json"}),
            ("post", f"{ws}/backup-uploads/{staged['id']}/inspect", {}),
            ("post", f"{ws}/backup-uploads/{staged['id']}/restore", {"strategy": "new_workspace"}),
        ):
            response = client.request(method, path, json=body, headers=grace)
            assert response.status_code == 404, (method, path)
        # Grace's own workspace can't see Ada's backup or upload by ID either.
        mine = personal(client, grace)
        assert (
            client.get(f"{mine}/backups/{backup['id']}/download", headers=grace).status_code == 404
        )
        assert (
            client.post(
                f"{mine}/backup-uploads/{staged['id']}/inspect", json={}, headers=grace
            ).status_code
            == 404
        )
        assert client.get(f"{ws}/backups").status_code == 401

    def test_a_backup_contains_only_its_workspace(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        populate(client, ws, ada)
        populate(client, personal(client, grace), grace)
        work = ok(client.post(WORKSPACES, json={"name": "Work"}, headers=ada), 201)
        ok(
            client.post(
                f"{WORKSPACES}/{work['id']}/tasks", json={"title": "Elsewhere"}, headers=ada
            ),
            201,
        )
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        archive = zipfile.ZipFile(io.BytesIO(data))
        tasks = archive.read("orbit-backup/database/tasks.jsonl").decode()
        assert tasks.count("\n") == 1 and "Elsewhere" not in tasks
        manifest = json.loads(archive.read("orbit-backup/manifest.json"))
        for name in manifest["tables"]:
            for line in archive.read(f"orbit-backup/database/{name}.jsonl").splitlines():
                record = json.loads(line)
                if "workspace_id" in record:
                    assert record["workspace_id"] == workspace_id(ws), name

    def test_restoring_someone_elses_backup_makes_it_yours(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        populate(client, ws, ada)
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        mine = personal(client, grace)
        staged = upload(client, mine, grace, data)
        report = restore(client, mine, grace, staged["id"], strategy="new_workspace")
        copy = f"{WORKSPACES}/{report['workspace_id']}"
        assert ok(client.get(f"{copy}/fitness/measurements", headers=grace))["measurements"]
        assert client.get(copy, headers=ada).status_code == 404


class TestManagement:
    def test_delete_backup_removes_its_file(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        backup = create_backup(client, ws, ada)
        path = settings_open.backups_dir / workspace_id(ws) / f"{backup['id']}.orbit-backup"
        assert path.is_file() and oct(path.stat().st_mode & 0o777) == "0o600"
        ok(client.delete(f"{ws}/backups/{backup['id']}", headers=ada), 204)
        assert not path.exists()
        assert client.get(f"{ws}/backups/{backup['id']}/download", headers=ada).status_code == 404

    def test_a_changed_stored_backup_fails_verification(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        backup = create_backup(client, ws, ada)
        path = settings_open.backups_dir / workspace_id(ws) / f"{backup['id']}.orbit-backup"
        path.write_bytes(path.read_bytes() + b"x")
        result = ok(client.post(f"{ws}/backups/{backup['id']}/verify", json={}, headers=ada))
        assert result["ok"] is False

    def test_one_backup_at_a_time(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        with sqlite3.connect(settings_open.sqlite_path) as connection:
            user_id = connection.execute("SELECT id FROM users").fetchone()[0]
            connection.execute(
                "INSERT INTO backups (id, workspace_id, user_id, kind, status, include_files,"
                " encrypted, record_count, file_count, modules, record_counts, warnings,"
                " format_version,"
                " schema_revision, app_version, started_at, created_at) VALUES (?, ?, ?, 'manual',"
                " 'running', 1, 0, 0, 0, '[]', '{}', '[]', 1, '0021', '0', ?, ?)",
                (
                    "1" * 32,
                    workspace_id(ws).replace("-", ""),
                    user_id,
                    datetime.now(UTC).isoformat(),
                    datetime.now(UTC).isoformat(),
                ),
            )
        assert client.post(f"{ws}/backups", json={}, headers=ada).status_code == 409

    def test_deleting_a_workspace_deletes_its_backups(
        self, client: TestClient, ada: Headers, settings_open: Settings
    ) -> None:
        work = ok(client.post(WORKSPACES, json={"name": "Work"}, headers=ada), 201)
        ws = f"{WORKSPACES}/{work['id']}"
        create_backup(client, ws, ada)
        ok(client.delete(ws, headers=ada), 204)
        assert not (settings_open.backups_dir / work["id"]).exists()

    def test_uploads_are_size_limited(self, settings_open: Settings) -> None:
        app = create_app(settings_open.model_copy(update={"backup_upload_max_bytes": 1024 * 1024}))
        app.state.password_hasher = FAST_PASSWORD_HASHER
        with TestClient(app) as client:
            headers = bearer(sign_up(client))
            ws = personal(client, headers)
            response = client.post(
                f"{ws}/backup-uploads",
                params={"filename": "big.zip"},
                content=b"PK\x03\x04" + b"0" * (1024 * 1024 + 1),
                headers={**headers, "Content-Type": "application/octet-stream"},
            )
            assert response.status_code == 413


class TestScheduledBackups:
    def run_worker(self, settings: Settings, now: datetime) -> ReminderWorker:
        async def go() -> ReminderWorker:
            database = await open_database(settings)
            try:
                worker = ReminderWorker(database, clock=lambda: now, backups=BackupJobs(settings))
                await worker.run_backups()
                await worker.tidy_backups()
                return worker
            finally:
                await database.dispose()

        return anyio.run(go)

    def test_due_backups_run_once_and_retention_prunes_old_ones(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        populate(client, ws, ada)
        ok(
            client.put(
                f"{ws}/backups/settings",
                json={
                    "frequency": "daily",
                    "retention_count": 2,
                    "include_files": False,
                    "encrypt": False,
                },
                headers=ada,
            )
        )
        now = datetime.now(UTC) + timedelta(minutes=1)
        for day in range(4):
            self.run_worker(settings_open, now + timedelta(days=day))
            # A second worker at the same moment finds nothing left to do.
            self.run_worker(settings_open, now + timedelta(days=day))
        overview = ok(client.get(f"{ws}/backups", headers=ada))
        scheduled = [b for b in overview["backups"] if b["kind"] == "scheduled"]
        assert len(scheduled) == 2
        assert all(b["status"] == "succeeded" and b["file_count"] == 0 for b in scheduled)
        files = list((settings_open.backups_dir / workspace_id(ws)).glob("*.orbit-backup"))
        assert len(files) == 2
        assert overview["settings"]["next_run_at"] > overview["settings"]["last_run_at"]

    def test_a_missed_schedule_runs_once_on_restart(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        ok(
            client.put(
                f"{ws}/backups/settings",
                json={
                    "frequency": "weekly",
                    "retention_count": 5,
                    "include_files": True,
                    "encrypt": False,
                },
                headers=ada,
            )
        )
        later = datetime.now(UTC) + timedelta(days=30)
        self.run_worker(settings_open, later)
        overview = ok(client.get(f"{ws}/backups", headers=ada))
        assert len(overview["backups"]) == 1
        assert datetime.fromisoformat(overview["settings"]["next_run_at"]) > later

    def test_a_failed_scheduled_backup_is_recorded_and_retried(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        ok(
            client.put(
                f"{ws}/backups/settings",
                json={
                    "frequency": "daily",
                    "retention_count": 5,
                    "include_files": True,
                    "encrypt": False,
                },
                headers=ada,
            )
        )
        settings_open.backups_dir.mkdir(parents=True, exist_ok=True)
        (settings_open.backups_dir / workspace_id(ws)).write_text("not a folder")
        now = datetime.now(UTC) + timedelta(minutes=1)
        self.run_worker(settings_open, now)
        overview = ok(client.get(f"{ws}/backups", headers=ada))
        assert overview["backups"][0]["status"] == "failed"
        assert overview["backups"][0]["error"]
        retry = datetime.fromisoformat(overview["settings"]["next_run_at"])
        assert retry <= now + timedelta(hours=1, seconds=1)

    def test_interrupted_backups_and_restores_are_marked_failed(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        populate(client, ws, ada)
        data = download(client, ws, ada, create_backup(client, ws, ada)["id"])
        staged = upload(client, ws, ada, data)
        with sqlite3.connect(settings_open.sqlite_path) as connection:
            connection.execute("UPDATE backup_uploads SET status = 'restoring'")
        self.run_worker(settings_open, datetime.now(UTC) + timedelta(hours=30))
        state = ok(client.get(f"{ws}/backup-uploads", headers=ada))[0]
        assert state["id"] == staged["id"]
        assert state["status"] in ("failed", "expired")
        assert "interrupted" in (state["error"] or "")


class TestSnapshotConsistency:
    def test_a_backup_reads_one_moment_even_while_writes_happen(
        self, client: TestClient, ws: str, ada: Headers, settings_open: Settings
    ) -> None:
        """Writes made by another connection between two tables' reads aren't in the backup."""
        populate(client, ws, ada)
        from orbit_api.repositories import backup as backup_repository

        original = backup_repository.SqlBackupData.stream_rows
        wrote = False

        async def interleaved(self: Any, spec: Any, workspace: Any, user: Any) -> Any:
            nonlocal wrote
            async for batch in original(self, spec, workspace, user):
                yield batch
            if spec.name == "tasks" and not wrote:
                wrote = True
                with sqlite3.connect(settings_open.sqlite_path) as connection:
                    connection.execute(
                        "UPDATE notes SET title = 'Changed meanwhile' WHERE workspace_id = ?",
                        (workspace_id(ws).replace("-", ""),),
                    )

        async def go() -> Any:
            database = await open_database(settings_open)
            try:
                async with database.session() as session:
                    service = build_backup_service(session, settings_open)
                    from orbit_api.repositories.workspaces import SqlWorkspaceRepository

                    workspaces = await SqlWorkspaceRepository(session).list_owned(
                        __import__("uuid").UUID(
                            sqlite3.connect(settings_open.sqlite_path)
                            .execute("SELECT id FROM users")
                            .fetchone()[0]
                        )
                    )
                    target = next(w for w in workspaces if str(w.id) == workspace_id(ws))
                    return await service.create_backup(
                        target,
                        target.owner_id,
                        kind="manual",
                        include_files=False,
                        encryption_mode="none",
                    )
            finally:
                await database.dispose()

        backup_repository.SqlBackupData.stream_rows = interleaved  # type: ignore[method-assign]
        try:
            made = anyio.run(go)
        finally:
            backup_repository.SqlBackupData.stream_rows = original  # type: ignore[method-assign]
        assert wrote
        data = download(client, ws, ada, str(made.id))
        notes = zipfile.ZipFile(io.BytesIO(data)).read("orbit-backup/database/notes.jsonl").decode()
        assert "Changed meanwhile" not in notes
        assert "Plan" in notes
