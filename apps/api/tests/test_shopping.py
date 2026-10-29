import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"

Headers = dict[str, str]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def shopping_url(client: TestClient, headers: Headers) -> str:
    """The shopping collection in the user's personal workspace."""
    workspace: dict[str, Any] = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    assert workspace["is_personal"]
    return f"{WORKSPACES}/{workspace['id']}/shopping"


@pytest.fixture
def shop(client: TestClient, ada: Headers) -> str:
    return shopping_url(client, ada)


def lists(client: TestClient, shop: str, headers: Headers) -> list[dict[str, Any]]:
    response = client.get(f"{shop}/lists", headers=headers)
    assert response.status_code == 200, response.text
    result: list[dict[str, Any]] = response.json()["lists"]
    return result


def groceries(client: TestClient, shop: str, headers: Headers) -> dict[str, Any]:
    return lists(client, shop, headers)[0]


def create_list(client: TestClient, shop: str, headers: Headers, name: str) -> dict[str, Any]:
    response = client.post(f"{shop}/lists", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def add(
    client: TestClient, shop: str, list_id: str, headers: Headers, **fields: Any
) -> dict[str, Any]:
    response = client.post(
        f"{shop}/lists/{list_id}/items", json={"name": "Milk", **fields}, headers=headers
    )
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()
    return item


def names(client: TestClient, shop: str, list_id: str, headers: Headers) -> list[str]:
    response = client.get(f"{shop}/lists/{list_id}/items", headers=headers)
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()["items"]]


# Lists


def test_a_workspace_starts_with_an_empty_groceries_list(
    client: TestClient, ada: Headers, shop: str
) -> None:
    [default] = lists(client, shop, ada)

    assert default["name"] == "Groceries"
    assert default["is_default"] is True
    assert (default["needed_count"], default["purchased_count"]) == (0, 0)
    assert default["workspace_id"] == shop.split("/")[-2]
    # Reading again neither duplicates nor replaces it.
    assert lists(client, shop, ada) == [default]


def test_create_rename_and_delete_lists(client: TestClient, ada: Headers, shop: str) -> None:
    default = groceries(client, shop, ada)
    electronics = create_list(client, shop, ada, "  Electronics ")
    gifts = create_list(client, shop, ada, "Gifts")
    assert electronics["name"] == "Electronics"
    assert electronics["is_default"] is False

    assert [entry["name"] for entry in lists(client, shop, ada)] == [
        "Groceries",
        "Electronics",
        "Gifts",
    ]

    renamed = client.patch(
        f"{shop}/lists/{default['id']}", json={"name": "Weekly shop"}, headers=ada
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Weekly shop"
    assert renamed.json()["is_default"] is True

    assert client.delete(f"{shop}/lists/{gifts['id']}", headers=ada).status_code == 204
    assert [entry["name"] for entry in lists(client, shop, ada)] == ["Weekly shop", "Electronics"]


def test_the_default_list_cannot_be_deleted(client: TestClient, ada: Headers, shop: str) -> None:
    default = groceries(client, shop, ada)

    response = client.delete(f"{shop}/lists/{default['id']}", headers=ada)

    assert response.status_code == 409
    assert response.json() == {"detail": "The default shopping list cannot be deleted."}
    assert lists(client, shop, ada)[0]["id"] == default["id"]


def test_deleting_a_list_deletes_its_items(
    client: TestClient, ada: Headers, shop: str, migrated_settings: Settings
) -> None:
    kept = add(client, shop, groceries(client, shop, ada)["id"], ada, name="Bread")
    electronics = create_list(client, shop, ada, "Electronics")
    add(client, shop, electronics["id"], ada, name="Cable")

    client.delete(f"{shop}/lists/{electronics['id']}", headers=ada)

    assert query(migrated_settings.sqlite_path, "SELECT name FROM shopping_items") == [
        (kept["name"],)
    ]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 101},
        {"name": "Tab\there"},
        {"name": "Gifts", "is_default": True},
        {"name": "Gifts", "workspace_id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_list_input_is_validated(
    client: TestClient, ada: Headers, shop: str, body: dict[str, Any]
) -> None:
    default = groceries(client, shop, ada)

    assert client.post(f"{shop}/lists", json=body, headers=ada).status_code == 422
    assert client.patch(f"{shop}/lists/{default['id']}", json=body, headers=ada).status_code == 422


