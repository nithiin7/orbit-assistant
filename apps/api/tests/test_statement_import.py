"""Statement import routes: locked PDFs, preview, import, duplicates, payments, rules, undo, and
isolation. Statement dates are in October 2026; `today` is fixed so nothing depends on the clock.
"""

import base64
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.statement_files import ICICI_HEADER, icici_line, icici_pdf, statement_pdf
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up
from tests.test_commitments import add_recurring
from tests.test_finance import Headers, Json, category, finance_url, open_account, record

TODAY = "2026-10-31"


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
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


@pytest.fixture
def fin(client: TestClient, ada: Headers) -> str:
    return finance_url(client, ada)


def statements_url(fin: str) -> str:
    return f"{fin}/statements"


def preview(
    client: TestClient,
    fin: str,
    headers: Headers,
    account_id: str,
    data: bytes,
    password: str | None = None,
    **params: Any,
) -> Json:
    extra = (
        {"X-Statement-Password": base64.b64encode(password.encode()).decode()} if password else {}
    )
    response = client.post(
        f"{statements_url(fin)}/preview",
        params={"account_id": account_id, "today": TODAY, **params},
        content=data,
        headers={**headers, **extra, "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def confirm(
    client: TestClient, fin: str, headers: Headers, account_id: str, rows: list[Json]
) -> Any:
    body = {
        "account_id": account_id,
        "today": TODAY,
        "rows": [
            {
                key: row[key]
                for key in ("fingerprint", "occurred_on", "description", "amount", "direction")
            }
            | {"action": row["action"], "type": row["type"], "category_id": row["category_id"]}
            | (
                {
                    "settle": {
                        key: row["payment"][key]
                        for key in ("kind", "commitment_id", "occurrence_id", "due_date")
                    }
                }
                if row["action"] == "settle"
                else {}
            )
            for row in rows
            if row["action"] != "skip"
        ],
    }
    return client.post(f"{statements_url(fin)}/imports", json=body, headers=headers)


def transactions(client: TestClient, fin: str, headers: Headers) -> list[Json]:
    response = client.get(f"{fin}/transactions", headers=headers, params={"limit": 100})
    assert response.status_code == 200, response.text
    found: list[Json] = response.json()["transactions"]
    return found


def test_a_locked_pdf_asks_for_its_password(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    locked = icici_pdf(password="ADA1990")

    assert preview(client, fin, ada, account["id"], locked)["status"] == "password_required"
    assert preview(client, fin, ada, account["id"], locked, "nope")["status"] == "wrong_password"
    opened = preview(client, fin, ada, account["id"], locked, "ADA1990")

    assert opened["status"] == "ready"
    assert opened["source"] == "pdf"
    assert [(row["direction"], row["amount"], row["action"]) for row in opened["rows"]] == [
        ("out", 450_00, "create"),
        ("in", 50_000_00, "create"),
        ("out", 1_200_00, "create"),
    ]
    assert [row["type"] for row in opened["rows"]] == ["expense", "income", "expense"]


def test_importing_records_transactions_once(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]

    imported = confirm(client, fin, ada, account["id"], rows)

    assert imported.status_code == 201, imported.text
    assert (imported.json()["created"], imported.json()["settled"]) == (3, 0)
    assert len(transactions(client, fin, ada)) == 3
    again = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    assert {row["reason"] for row in again} == {"already_imported"}
    repeated = confirm(client, fin, ada, account["id"], rows)
    assert repeated.json()["already_imported"] == 3
    assert len(transactions(client, fin, ada)) == 3


def test_a_transaction_typed_in_by_hand_is_a_likely_duplicate(
    client: TestClient, ada: Headers, fin: str
) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    typed = record(
        client,
        fin,
        ada,
        account_id=account["id"],
        amount=1_200_00,
        occurred_on="2026-10-06",
        description="Electricity",
    )

    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]

    bill = rows[2]
    assert (bill["action"], bill["reason"], bill["duplicate_of"]) == (
        "skip",
        "possible_duplicate",
        typed["id"],
    )


def test_a_due_bill_is_settled_by_its_payment(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    bill = add_recurring(
        client,
        fin,
        ada,
        kind="bill",
        name="Electricity",
        provider="BESCOM",
        amount=1_200_00,
        next_due_date="2026-10-07",
    )

    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    payment = rows[2]
    assert (payment["action"], payment["reason"]) == ("settle", "payment_due")
    assert payment["payment"]["commitment_id"] == bill["id"]

    imported = confirm(client, fin, ada, account["id"], rows)

    assert (imported.json()["created"], imported.json()["settled"]) == (2, 1)
    paid = [tx for tx in transactions(client, fin, ada) if tx["amount"] == 1_200_00]
    assert [tx["description"] for tx in paid] == ["Electricity"]
    later = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    assert later[2]["reason"] == "already_imported"


def test_chosen_categories_are_remembered(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    food = category(client, fin, ada, "Food and dining")
    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    rows[0]["category_id"] = food
    confirm(client, fin, ada, account["id"], [rows[0]])

    other = open_account(client, fin, ada, name="Axis Savings")
    pdf = statement_pdf(
        [
            [
                ICICI_HEADER,
                icici_line("20-10-2026", "UPI", "UPI/99887766/SWIGGY/ybl/", "", "300.00", ""),
            ]
        ]
    )
    [later] = preview(client, fin, ada, other["id"], pdf)["rows"]

    assert later["category_id"] == food


def test_rows_the_balance_contradicts_cannot_be_imported_silently(
    client: TestClient, ada: Headers, fin: str
) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    pdf = statement_pdf(
        [
            [
                ICICI_HEADER,
                icici_line(particulars="B/F", balance="1,000.00"),
                icici_line("01-10-2026", "UPI", "COFFEE", "", "100.00", "900.00"),
                icici_line("02-10-2026", "UPI", "BOOKS", "", "250.00", "600.00"),
            ]
        ]
    )

    rows = preview(client, fin, ada, account["id"], pdf)["rows"]

    assert [(row["action"], row["reason"]) for row in rows] == [
        ("create", "new"),
        ("skip", "balance_mismatch"),
    ]


def test_undo_removes_an_import(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    batch = confirm(client, fin, ada, account["id"], rows).json()["batch_id"]

    undone = client.delete(f"{statements_url(fin)}/imports/{batch}", headers=ada)

    assert undone.status_code == 200, undone.text
    assert undone.json() == {"removed": 3, "kept": 0}
    assert transactions(client, fin, ada) == []
    assert {
        row["reason"] for row in preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    } == {"new"}
    gone = client.delete(f"{statements_url(fin)}/imports/{batch}", headers=ada)
    assert gone.status_code == 404


def test_undo_keeps_a_transaction_a_payment_uses(
    client: TestClient, ada: Headers, fin: str
) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    add_recurring(
        client,
        fin,
        ada,
        kind="bill",
        name="Electricity",
        amount=1_200_00,
        next_due_date="2026-10-07",
    )
    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    batch = confirm(client, fin, ada, account["id"], rows).json()["batch_id"]

    undone = client.delete(f"{statements_url(fin)}/imports/{batch}", headers=ada).json()

    assert undone == {"removed": 2, "kept": 1}
    assert [tx["description"] for tx in transactions(client, fin, ada)] == ["Electricity"]


def test_a_failed_row_imports_nothing(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada, name="ICICI Savings")
    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    salary = category(client, fin, ada, "Salary")
    rows[2]["category_id"] = salary  # An income category on spending.

    failed = confirm(client, fin, ada, account["id"], rows)

    assert failed.status_code == 422
    assert transactions(client, fin, ada) == []


def test_an_unreadable_file_is_refused(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada)
    response = client.post(
        f"{statements_url(fin)}/preview",
        params={"account_id": account["id"], "today": TODAY},
        content=b"%PDF-1.7 not really",
        headers={**ada, "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 422


def test_columns_can_be_mapped_by_hand(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada)
    csv_bytes = b"When,What,Money\n2026-10-01,COFFEE,-100.00\n2026-10-02,REFUND,50.00\n"
    unknown = preview(client, fin, ada, account["id"], csv_bytes)
    assert unknown["status"] == "needs_mapping"
    assert unknown["headers"] == ["When", "What", "Money"]

    mapped = preview(
        client,
        fin,
        ada,
        account["id"],
        csv_bytes,
        header_row=unknown["header_row"],
        date_column=0,
        description_column=1,
        amount_column=2,
    )

    assert [(row["direction"], row["amount"]) for row in mapped["rows"]] == [
        ("out", 100_00),
        ("in", 50_00),
    ]


def test_ambiguous_dates_ask_for_their_order(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(client, fin, ada)
    csv_bytes = b"Date,Narration,Amount\n03/04/2026,A,-1.00\n04/03/2026,B,-2.00\n"

    asked = preview(client, fin, ada, account["id"], csv_bytes)
    answered = preview(client, fin, ada, account["id"], csv_bytes, date_order="mdy")

    assert (asked["status"], asked["needs_date_order"]) == ("needs_mapping", True)
    assert [row["occurred_on"] for row in answered["rows"]] == ["2026-03-04", "2026-04-03"]


def test_another_person_cannot_import_into_or_undo_an_account(
    client: TestClient, ada: Headers, grace: Headers, fin: str
) -> None:
    account = open_account(client, fin, ada)
    rows = preview(client, fin, ada, account["id"], icici_pdf())["rows"]
    batch = confirm(client, fin, ada, account["id"], rows).json()["batch_id"]
    graces = finance_url(client, grace)

    sneaky = client.post(
        f"{statements_url(graces)}/preview",
        params={"account_id": account["id"], "today": TODAY},
        content=icici_pdf(),
        headers={**grace, "Content-Type": "application/octet-stream"},
    )
    assert sneaky.status_code == 404
    assert confirm(client, graces, grace, account["id"], rows).status_code == 404
    assert (
        client.delete(f"{statements_url(graces)}/imports/{batch}", headers=grace).status_code == 404
    )
    assert client.delete(f"{statements_url(fin)}/imports/{batch}", headers=grace).status_code in (
        403,
        404,
    )
    assert len(transactions(client, fin, ada)) == 3
