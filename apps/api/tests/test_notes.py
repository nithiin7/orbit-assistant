import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def settings_open(migrated_settings: Settings) -> Settings:
    return migrated_settings.model_copy(update={"local_open_registration": True})


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


def personal_url(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    """Ada's personal workspace."""
    return personal_url(client, ada)


def doc(*paragraphs: str, links: tuple[str, ...] = ()) -> Json:
    blocks: list[Json] = [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]} for text in paragraphs
    ]
    for note_id in links:
        blocks.append(
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "link",
                        "marks": [{"type": "link", "attrs": {"href": f"/notes?note={note_id}"}}],
                    }
                ],
            }
        )
    return {"type": "doc", "content": blocks}


def create(client: TestClient, ws: str, headers: Headers, **fields: Any) -> Json:
    response = client.post(f"{ws}/notes", json={"title": "Note", **fields}, headers=headers)
    assert response.status_code == 201, response.text
    note: Json = response.json()
    return note


def patch(client: TestClient, ws: str, headers: Headers, note: Json, **fields: Any) -> Json:
    response = client.patch(f"{ws}/notes/{note['id']}", json=fields, headers=headers)
    assert response.status_code == 200, response.text
    updated: Json = response.json()
    return updated


def titles(client: TestClient, ws: str, headers: Headers, **params: Any) -> list[str]:
    response = client.get(f"{ws}/notes", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [note["title"] for note in response.json()["notes"]]


def folder(
    client: TestClient, ws: str, headers: Headers, name: str, parent: str | None = None
) -> Json:
    response = client.post(
        f"{ws}/note-folders", json={"name": name, "parent_id": parent}, headers=headers
    )
    assert response.status_code == 201, response.text
    created: Json = response.json()
    return created


# Notes


def test_create_and_read_a_note(client: TestClient, ws: str, ada: Headers) -> None:
    note = create(client, ws, ada, title="  Ideas ", content=doc("First thought"))
    assert note["title"] == "Ideas"
    assert note["note_type"] == "note"
    assert note["folder_id"] is None
    assert note["revision"] == 1
    assert note["content_format"] == "prosemirror-v1"
    assert note["content"] == doc("First thought")
    assert note["tags"] == [] and note["task_ids"] == []

    fetched = client.get(f"{ws}/notes/{note['id']}", headers=ada).json()
    assert fetched == note


def test_a_note_without_content_is_an_empty_document(
    client: TestClient, ws: str, ada: Headers
) -> None:
    note = create(client, ws, ada, title="")
    assert note["title"] == ""
    assert note["content"] == {"type": "doc", "content": [{"type": "paragraph"}]}


def test_quick_capture_text_becomes_paragraphs(client: TestClient, ws: str, ada: Headers) -> None:
    note = create(client, ws, ada, note_type="quick", text="Call the bank\nAbout the card")
    assert note["note_type"] == "quick"
    assert [block["content"][0]["text"] for block in note["content"]["content"]] == [
        "Call the bank",
        "About the card",
    ]


def test_invalid_content_is_a_422(client: TestClient, ws: str, ada: Headers) -> None:
    bad = {"type": "doc", "content": [{"type": "script"}]}
    response = client.post(f"{ws}/notes", json={"content": bad}, headers=ada)
    assert response.status_code == 422
    assert "unsupported element" in response.text
    unsafe = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "x",
                        "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}],
                    }
                ],
            }
        ],
    }
    assert client.post(f"{ws}/notes", json={"content": unsafe}, headers=ada).status_code == 422
    both = {"content": doc("a"), "text": "b"}
    assert client.post(f"{ws}/notes", json=both, headers=ada).status_code == 422


def test_unknown_fields_are_rejected(client: TestClient, ws: str, ada: Headers) -> None:
    for field in ("workspace_id", "revision", "plain_text", "journal_date"):
        response = client.post(f"{ws}/notes", json={field: "x"}, headers=ada)
        assert response.status_code == 422, field


def test_autosave_persists_and_bumps_the_revision(
    client: TestClient, ws: str, ada: Headers
) -> None:
    note = create(client, ws, ada, content=doc("v1"))
    saved = patch(client, ws, ada, note, content=doc("v2"), expected_revision=1)
    assert saved["revision"] == 2
    assert saved["updated_at"] > note["updated_at"]
    saved = patch(client, ws, ada, saved, title="Renamed", expected_revision=2)
    assert saved["revision"] == 3

    reloaded = client.get(f"{ws}/notes/{note['id']}", headers=ada).json()
    assert reloaded["content"] == doc("v2")
    assert reloaded["title"] == "Renamed"


def test_saving_the_same_content_changes_nothing(client: TestClient, ws: str, ada: Headers) -> None:
    note = create(client, ws, ada, content=doc("same"))
    saved = patch(client, ws, ada, note, content=doc("same"), expected_revision=1)
    assert saved["revision"] == 1
    assert saved["updated_at"] == note["updated_at"]