def test_list_counts_follow_item_status(client: TestClient, ada: Headers, shop: str) -> None:
    list_id = groceries(client, shop, ada)["id"]
    add(client, shop, list_id, ada, name="Milk")
    eggs = add(client, shop, list_id, ada, name="Eggs")
    client.post(f"{shop}/items/{eggs['id']}/purchase", headers=ada)
    empty = create_list(client, shop, ada, "Empty")

    overview = lists(client, shop, ada)

    assert (overview[0]["needed_count"], overview[0]["purchased_count"]) == (1, 1)
    assert overview[1]["id"] == empty["id"]
    assert (overview[1]["needed_count"], overview[1]["purchased_count"]) == (0, 0)


# Items


def test_add_an_item_with_defaults(client: TestClient, ada: Headers, shop: str) -> None:
    list_id = groceries(client, shop, ada)["id"]

    item = add(client, shop, list_id, ada, name="  Oat milk ")

    assert item["name"] == "Oat milk"
    assert item["list_id"] == list_id
    assert (item["quantity"], item["url"], item["notes"]) == (None, None, "")
    assert (item["status"], item["purchased_at"]) == ("needed", None)
    assert item["created_at"] == item["updated_at"]


def test_add_an_item_with_every_field(client: TestClient, ada: Headers, shop: str) -> None:
    list_id = create_list(client, shop, ada, "Electronics")["id"]

    item = add(
        client,
        shop,
        list_id,
        ada,
        name="USB-C cable",
        quantity=" 2 ",
        url="https://example.com/cable?colour=black#reviews",
        notes="Braided.\n\t2 m long.",
    )

    assert item["quantity"] == "2"
    assert item["url"] == "https://example.com/cable?colour=black#reviews"
    assert item["notes"] == "Braided.\n\t2 m long."
    assert client.get(f"{shop}/lists/{list_id}/items", headers=ada).json() == {"items": [item]}


def test_blank_quantity_and_url_are_stored_as_none(
    client: TestClient, ada: Headers, shop: str
) -> None:
    item = add(client, shop, groceries(client, shop, ada)["id"], ada, quantity=" ", url="")

    assert (item["quantity"], item["url"]) == (None, None)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": ""},
        {"name": "x" * 201},
        {"name": "Line\nbreak"},
        {"name": "Milk", "quantity": "x" * 51},
        {"name": "Milk", "quantity": "2\nkg"},
        {"name": "Milk", "notes": "x" * 2001},
        {"name": "Milk", "notes": "Bell\x07"},
        {"name": "Milk", "notes": None},
        {"name": "Milk", "url": "javascript:alert(1)"},
        {"name": "Milk", "url": "ftp://example.com/milk"},
        {"name": "Milk", "url": "example.com/milk"},
        {"name": "Milk", "url": "https://"},
        {"name": "Milk", "url": "https://example.com/a b"},
        {"name": "Milk", "url": "https://example.com/" + "x" * 2048},
        {"name": "Milk", "status": "purchased"},
        {"name": "Milk", "list_id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_item_input_is_validated(
    client: TestClient, ada: Headers, shop: str, body: dict[str, Any]
) -> None:
    list_id = groceries(client, shop, ada)["id"]

    response = client.post(f"{shop}/lists/{list_id}/items", json=body, headers=ada)

    assert response.status_code == 422
    assert names(client, shop, list_id, ada) == []


def test_items_are_ordered_needed_first_then_recently_purchased(
    client: TestClient, ada: Headers, shop: str
) -> None:
    list_id = groceries(client, shop, ada)["id"]
    for name in ("Milk", "Eggs", "Bread", "Rice"):
        add(client, shop, list_id, ada, name=name)
    items = {
        item["name"]: item
        for item in client.get(f"{shop}/lists/{list_id}/items", headers=ada).json()["items"]
    }
    client.post(f"{shop}/items/{items['Eggs']['id']}/purchase", headers=ada)
    client.post(f"{shop}/items/{items['Milk']['id']}/purchase", headers=ada)

    assert names(client, shop, list_id, ada) == ["Bread", "Rice", "Milk", "Eggs"]


