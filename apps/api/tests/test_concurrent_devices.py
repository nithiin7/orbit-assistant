"""Two devices signed in to the same account, writing to the same workspace at the same time.

Orbit has no device-to-device sync: every device reads and writes through the one API, so
"multi-device" correctness is the API's correctness under concurrent requests. These tests send
truly concurrent requests (one event loop, many in flight) from two sessions against SQLite,
the database most sensitive to concurrent writers.
"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import httpx2 as httpx
import pytest
from fastapi import FastAPI

from orbit_api.config import Settings
from orbit_api.db.database import open_database
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, PASSWORD

Headers = dict[str, str]


@pytest.fixture
async def http(migrated_settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    app: FastAPI = create_app(migrated_settings)
    app.state.password_hasher = FAST_PASSWORD_HASHER
    # The transport doesn't run the lifespan; open the database the way it would.
    app.state.database = await open_database(migrated_settings)
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://orbit") as client:
            yield client
    finally:
        await app.state.database.dispose()


async def _devices(http: httpx.AsyncClient) -> tuple[Headers, Headers, str]:
    """Two sessions of one account (a laptop and a phone) and their personal workspace."""
    body = {"email": "ada@example.com", "password": PASSWORD}
    first = await http.post("/api/v1/auth/local/sign-up", json={**body, "display_name": "Ada"})
    second = await http.post("/api/v1/auth/local/sign-in", json=body)
    laptop = {"Authorization": f"Bearer {first.json()['access_token']}"}
    phone = {"Authorization": f"Bearer {second.json()['access_token']}"}
    workspaces = (await http.get("/api/v1/workspaces", headers=laptop)).json()["workspaces"]
    return laptop, phone, f"/api/v1/workspaces/{workspaces[0]['id']}"


@pytest.mark.anyio
async def test_concurrent_transactions_from_two_devices_are_all_kept_exactly_once(
    http: httpx.AsyncClient,
) -> None:
    laptop, phone, ws = await _devices(http)
    account = await http.post(
        f"{ws}/finance/accounts",
        json={"name": "Bank", "type": "bank", "opening_balance": 1_000_000},
        headers=laptop,
    )
    categories = (await http.get(f"{ws}/finance/categories", headers=phone)).json()["categories"]
    expense = next(c["id"] for c in categories if c["type"] == "expense")
    amounts = [101 * (number + 1) for number in range(40)]

    def record(number: int, amount: int) -> Any:
        return http.post(
            f"{ws}/finance/transactions",
            json={
                "type": "expense",
                "amount": amount,
                "account_id": account.json()["id"],
                "category_id": expense,
                "occurred_on": "2026-11-03",
                "description": f"Purchase {number}",
            },
            headers=laptop if number % 2 else phone,
        )

    responses = await asyncio.gather(
        *(record(number, amount) for number, amount in enumerate(amounts))
    )

    assert [response.status_code for response in responses] == [201] * len(amounts)
    listed = await http.get(f"{ws}/finance/transactions", params={"limit": 100}, headers=laptop)
    descriptions = sorted(entry["description"] for entry in listed.json()["transactions"])
    assert descriptions == sorted(f"Purchase {number}" for number in range(len(amounts)))
    accounts = (await http.get(f"{ws}/finance/accounts", headers=phone)).json()["accounts"]
    assert accounts[0]["balance"] == 1_000_000 - sum(amounts)


def _doc(text: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


@pytest.mark.anyio
async def test_simultaneous_saves_of_one_note_keep_exactly_one_and_refuse_the_other(
    http: httpx.AsyncClient,
) -> None:
    laptop, phone, ws = await _devices(http)
    note = (
        await http.post(
            f"{ws}/notes", json={"title": "Plan", "content": _doc("v1")}, headers=laptop
        )
    ).json()
    url = f"{ws}/notes/{note['id']}"

    from_laptop, from_phone = await asyncio.gather(
        http.patch(url, json={"content": _doc("laptop"), "expected_revision": 1}, headers=laptop),
        http.patch(url, json={"content": _doc("phone"), "expected_revision": 1}, headers=phone),
    )

    assert sorted([from_laptop.status_code, from_phone.status_code]) == [200, 409]
    winner = "laptop" if from_laptop.status_code == 200 else "phone"
    current = (await http.get(url, headers=phone)).json()
    assert current["revision"] == 2
    assert current["content"] == _doc(winner)


@pytest.mark.anyio
async def test_completing_one_task_from_both_devices_settles_on_one_state(
    http: httpx.AsyncClient,
) -> None:
    laptop, phone, ws = await _devices(http)
    task = (await http.post(f"{ws}/tasks", json={"title": "Pay rent"}, headers=laptop)).json()
    url = f"{ws}/tasks/{task['id']}"

    responses = await asyncio.gather(
        *(http.post(f"{url}/complete", headers=laptop if n % 2 else phone) for n in range(6))
    )

    assert {response.status_code for response in responses} == {200}
    tasks = (await http.get(f"{ws}/tasks", headers=phone)).json()["tasks"]
    assert [(t["title"], t["status"]) for t in tasks] == [("Pay rent", "completed")]


@pytest.mark.anyio
async def test_signing_out_one_device_leaves_the_other_signed_in(
    http: httpx.AsyncClient,
) -> None:
    laptop, phone, _ = await _devices(http)

    await http.post("/api/v1/auth/local/sign-out", headers=phone)

    assert (await http.get("/api/v1/me", headers=phone)).status_code == 401
    assert (await http.get("/api/v1/me", headers=laptop)).status_code == 200