def test_a_stale_save_is_refused_instead_of_overwriting(
    client: TestClient, ws: str, ada: Headers
) -> None:
    note = create(client, ws, ada, content=doc("original"))
    # Another tab saves first.
    patch(client, ws, ada, note, content=doc("from tab one"), expected_revision=1)
    stale = client.patch(
        f"{ws}/notes/{note['id']}",
        json={"content": doc("from tab two"), "expected_revision": 1},
        headers=ada,
    )
    assert stale.status_code == 409
    assert "changed somewhere else" in stale.json()["detail"]
    current = client.get(f"{ws}/notes/{note['id']}", headers=ada).json()
    assert current["content"] == doc("from tab one")
    assert current["revision"] == 2


def test_metadata_changes_ignore_the_revision_and_keep_updated_at(
    client: TestClient, ws: str, ada: Headers
) -> None:
    note = create(client, ws, ada)
    patch(client, ws, ada, note, content=doc("edit"), expected_revision=1)
    # A stale revision only guards text; pinning still works and doesn't count as an edit.
    pinned = patch(client, ws, ada, note, is_pinned=True, is_favorite=True, expected_revision=1)
    assert pinned["is_pinned"] and pinned["is_favorite"]
    assert pinned["revision"] == 2
    reloaded = client.get(f"{ws}/notes/{note['id']}", headers=ada).json()
    assert reloaded["updated_at"] == pinned["updated_at"]


def test_update_validation(client: TestClient, ws: str, ada: Headers) -> None:
    note = create(client, ws, ada)
    url = f"{ws}/notes/{note['id']}"
    assert client.patch(url, json={}, headers=ada).status_code == 422
    assert client.patch(url, json={"expected_revision": 1}, headers=ada).status_code == 422
    assert client.patch(url, json={"title": None}, headers=ada).status_code == 422
    assert client.patch(url, json={"title": "x" * 201}, headers=ada).status_code == 422
    missing = client.patch(f"{ws}/notes/{uuid.uuid4()}", json={"title": "x"}, headers=ada)
    assert missing.status_code == 404


def test_archive_and_unarchive(client: TestClient, ws: str, ada: Headers) -> None:
    note = create(client, ws, ada, title="Old")
    create(client, ws, ada, title="Current")
    archived = patch(client, ws, ada, note, archived=True)
    assert archived["archived_at"] is not None
    assert titles(client, ws, ada) == ["Current"]
    assert titles(client, ws, ada, state="archived") == ["Old"]
    patch(client, ws, ada, note, archived=False)
    assert sorted(titles(client, ws, ada)) == ["Current", "Old"]


def test_trash_restore_and_permanent_delete(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings
) -> None:
    note = create(client, ws, ada, title="Draft")
    patch(client, ws, ada, note, is_pinned=True)
    url = f"{ws}/notes/{note['id']}"

    # Only trashed notes can be deleted for good.
    assert client.delete(url, headers=ada).status_code == 409

    trashed = client.post(f"{url}/trash", headers=ada).json()
    assert trashed["trashed_at"] is not None
    assert trashed["is_pinned"] is False
    assert titles(client, ws, ada) == []
    assert titles(client, ws, ada, state="trashed") == ["Draft"]

    restored = client.post(f"{url}/restore", headers=ada).json()
    assert restored["trashed_at"] is None
    assert titles(client, ws, ada) == ["Draft"]

    client.post(f"{url}/trash", headers=ada)
    assert client.delete(url, headers=ada).status_code == 204
    assert client.get(url, headers=ada).status_code == 404
    assert query(settings_open.sqlite_path, "SELECT count(*) FROM notes") == [(0,)]


def test_empty_trash(client: TestClient, ws: str, ada: Headers) -> None:
    for title in ("a", "b"):
        note = create(client, ws, ada, title=title)
        client.post(f"{ws}/notes/{note['id']}/trash", headers=ada)
    create(client, ws, ada, title="keep")
    response = client.post(f"{ws}/notes/empty-trash", headers=ada)
    assert response.json() == {"deleted": 2}
    assert titles(client, ws, ada) == ["keep"]


def test_duplicate_copies_content_folder_and_tags(
    client: TestClient, ws: str, ada: Headers
) -> None:
    box = folder(client, ws, ada, "Work")
    other = create(client, ws, ada, title="Target")
    note = create(
        client,
        ws,
        ada,
        title="Plan",
        content=doc("Body", links=(other["id"],)),
        folder_id=box["id"],
        tags=["Q4"],
    )
    copy = client.post(f"{ws}/notes/{note['id']}/duplicate", headers=ada)
    assert copy.status_code == 201
    duplicate = copy.json()
    assert duplicate["id"] != note["id"]
    assert duplicate["title"] == "Plan (copy)"
    assert duplicate["content"] == note["content"]
    assert duplicate["folder_id"] == box["id"]
    assert [tag["name"] for tag in duplicate["tags"]] == ["Q4"]
    assert duplicate["revision"] == 1
    backlinks = client.get(f"{ws}/notes/{other['id']}/links", headers=ada).json()["backlinks"]
    assert {ref["id"] for ref in backlinks} == {note["id"], duplicate["id"]}