def test_items_are_kept_per_list(client: TestClient, ada: Headers, shop: str) -> None:
    grocery_id = groceries(client, shop, ada)["id"]
    electronics_id = create_list(client, shop, ada, "Electronics")["id"]
    add(client, shop, grocery_id, ada, name="Milk")
    add(client, shop, electronics_id, ada, name="Charger")

    assert names(client, shop, grocery_id, ada) == ["Milk"]
    assert names(client, shop, electronics_id, ada) == ["Charger"]


def test_update_changes_only_the_given_fields(client: TestClient, ada: Headers, shop: str) -> None:
    item = add(
        client,
        shop,
        groceries(client, shop, ada)["id"],
        ada,
        quantity="1 L",
        url="https://example.com/milk",
        notes="Full fat",
    )

    response = client.patch(f"{shop}/items/{item['id']}", json={"quantity": "2 L"}, headers=ada)

    assert response.status_code == 200
    updated = response.json()
    assert updated["quantity"] == "2 L"
    assert (updated["name"], updated["url"], updated["notes"]) == (
        "Milk",
        "https://example.com/milk",
        "Full fat",
    )
    assert updated["updated_at"] > item["updated_at"]


def test_update_clears_quantity_url_and_notes(client: TestClient, ada: Headers, shop: str) -> None:
    item = add(
        client,
        shop,
        groceries(client, shop, ada)["id"],
        ada,
        quantity="1 L",
        url="https://example.com/milk",
        notes="Full fat",
    )

    response = client.patch(
        f"{shop}/items/{item['id']}",
        json={"quantity": None, "url": "", "notes": ""},
        headers=ada,
    )

    updated = response.json()
    assert (updated["quantity"], updated["url"], updated["notes"]) == (None, None, "")


def test_an_update_that_changes_nothing_keeps_the_timestamp(
    client: TestClient, ada: Headers, shop: str
) -> None:
    item = add(client, shop, groceries(client, shop, ada)["id"], ada, name="Milk")

    response = client.patch(f"{shop}/items/{item['id']}", json={"name": "Milk"}, headers=ada)

    assert response.json() == item


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": None},
        {"notes": None},
        {"name": ""},
        {"url": "mailto:ada@example.com"},
        {"status": "purchased"},
        {"list_id": "00000000-0000-0000-0000-000000000001"},
    ],
)
def test_updates_are_validated(
    client: TestClient, ada: Headers, shop: str, body: dict[str, Any]
) -> None:
    item = add(client, shop, groceries(client, shop, ada)["id"], ada)

    assert client.patch(f"{shop}/items/{item['id']}", json=body, headers=ada).status_code == 422


def test_purchase_and_restock(client: TestClient, ada: Headers, shop: str) -> None:
    item = add(client, shop, groceries(client, shop, ada)["id"], ada)
    item_url = f"{shop}/items/{item['id']}"

    purchased = client.post(f"{item_url}/purchase", headers=ada).json()
    assert purchased["status"] == "purchased"
    assert purchased["purchased_at"] is not None
    # Purchasing again keeps the first purchase time.
    assert client.post(f"{item_url}/purchase", headers=ada).json() == purchased

    restocked = client.post(f"{item_url}/restock", headers=ada).json()
    assert (restocked["status"], restocked["purchased_at"]) == ("needed", None)


def test_delete_an_item(client: TestClient, ada: Headers, shop: str) -> None:
    list_id = groceries(client, shop, ada)["id"]
    item = add(client, shop, list_id, ada)

    assert client.delete(f"{shop}/items/{item['id']}", headers=ada).status_code == 204
    assert client.delete(f"{shop}/items/{item['id']}", headers=ada).status_code == 404
    assert names(client, shop, list_id, ada) == []


def test_restock_a_whole_list(client: TestClient, ada: Headers, shop: str) -> None:
    list_id = groceries(client, shop, ada)["id"]
    other_id = create_list(client, shop, ada, "Other")["id"]
    for name in ("Milk", "Eggs"):
        item = add(client, shop, list_id, ada, name=name)
        client.post(f"{shop}/items/{item['id']}/purchase", headers=ada)
    add(client, shop, list_id, ada, name="Bread")
    elsewhere = add(client, shop, other_id, ada, name="Elsewhere")
    client.post(f"{shop}/items/{elsewhere['id']}/purchase", headers=ada)

    response = client.post(f"{shop}/lists/{list_id}/restock", headers=ada)

    assert response.json() == {"count": 2}
    items = client.get(f"{shop}/lists/{list_id}/items", headers=ada).json()["items"]
    assert {(i["name"], i["status"], i["purchased_at"]) for i in items} == {
        ("Milk", "needed", None),
        ("Eggs", "needed", None),
        ("Bread", "needed", None),
    }
    # Other lists are untouched.
    other = client.get(f"{shop}/lists/{other_id}/items", headers=ada).json()["items"]
    assert other[0]["status"] == "purchased"