def test_opening_a_note_feeds_the_recent_view(client: TestClient, ws: str, ada: Headers) -> None:
    first = create(client, ws, ada, title="First")
    create(client, ws, ada, title="Second")
    assert titles(client, ws, ada, sort="recent") == ["Second", "First"]
    assert client.post(f"{ws}/notes/{first['id']}/open", headers=ada).status_code == 204
    assert titles(client, ws, ada, sort="recent") == ["First", "Second"]
    opened = client.get(f"{ws}/notes/{first['id']}", headers=ada).json()
    assert opened["last_opened_at"] is not None
    assert opened["updated_at"] == first["updated_at"]


def test_counts(client: TestClient, ws: str, ada: Headers) -> None:
    box = folder(client, ws, ada, "Box")
    inbox = create(client, ws, ada, title="inbox")
    create(client, ws, ada, title="filed", folder_id=box["id"])
    patch(client, ws, ada, inbox, is_favorite=True, is_pinned=True)
    archived = create(client, ws, ada, title="archived")
    patch(client, ws, ada, archived, archived=True)
    trashed = create(client, ws, ada, title="trashed")
    client.post(f"{ws}/notes/{trashed['id']}/trash", headers=ada)
    client.put(f"{ws}/notes/journal/2026-10-31", headers=ada)

    counts = client.get(f"{ws}/notes/counts", headers=ada).json()
    assert counts == {
        "all": 2,
        "inbox": 1,
        "favorites": 1,
        "pinned": 1,
        "journal": 1,
        "archived": 1,
        "trashed": 1,
    }


# Folders


def test_nested_folders_and_moving_notes(client: TestClient, ws: str, ada: Headers) -> None:
    work = folder(client, ws, ada, "Work")
    projects = folder(client, ws, ada, "Projects", work["id"])
    note = create(client, ws, ada, title="Spec")
    assert titles(client, ws, ada, inbox=True) == ["Spec"]

    moved = patch(client, ws, ada, note, folder_id=projects["id"])
    assert moved["folder_id"] == projects["id"]
    assert titles(client, ws, ada, inbox=True) == []
    assert titles(client, ws, ada, folder_id=projects["id"]) == ["Spec"]

    folders = {
        f["name"]: f for f in client.get(f"{ws}/note-folders", headers=ada).json()["folders"]
    }
    assert folders["Projects"]["parent_id"] == work["id"]
    assert folders["Projects"]["note_count"] == 1
    assert folders["Work"]["note_count"] == 0

    back = patch(client, ws, ada, note, folder_id=None)
    assert back["folder_id"] is None


def test_moving_into_a_missing_folder_is_refused(client: TestClient, ws: str, ada: Headers) -> None:
    note = create(client, ws, ada)
    response = client.patch(
        f"{ws}/notes/{note['id']}", json={"folder_id": str(uuid.uuid4())}, headers=ada
    )
    assert response.status_code == 422
    response = client.post(
        f"{ws}/note-folders", json={"name": "x", "parent_id": str(uuid.uuid4())}, headers=ada
    )
    assert response.status_code == 422


def test_renaming_and_moving_folders(client: TestClient, ws: str, ada: Headers) -> None:
    a = folder(client, ws, ada, "A")
    b = folder(client, ws, ada, "B")
    renamed = client.patch(f"{ws}/note-folders/{a['id']}", json={"name": "Alpha"}, headers=ada)
    assert renamed.json()["name"] == "Alpha"
    moved = client.patch(f"{ws}/note-folders/{a['id']}", json={"parent_id": b["id"]}, headers=ada)
    assert moved.json()["parent_id"] == b["id"]
    top = client.patch(f"{ws}/note-folders/{a['id']}", json={"parent_id": None}, headers=ada)
    assert top.json()["parent_id"] is None


def test_circular_nesting_is_prevented(client: TestClient, ws: str, ada: Headers) -> None:
    a = folder(client, ws, ada, "A")
    b = folder(client, ws, ada, "B", a["id"])
    c = folder(client, ws, ada, "C", b["id"])
    for parent in (a["id"], c["id"]):
        response = client.patch(
            f"{ws}/note-folders/{a['id']}", json={"parent_id": parent}, headers=ada
        )
        assert response.status_code == 422, parent
        assert "inside itself" in response.json()["detail"]


def test_folders_nest_at_most_eight_deep(client: TestClient, ws: str, ada: Headers) -> None:
    parent: str | None = None
    for level in range(8):
        parent = folder(client, ws, ada, f"L{level}", parent)["id"]
    response = client.post(
        f"{ws}/note-folders", json={"name": "too deep", "parent_id": parent}, headers=ada
    )
    assert response.status_code == 422
    # Moving a two-level branch under level 7 would also be too deep.
    branch = folder(client, ws, ada, "Branch")
    folder(client, ws, ada, "Leaf", branch["id"])
    folders = client.get(f"{ws}/note-folders", headers=ada).json()["folders"]
    level7 = next(f for f in folders if f["name"] == "L6")
    response = client.patch(
        f"{ws}/note-folders/{branch['id']}", json={"parent_id": level7["id"]}, headers=ada
    )
    assert response.status_code == 422


def test_deleting_a_folder_moves_notes_to_its_parent(
    client: TestClient, ws: str, ada: Headers
) -> None:
    work = folder(client, ws, ada, "Work")
    old = folder(client, ws, ada, "Old", work["id"])
    sub = folder(client, ws, ada, "Sub", old["id"])
    create(client, ws, ada, title="In old", folder_id=old["id"])
    response = client.delete(
        f"{ws}/note-folders/{old['id']}", params={"notes": "parent"}, headers=ada
    )
    assert response.status_code == 204
    assert titles(client, ws, ada, folder_id=work["id"]) == ["In old"]
    folders = {f["id"]: f for f in client.get(f"{ws}/note-folders", headers=ada).json()["folders"]}
    assert old["id"] not in folders
    assert folders[sub["id"]]["parent_id"] == work["id"]


def test_deleting_a_folder_can_send_its_notes_to_the_inbox(
    client: TestClient, ws: str, ada: Headers
) -> None:
    box = folder(client, ws, ada, "Box")
    inner = folder(client, ws, ada, "Inner", box["id"])
    create(client, ws, ada, title="outer note", folder_id=box["id"])
    create(client, ws, ada, title="inner note", folder_id=inner["id"])
    client.delete(f"{ws}/note-folders/{box['id']}", params={"notes": "inbox"}, headers=ada)
    assert sorted(titles(client, ws, ada, inbox=True)) == ["inner note", "outer note"]
    assert client.get(f"{ws}/note-folders", headers=ada).json()["folders"] == []


def test_deleting_a_folder_can_trash_its_notes(client: TestClient, ws: str, ada: Headers) -> None:
    box = folder(client, ws, ada, "Box")
    create(client, ws, ada, title="note", folder_id=box["id"])
    client.delete(f"{ws}/note-folders/{box['id']}", params={"notes": "trash"}, headers=ada)
    assert titles(client, ws, ada) == []
    trashed = client.get(f"{ws}/notes", params={"state": "trashed"}, headers=ada).json()["notes"]
    assert [n["title"] for n in trashed] == ["note"]
    assert trashed[0]["folder_id"] is None


def test_deleting_a_folder_requires_a_choice(client: TestClient, ws: str, ada: Headers) -> None:
    box = folder(client, ws, ada, "Box")
    assert client.delete(f"{ws}/note-folders/{box['id']}", headers=ada).status_code == 422


# Tags


def test_tags_are_created_reused_and_not_duplicated(
    client: TestClient, ws: str, ada: Headers
) -> None:
    note = create(client, ws, ada, title="a")
    other = create(client, ws, ada, title="b")
    tags_url = f"{ws}/notes/{note['id']}/tags"
    first = client.post(tags_url, json={"name": "  Deep   Work "}, headers=ada).json()["tags"]
    assert [tag["name"] for tag in first] == ["Deep Work"]
    # The same name in another case is the same tag, and adding it again changes nothing.
    again = client.post(tags_url, json={"name": "deep work"}, headers=ada).json()["tags"]
    assert again == first
    client.post(f"{ws}/notes/{other['id']}/tags", json={"name": "DEEP WORK"}, headers=ada)

    tags = client.get(f"{ws}/note-tags", headers=ada).json()["tags"]
    assert [(tag["name"], tag["note_count"]) for tag in tags] == [("Deep Work", 2)]

    duplicate = client.post(f"{ws}/note-tags", json={"name": "deep  work"}, headers=ada)
    assert duplicate.status_code == 409
    assert client.post(f"{ws}/note-tags", json={"name": "  "}, headers=ada).status_code == 422


def test_filtering_by_tag_and_removing_tags(client: TestClient, ws: str, ada: Headers) -> None:
    tagged = create(client, ws, ada, title="tagged", tags=["home"])
    create(client, ws, ada, title="plain")
    tag_id = tagged["tags"][0]["id"]
    assert titles(client, ws, ada, tag_id=tag_id) == ["tagged"]

    removed = client.delete(f"{ws}/notes/{tagged['id']}/tags/{tag_id}", headers=ada)
    assert removed.status_code == 204
    assert titles(client, ws, ada, tag_id=tag_id) == []
    # The tag stays for reuse.
    assert [t["name"] for t in client.get(f"{ws}/note-tags", headers=ada).json()["tags"]] == [
        "home"
    ]