def test_clear_purchased_items(client: TestClient, ada: Headers, shop: str) -> None:
    list_id = create_list(client, shop, ada, "Electronics")["id"]
    bought = add(client, shop, list_id, ada, name="Laptop")
    client.post(f"{shop}/items/{bought['id']}/purchase", headers=ada)
    add(client, shop, list_id, ada, name="Mouse")

    response = client.post(f"{shop}/lists/{list_id}/clear-purchased", headers=ada)

    assert response.json() == {"count": 1}
    assert names(client, shop, list_id, ada) == ["Mouse"]
    assert client.post(f"{shop}/lists/{list_id}/clear-purchased", headers=ada).json() == {
        "count": 0
    }


def test_unknown_and_invalid_ids(client: TestClient, ada: Headers, shop: str) -> None:
    missing = uuid.uuid4()
    list_not_found = {"detail": "Shopping list not found."}
    item_not_found = {"detail": "Item not found."}

    for response in [
        client.patch(f"{shop}/lists/{missing}", json={"name": "X"}, headers=ada),
        client.delete(f"{shop}/lists/{missing}", headers=ada),
        client.post(f"{shop}/lists/{missing}/restock", headers=ada),
        client.post(f"{shop}/lists/{missing}/clear-purchased", headers=ada),
        client.get(f"{shop}/lists/{missing}/items", headers=ada),
        client.post(f"{shop}/lists/{missing}/items", json={"name": "Milk"}, headers=ada),
    ]:
        assert (response.status_code, response.json()) == (404, list_not_found)
    for response in [
        client.patch(f"{shop}/items/{missing}", json={"name": "X"}, headers=ada),
        client.post(f"{shop}/items/{missing}/purchase", headers=ada),
        client.post(f"{shop}/items/{missing}/restock", headers=ada),
        client.delete(f"{shop}/items/{missing}", headers=ada),
    ]:
        assert (response.status_code, response.json()) == (404, item_not_found)
    assert client.get(f"{shop}/lists/not-a-uuid/items", headers=ada).status_code == 422


# Isolation


def test_each_workspace_has_its_own_lists(client: TestClient, ada: Headers, shop: str) -> None:
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()
    lab_shop = f"{WORKSPACES}/{lab['id']}/shopping"
    create_list(client, shop, ada, "Personal only")
    personal_groceries = groceries(client, shop, ada)

    lab_lists = lists(client, lab_shop, ada)

    assert [entry["name"] for entry in lab_lists] == ["Groceries"]
    assert lab_lists[0]["id"] != personal_groceries["id"]
    # A list from one workspace cannot be reached through another of the same user's.
    response = client.get(f"{lab_shop}/lists/{personal_groceries['id']}/items", headers=ada)
    assert response.status_code == 404


def test_other_users_cannot_reach_lists_through_the_owners_workspace(
    client: TestClient, ada: Headers, grace: Headers, shop: str
) -> None:
    list_id = groceries(client, shop, ada)["id"]
    item = add(client, shop, list_id, ada, name="Ada's secret")
    item_url = f"{shop}/items/{item['id']}"
    not_found = {"detail": "Workspace not found."}

    attempts = [
        client.get(f"{shop}/lists", headers=grace),
        client.post(f"{shop}/lists", json={"name": "Planted"}, headers=grace),
        client.patch(f"{shop}/lists/{list_id}", json={"name": "Mine"}, headers=grace),
        client.delete(f"{shop}/lists/{list_id}", headers=grace),
        client.post(f"{shop}/lists/{list_id}/restock", headers=grace),
        client.post(f"{shop}/lists/{list_id}/clear-purchased", headers=grace),
        client.get(f"{shop}/lists/{list_id}/items", headers=grace),
        client.post(f"{shop}/lists/{list_id}/items", json={"name": "Planted"}, headers=grace),
        client.patch(item_url, json={"name": "Mine"}, headers=grace),
        client.post(f"{item_url}/purchase", headers=grace),
        client.post(f"{item_url}/restock", headers=grace),
        client.delete(item_url, headers=grace),
    ]

    for response in attempts:
        assert (response.status_code, response.json()) == (404, not_found)
    assert [entry["name"] for entry in lists(client, shop, ada)] == ["Groceries"]
    [unchanged] = client.get(f"{shop}/lists/{list_id}/items", headers=ada).json()["items"]
    assert unchanged == item