def test_renaming_and_deleting_tags(client: TestClient, ws: str, ada: Headers) -> None:
    note = create(client, ws, ada, tags=["errands", "home"])
    tags = {t["name"]: t["id"] for t in note["tags"]}
    renamed = client.patch(
        f"{ws}/note-tags/{tags['errands']}", json={"name": "Chores"}, headers=ada
    )
    assert renamed.json()["name"] == "Chores"
    clash = client.patch(f"{ws}/note-tags/{tags['errands']}", json={"name": "HOME"}, headers=ada)
    assert clash.status_code == 409
    # Changing only the case of a tag's own name is fine.
    recased = client.patch(f"{ws}/note-tags/{tags['home']}", json={"name": "Home"}, headers=ada)
    assert recased.status_code == 200

    assert client.delete(f"{ws}/note-tags/{tags['home']}", headers=ada).status_code == 204
    reloaded = client.get(f"{ws}/notes/{note['id']}", headers=ada).json()
    assert [t["name"] for t in reloaded["tags"]] == ["Chores"]


# Links and backlinks


def test_links_and_backlinks_follow_the_content(client: TestClient, ws: str, ada: Headers) -> None:
    target = create(client, ws, ada, title="Target")
    other = create(client, ws, ada, title="Other")
    source = create(client, ws, ada, title="Source", content=doc("See", links=(target["id"],)))

    links = client.get(f"{ws}/notes/{source['id']}/links", headers=ada).json()
    assert [ref["title"] for ref in links["outgoing"]] == ["Target"]
    backlinks = client.get(f"{ws}/notes/{target['id']}/links", headers=ada).json()["backlinks"]
    assert [ref["title"] for ref in backlinks] == ["Source"]

    # Editing the link to point elsewhere updates both sides.
    patch(client, ws, ada, source, content=doc("See", links=(other["id"], other["id"])))
    assert client.get(f"{ws}/notes/{target['id']}/links", headers=ada).json()["backlinks"] == []
    outgoing = client.get(f"{ws}/notes/{source['id']}/links", headers=ada).json()["outgoing"]
    assert [ref["title"] for ref in outgoing] == ["Other"]

    # Removing the link removes the relationship.
    patch(client, ws, ada, source, content=doc("No links"))
    assert client.get(f"{ws}/notes/{source['id']}/links", headers=ada).json()["outgoing"] == []


def test_links_survive_renaming_the_target(client: TestClient, ws: str, ada: Headers) -> None:
    target = create(client, ws, ada, title="Before")
    source = create(client, ws, ada, title="Source", content=doc("x", links=(target["id"],)))
    patch(client, ws, ada, target, title="After")
    outgoing = client.get(f"{ws}/notes/{source['id']}/links", headers=ada).json()["outgoing"]
    assert [(ref["id"], ref["title"]) for ref in outgoing] == [(target["id"], "After")]


def test_links_to_trashed_notes_are_hidden_until_restored(
    client: TestClient, ws: str, ada: Headers
) -> None:
    target = create(client, ws, ada, title="Target")
    source = create(client, ws, ada, content=doc("x", links=(target["id"],)))
    client.post(f"{ws}/notes/{target['id']}/trash", headers=ada)
    assert client.get(f"{ws}/notes/{source['id']}/links", headers=ada).json()["outgoing"] == []
    client.post(f"{ws}/notes/{target['id']}/restore", headers=ada)
    assert len(client.get(f"{ws}/notes/{source['id']}/links", headers=ada).json()["outgoing"]) == 1


def test_self_links_and_unknown_targets_relate_nothing(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings
) -> None:
    note = create(client, ws, ada)
    patch(client, ws, ada, note, content=doc("x", links=(note["id"], str(uuid.uuid4()))))
    assert query(settings_open.sqlite_path, "SELECT count(*) FROM note_links") == [(0,)]


# Tasks


def test_linking_tasks_to_notes(client: TestClient, ws: str, ada: Headers) -> None:
    task = client.post(f"{ws}/tasks", json={"title": "Ship it"}, headers=ada).json()
    note = create(client, ws, ada, title="Release notes")
    url = f"{ws}/notes/{note['id']}/tasks/{task['id']}"

    linked = client.put(url, headers=ada)
    assert linked.status_code == 200
    assert [t["title"] for t in linked.json()["tasks"]] == ["Ship it"]
    assert client.put(url, headers=ada).json()["total"] == 1  # idempotent

    detail = client.get(f"{ws}/notes/{note['id']}", headers=ada).json()
    assert detail["task_ids"] == [task["id"]]
    # From the task's side: the notes about it.
    assert titles(client, ws, ada, task_id=task["id"]) == ["Release notes"]

    assert client.delete(url, headers=ada).status_code == 204
    assert client.get(f"{ws}/notes/{note['id']}/tasks", headers=ada).json()["tasks"] == []
    # The task itself is untouched.
    assert client.get(f"{ws}/tasks/{task['id']}", headers=ada).status_code == 200


def test_deleting_a_task_removes_its_note_links(client: TestClient, ws: str, ada: Headers) -> None:
    task = client.post(f"{ws}/tasks", json={"title": "Temp"}, headers=ada).json()
    note = create(client, ws, ada)
    client.put(f"{ws}/notes/{note['id']}/tasks/{task['id']}", headers=ada)
    client.delete(f"{ws}/tasks/{task['id']}", headers=ada)
    assert client.get(f"{ws}/notes/{note['id']}", headers=ada).json()["task_ids"] == []


def test_tasks_from_other_workspaces_cannot_be_linked(
    client: TestClient, ws: str, ada: Headers, grace: Headers
) -> None:
    grace_ws = personal_url(client, grace)
    graces_task = client.post(f"{grace_ws}/tasks", json={"title": "Hers"}, headers=grace).json()
    side = client.post(WORKSPACES, json={"name": "Side"}, headers=ada).json()
    side_task = client.post(
        f"{WORKSPACES}/{side['id']}/tasks", json={"title": "Elsewhere"}, headers=ada
    ).json()
    note = create(client, ws, ada)
    for task_id in (graces_task["id"], side_task["id"], str(uuid.uuid4())):
        response = client.put(f"{ws}/notes/{note['id']}/tasks/{task_id}", headers=ada)
        assert response.status_code == 422, task_id


# Journal


def test_one_journal_entry_per_day(client: TestClient, ws: str, ada: Headers) -> None:
    url = f"{ws}/notes/journal/2026-10-31"
    assert client.get(url, headers=ada).status_code == 404
    first = client.put(url, headers=ada)
    assert first.status_code == 201
    entry = first.json()
    assert entry["note_type"] == "journal"
    assert entry["journal_date"] == "2026-10-31"
    again = client.put(url, headers=ada)
    assert again.status_code == 200
    assert again.json()["id"] == entry["id"]
    assert client.get(url, headers=ada).json()["id"] == entry["id"]

    client.put(f"{ws}/notes/journal/2026-10-30", headers=ada)
    history = client.get(
        f"{ws}/notes", params={"type": "journal", "sort": "journal_date"}, headers=ada
    ).json()["notes"]
    assert [n["journal_date"] for n in history] == ["2026-10-31", "2026-10-30"]
    # Journal entries aren't in the Inbox.
    assert titles(client, ws, ada, inbox=True, type=["note", "quick"]) == []


def test_opening_a_trashed_journal_day_restores_it(
    client: TestClient, ws: str, ada: Headers
) -> None:
    url = f"{ws}/notes/journal/2026-01-02"
    entry = client.put(url, headers=ada).json()
    client.post(f"{ws}/notes/{entry['id']}/trash", headers=ada)
    reopened = client.put(url, headers=ada).json()
    assert reopened["id"] == entry["id"]
    assert reopened["trashed_at"] is None


def test_journal_entries_keep_their_type_and_duplicate_as_notes(
    client: TestClient, ws: str, ada: Headers
) -> None:
    entry = client.put(f"{ws}/notes/journal/2026-03-04", headers=ada).json()
    response = client.patch(f"{ws}/notes/{entry['id']}", json={"note_type": "note"}, headers=ada)
    assert response.status_code == 422
    copy = client.post(f"{ws}/notes/{entry['id']}/duplicate", headers=ada).json()
    assert copy["note_type"] == "note"
    assert copy["journal_date"] is None
    assert copy["title"] == "Journal 2026-03-04 (copy)"


def test_todays_journal_uses_the_users_time_zone(client: TestClient, ws: str, ada: Headers) -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    # Kiritimati is UTC+14, so its date is often a day ahead of UTC.
    client.patch("/api/v1/me", json={"timezone": "Pacific/Kiritimati"}, headers=ada)
    entry = client.put(f"{ws}/notes/journal/today", headers=ada).json()
    assert entry["journal_date"] == datetime.now(ZoneInfo("Pacific/Kiritimati")).date().isoformat()


def test_journal_dates_are_bounded(client: TestClient, ws: str, ada: Headers) -> None:
    assert client.put(f"{ws}/notes/journal/1999-12-31", headers=ada).status_code == 422
    assert client.put(f"{ws}/notes/journal/not-a-date", headers=ada).status_code == 422


# Search and listing


def test_search_matches_titles_content_tags_and_folders(
    client: TestClient, ws: str, ada: Headers
) -> None:
    recipes = folder(client, ws, ada, "Recipes")
    create(client, ws, ada, title="Pasta night")
    create(client, ws, ada, title="Groceries", content=doc("Need basil and tomatoes"))
    create(client, ws, ada, title="Trip", tags=["vacation"])
    create(client, ws, ada, title="Soup", folder_id=recipes["id"])

    assert titles(client, ws, ada, q="PASTA") == ["Pasta night"]
    assert titles(client, ws, ada, q="basil") == ["Groceries"]
    assert titles(client, ws, ada, q="vacat") == ["Trip"]
    assert titles(client, ws, ada, q="recipes") == ["Soup"]
    # Every word must match somewhere.
    assert titles(client, ws, ada, q="groceries tomatoes") == ["Groceries"]
    assert titles(client, ws, ada, q="groceries pasta") == []
    # LIKE wildcards are literal.
    assert titles(client, ws, ada, q="%") == []