def test_other_users_cannot_reach_lists_through_their_own_workspace(
    client: TestClient, ada: Headers, grace: Headers, shop: str
) -> None:
    """Grace's workspace is authorized for her, but Ada's IDs must not resolve inside it."""
    list_id = groceries(client, shop, ada)["id"]
    item = add(client, shop, list_id, ada, name="Ada's item")
    graces = shopping_url(client, grace)
    list_not_found = {"detail": "Shopping list not found."}
    item_not_found = {"detail": "Item not found."}

    for response in [
        client.patch(f"{graces}/lists/{list_id}", json={"name": "Mine"}, headers=grace),
        client.delete(f"{graces}/lists/{list_id}", headers=grace),
        client.post(f"{graces}/lists/{list_id}/restock", headers=grace),
        client.post(f"{graces}/lists/{list_id}/clear-purchased", headers=grace),
        client.get(f"{graces}/lists/{list_id}/items", headers=grace),
        client.post(f"{graces}/lists/{list_id}/items", json={"name": "Planted"}, headers=grace),
    ]:
        assert (response.status_code, response.json()) == (404, list_not_found)
    for response in [
        client.patch(f"{graces}/items/{item['id']}", json={"name": "Mine"}, headers=grace),
        client.post(f"{graces}/items/{item['id']}/purchase", headers=grace),
        client.post(f"{graces}/items/{item['id']}/restock", headers=grace),
        client.delete(f"{graces}/items/{item['id']}", headers=grace),
    ]:
        assert (response.status_code, response.json()) == (404, item_not_found)

    [graces_groceries] = lists(client, graces, grace)
    assert graces_groceries["needed_count"] == 0
    assert names(client, shop, list_id, ada) == ["Ada's item"]


def test_deleting_a_workspace_deletes_its_lists_and_items(
    client: TestClient, ada: Headers, shop: str, migrated_settings: Settings
) -> None:
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()
    lab_shop = f"{WORKSPACES}/{lab['id']}/shopping"
    add(client, lab_shop, groceries(client, lab_shop, ada)["id"], ada, name="Lab item")
    kept = add(client, shop, groceries(client, shop, ada)["id"], ada, name="Kept")

    assert client.delete(f"{WORKSPACES}/{lab['id']}", headers=ada).status_code == 204

    database = migrated_settings.sqlite_path
    assert query(database, "SELECT name FROM shopping_items") == [(kept["name"],)]
    assert len(query(database, "SELECT id FROM shopping_lists")) == 1


@pytest.mark.parametrize(
    ("method", "suffix"),
    [
        ("GET", "/lists"),
        ("POST", "/lists"),
        ("PATCH", f"/lists/{uuid.uuid4()}"),
        ("DELETE", f"/lists/{uuid.uuid4()}"),
        ("POST", f"/lists/{uuid.uuid4()}/restock"),
        ("POST", f"/lists/{uuid.uuid4()}/clear-purchased"),
        ("GET", f"/lists/{uuid.uuid4()}/items"),
        ("POST", f"/lists/{uuid.uuid4()}/items"),
        ("PATCH", f"/items/{uuid.uuid4()}"),
        ("DELETE", f"/items/{uuid.uuid4()}"),
        ("POST", f"/items/{uuid.uuid4()}/purchase"),
        ("POST", f"/items/{uuid.uuid4()}/restock"),
    ],
)
def test_every_shopping_endpoint_requires_authentication(
    client: TestClient, shop: str, method: str, suffix: str
) -> None:
    response = client.request(method, f"{shop}{suffix}", json={"name": "x"})

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