def test_search_results_carry_an_excerpt_around_the_match(
    client: TestClient, ws: str, ada: Headers
) -> None:
    filler = "word " * 60
    create(client, ws, ada, title="Long", content=doc(filler + "the needle is here " + filler))
    note = client.get(f"{ws}/notes", params={"q": "needle"}, headers=ada).json()["notes"][0]
    assert "needle" in note["excerpt"]
    assert note["excerpt"].startswith("…")
    assert "content" not in note


def test_filters_and_sorting(client: TestClient, ws: str, ada: Headers) -> None:
    banana = create(client, ws, ada, title="banana")
    apple = create(client, ws, ada, title="Apple", note_type="quick")
    create(client, ws, ada, title="")
    patch(client, ws, ada, banana, is_favorite=True)
    patch(client, ws, ada, apple, is_pinned=True)

    assert titles(client, ws, ada, favorite=True) == ["banana"]
    assert titles(client, ws, ada, pinned=True) == ["Apple"]
    assert titles(client, ws, ada, type="quick") == ["Apple"]
    assert titles(client, ws, ada, sort="title") == ["Apple", "banana", ""]
    assert titles(client, ws, ada, sort="title", order="desc") == ["banana", "Apple", ""]
    assert titles(client, ws, ada, sort="created_at") == ["", "Apple", "banana"]
    assert titles(client, ws, ada, sort="created_at", order="asc") == ["banana", "Apple", ""]
    assert titles(client, ws, ada, sort="created_at", order="asc", pinned_first=True)[0] == "Apple"
    bad = client.get(
        f"{ws}/notes", params={"inbox": True, "folder_id": str(uuid.uuid4())}, headers=ada
    )
    assert bad.status_code == 422


def test_pagination(client: TestClient, ws: str, ada: Headers) -> None:
    for number in range(5):
        create(client, ws, ada, title=f"n{number}")
    page = client.get(
        f"{ws}/notes", params={"sort": "title", "limit": 2, "offset": 2}, headers=ada
    ).json()
    assert page["total"] == 5
    assert [n["title"] for n in page["notes"]] == ["n2", "n3"]
    assert client.get(f"{ws}/notes", params={"limit": 101}, headers=ada).status_code == 422


# Attachments


def test_attachments_upload_download_and_remove(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings
) -> None:
    note = create(client, ws, ada)
    url = f"{ws}/notes/{note['id']}/attachments"
    response = client.post(
        url,
        params={"filename": "photo.png"},
        content=PNG,
        headers={**ada, "Content-Type": "text/html"},
    )
    assert response.status_code == 201, response.text
    attachment = response.json()
    assert attachment["content_type"] == "image/png"  # detected, not the declared type
    assert attachment["size_bytes"] == len(PNG)

    listing = client.get(url, headers=ada).json()
    assert [a["filename"] for a in listing["attachments"]] == ["photo.png"]
    assert listing["max_bytes"] == settings_open.attachment_max_bytes

    stored = settings_open.attachments_dir / note["workspace_id"] / attachment["id"]
    assert stored.read_bytes() == PNG
    # Nothing binary is kept in the database.
    columns = query(settings_open.sqlite_path, "SELECT * FROM note_attachments")[0]
    assert PNG not in [c for c in columns if isinstance(c, bytes)]

    download = client.get(f"{url}/{attachment['id']}", headers=ada)
    assert download.status_code == 200
    assert download.content == PNG
    assert download.headers["content-type"] == "image/png"
    assert download.headers["content-disposition"].startswith("attachment;")
    assert download.headers["x-content-type-options"] == "nosniff"

    assert client.delete(f"{url}/{attachment['id']}", headers=ada).status_code == 204
    assert not stored.exists()
    assert client.get(f"{url}/{attachment['id']}", headers=ada).status_code == 404


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("script.html", b"<script>alert(1)</script>"),
        ("program.exe", b"MZ"),
        ("fake.png", b"<svg></svg>"),
        ("fake.pdf", b"not a pdf"),
        ("binary.txt", b"a\x00b"),
    ],
)
def test_attachment_types_are_validated(
    client: TestClient, ws: str, ada: Headers, filename: str, content: bytes
) -> None:
    note = create(client, ws, ada)
    response = client.post(
        f"{ws}/notes/{note['id']}/attachments",
        params={"filename": filename},
        content=content,
        headers=ada,
    )
    assert response.status_code == 415, filename


def test_attachment_size_and_name_are_validated(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings
) -> None:
    note = create(client, ws, ada)
    url = f"{ws}/notes/{note['id']}/attachments"
    too_big = b"a" * (settings_open.attachment_max_bytes + 1)
    response = client.post(url, params={"filename": "big.txt"}, content=too_big, headers=ada)
    assert response.status_code == 413
    for name in ("../escape.txt", "dir/file.txt", ""):
        response = client.post(url, params={"filename": name}, content=b"hi", headers=ada)
        assert response.status_code == 422, name
    empty = client.post(url, params={"filename": "empty.txt"}, content=b"", headers=ada)
    assert empty.status_code == 422


def test_deleting_a_note_deletes_its_attachment_files(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings
) -> None:
    note = create(client, ws, ada)
    attachment = client.post(
        f"{ws}/notes/{note['id']}/attachments",
        params={"filename": "a.txt"},
        content=b"hello",
        headers=ada,
    ).json()
    stored: Path = settings_open.attachments_dir / note["workspace_id"] / attachment["id"]
    assert stored.exists()
    client.post(f"{ws}/notes/{note['id']}/trash", headers=ada)
    client.post(f"{ws}/notes/empty-trash", headers=ada)
    assert not stored.exists()


def test_deleting_a_workspace_deletes_its_notes_and_files(
    client: TestClient, ada: Headers, settings_open: Settings
) -> None:
    side = client.post(WORKSPACES, json={"name": "Side"}, headers=ada).json()
    side_ws = f"{WORKSPACES}/{side['id']}"
    box = folder(client, side_ws, ada, "Box")
    folder(client, side_ws, ada, "Inner", box["id"])
    note = create(client, side_ws, ada, folder_id=box["id"], tags=["t"])
    client.post(
        f"{side_ws}/notes/{note['id']}/attachments",
        params={"filename": "a.txt"},
        content=b"hello",
        headers=ada,
    )
    assert (settings_open.attachments_dir / side["id"]).is_dir()
    assert client.delete(side_ws, headers=ada).status_code == 204
    assert query(settings_open.sqlite_path, "SELECT count(*) FROM notes") == [(0,)]
    assert query(settings_open.sqlite_path, "SELECT count(*) FROM note_folders") == [(0,)]
    assert not (settings_open.attachments_dir / side["id"]).exists()


# Isolation


def test_other_users_cannot_reach_notes(
    client: TestClient, ws: str, ada: Headers, grace: Headers
) -> None:
    note = create(client, ws, ada, title="Private", tags=["secret"])
    box = folder(client, ws, ada, "Mine")
    attachment = client.post(
        f"{ws}/notes/{note['id']}/attachments",
        params={"filename": "a.txt"},
        content=b"hello",
        headers=ada,
    ).json()

    # Ada's workspace URL is a 404 for Grace, whatever the route.
    for method, path in [
        ("GET", f"{ws}/notes"),
        ("GET", f"{ws}/notes/{note['id']}"),
        ("PATCH", f"{ws}/notes/{note['id']}"),
        ("GET", f"{ws}/notes/{note['id']}/attachments/{attachment['id']}"),
        ("GET", f"{ws}/note-folders"),
        ("GET", f"{ws}/note-tags"),
        ("PUT", f"{ws}/notes/journal/2026-10-31"),
    ]:
        response = client.request(method, path, json={"title": "x"}, headers=grace)
        assert response.status_code == 404, (method, path)
        assert response.json()["detail"] == "Workspace not found."

    # Ada's IDs inside Grace's own workspace behave like IDs that don't exist.
    grace_ws = personal_url(client, grace)
    assert client.get(f"{grace_ws}/notes/{note['id']}", headers=grace).status_code == 404
    url = f"{grace_ws}/notes/{note['id']}/attachments/{attachment['id']}"
    assert client.get(url, headers=grace).status_code == 404
    graces = create(client, grace_ws, grace, title="Hers")
    moved = client.patch(
        f"{grace_ws}/notes/{graces['id']}", json={"folder_id": box["id"]}, headers=grace
    )
    assert moved.status_code == 422
    tag_id = note["tags"][0]["id"]
    assert titles(client, grace_ws, grace, tag_id=tag_id) == []
    assert titles(client, grace_ws, grace, q="Private") == []
    assert client.delete(f"{grace_ws}/note-tags/{tag_id}", headers=grace).status_code == 404


def test_links_cannot_cross_workspaces(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings
) -> None:
    side = client.post(WORKSPACES, json={"name": "Side"}, headers=ada).json()
    side_ws = f"{WORKSPACES}/{side['id']}"
    elsewhere = create(client, side_ws, ada, title="Elsewhere")
    note = create(client, ws, ada, content=doc("x", links=(elsewhere["id"],)))
    assert client.get(f"{ws}/notes/{note['id']}/links", headers=ada).json()["outgoing"] == []
    assert query(settings_open.sqlite_path, "SELECT count(*) FROM note_links") == [(0,)]


def test_the_database_refuses_cross_workspace_relationships(
    client: TestClient, ws: str, ada: Headers, settings_open: Settings
) -> None:
    import sqlite3

    side = client.post(WORKSPACES, json={"name": "Side"}, headers=ada).json()
    note = create(client, ws, ada)
    other = create(client, f"{WORKSPACES}/{side['id']}", ada)
    # The composite foreign key needs both notes in the link's workspace.
    with pytest.raises(sqlite3.IntegrityError):
        query(
            settings_open.sqlite_path,
            "INSERT INTO note_links VALUES (?, ?, ?)",
            uuid.UUID(note["id"]).hex,
            uuid.UUID(other["id"]).hex,
            uuid.UUID(note["workspace_id"]).hex,
        )
