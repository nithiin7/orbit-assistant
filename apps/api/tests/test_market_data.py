"""Market data: the mfapi.in and Yahoo Finance adapter, instrument search, price refreshes, units
worked out from a mutual fund's NAV, holdings added with what is already owned, and auto-debit
SIPs recorded by the worker.

The feed is replaced by a fake in API tests; the adapter is tested over a mock transport. No
test contacts a real service.
"""

import asyncio
import json
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime
from typing import Any, cast

import httpx2
import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import open_database
from orbit_api.main import create_app
from orbit_api.providers.prices.feed import HttpPriceFeed
from orbit_api.scheduler.worker import MarketData, ReminderWorker
from orbit_api.services.finance.money import Currency
from orbit_api.services.investments.models import Holding, HoldingKind
from orbit_api.services.investments.quantities import parse_price
from orbit_api.services.investments.valuation import (
    Instrument,
    PriceFeedError,
    Quote,
    price_key,
)
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"
NOTIFICATIONS = "/api/v1/me/notifications"
LAKH = 100_000_00
FUND_CODE = "122639"

Headers = dict[str, str]
Json = dict[str, Any]


class FakeFeed:
    """Prices by feed key and date; records what it was asked for."""

    def __init__(self) -> None:
        self.prices: dict[str, dict[date, str]] = {}
        self.asked: list[str] = []
        self.failing = False

    async def quotes(self, holding: Holding, start: date, end: date) -> list[Quote]:
        key = price_key(holding)
        assert key is not None
        self.asked.append(key)
        if self.failing:
            raise PriceFeedError
        return [
            Quote(holding.id, day, parse_price(price), "provider")
            for day, price in sorted(self.prices.get(key, {}).items())
            if start <= day <= end
        ]

    async def search(self, kind: HoldingKind, query: str) -> list[Instrument]:
        self.asked.append(query)
        return [
            Instrument(
                kind=kind,
                name="Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
                symbol=FUND_CODE,
                currency="INR",
            )
        ]

    async def aclose(self) -> None:
        return None


@pytest.fixture
def feed() -> FakeFeed:
    return FakeFeed()


@pytest.fixture
def market_settings(migrated_settings: Settings) -> Settings:
    return migrated_settings.model_copy(
        update={"local_open_registration": True, "market_data_enabled": True}
    )


@pytest.fixture
def client(market_settings: Settings, feed: FakeFeed) -> Iterator[TestClient]:
    app = create_app(market_settings)
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.price_feed = feed
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def fin(client: TestClient, ada: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=ada).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/finance"


def ok(response: Any, code: int = 200) -> Json:
    assert response.status_code == code, response.text
    body: Json = response.json()
    return body


@pytest.fixture
def bank(client: TestClient, ada: Headers, fin: str) -> Json:
    body = {"name": "HDFC Savings", "type": "bank", "opening_balance": 10 * LAKH}
    return ok(client.post(f"{fin}/accounts", json=body, headers=ada), 201)


@pytest.fixture
def folio(client: TestClient, ada: Headers, fin: str) -> Json:
    body = {"name": "Coin", "kind": "mutual_fund"}
    return ok(client.post(f"{fin}/investment-accounts", json=body, headers=ada), 201)


def add_fund(
    client: TestClient, fin: str, headers: Headers, account_id: str, **fields: Any
) -> Json:
    body = {
        "account_id": account_id,
        "kind": "mutual_fund",
        "name": "Parag Parikh Flexi Cap Fund",
        "symbol": FUND_CODE,
        **fields,
    }
    return ok(client.post(f"{fin}/holdings", json=body, headers=headers), 201)


def balance(client: TestClient, fin: str, headers: Headers, name: str) -> int:
    accounts: list[Json] = ok(client.get(f"{fin}/accounts", headers=headers))["accounts"]
    return next(account["balance"] for account in accounts if account["name"] == name)


# API


def test_market_data_is_off_unless_the_server_turns_it_on(migrated_settings: Settings) -> None:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.price_feed = FakeFeed()
    with TestClient(app) as client:
        ada = bearer(sign_up(client, email="ada@example.com", display_name="Ada"))
        workspace = client.get(WORKSPACES, headers=ada).json()["workspaces"][0]
        fin = f"{WORKSPACES}/{workspace['id']}/finance"
        assert ok(client.get(f"{fin}/market-data", headers=ada)) == {"enabled": False}
        search = client.get(
            f"{fin}/market-data/search", params={"kind": "stock", "q": "infosys"}, headers=ada
        )
        assert search.status_code == 409
        assert client.post(f"{fin}/market-data/refresh", headers=ada).status_code == 409
    assert app.state.price_feed.asked == []


def test_instruments_can_be_searched(
    client: TestClient, ada: Headers, fin: str, feed: FakeFeed
) -> None:
    assert ok(client.get(f"{fin}/market-data", headers=ada)) == {"enabled": True}
    found = ok(
        client.get(
            f"{fin}/market-data/search", params={"kind": "mutual_fund", "q": "parag"}, headers=ada
        )
    )["instruments"]
    assert [(item["symbol"], item["currency"]) for item in found] == [(FUND_CODE, "INR")]
    short = client.get(
        f"{fin}/market-data/search", params={"kind": "mutual_fund", "q": "p"}, headers=ada
    )
    assert short.status_code == 422


def test_a_fund_buy_without_units_uses_the_nav_on_its_date(
    client: TestClient, ada: Headers, fin: str, folio: Json, bank: Json, feed: FakeFeed
) -> None:
    fund = add_fund(client, fin, ada, folio["account_id"])
    # The 4th is a Saturday: the buy is allotted at the next NAV, Monday's.
    feed.prices[FUND_CODE] = {date(2025, 1, 3): "80", date(2025, 1, 6): "121.5"}
    entry = ok(
        client.post(
            f"{fin}/investment-transactions",
            json={
                "type": "buy",
                "holding_id": fund["id"],
                "trade_date": "2025-01-04",
                "amount": 5_000_00,
                "settlement": "account",
                "cash_account_id": bank["id"],
            },
            headers=ada,
        ),
        201,
    )
    # 5,000 / 121.5 = 41.15226…, allotted to 3 decimals.
    assert entry["quantity"] == "41.152"
    prices = ok(client.get(f"{fin}/holdings/{fund['id']}/prices", headers=ada))["prices"]
    assert {(price["price_date"], price["source"]) for price in prices} >= {
        ("2025-01-06", "provider")
    }
    assert balance(client, fin, ada, "HDFC Savings") == 10 * LAKH - 5_000_00


def test_units_are_required_when_no_nav_is_known(
    client: TestClient, ada: Headers, fin: str, folio: Json, feed: FakeFeed
) -> None:
    fund = add_fund(client, fin, ada, folio["account_id"], symbol="")
    buy = {
        "type": "buy",
        "holding_id": fund["id"],
        "trade_date": "2025-03-10",
        "amount": 1_000_00,
        "settlement": "none",
    }
    missing = client.post(f"{fin}/investment-transactions", json=buy, headers=ada)
    assert missing.status_code == 422
    assert "NAV" in missing.json()["detail"]
    assert feed.asked == []  # Nothing to look it up by.

    # A NAV entered by hand works the same way; one from before the date is the fallback.
    ok(
        client.post(
            f"{fin}/holdings/{fund['id']}/prices",
            json={"price_date": "2025-03-07", "price": "40"},
            headers=ada,
        )
    )
    entry = ok(client.post(f"{fin}/investment-transactions", json=buy, headers=ada), 201)
    assert entry["quantity"] == "25"

    # Shares are never worked out from an amount.
    broker = ok(
        client.post(
            f"{fin}/investment-accounts", json={"name": "Zerodha", "kind": "brokerage"}, headers=ada
        ),
        201,
    )
    stock = ok(
        client.post(
            f"{fin}/holdings",
            json={"account_id": broker["account_id"], "kind": "stock", "name": "Infosys"},
            headers=ada,
        ),
        201,
    )
    shares = client.post(
        f"{fin}/investment-transactions",
        json={**buy, "holding_id": stock["id"]},
        headers=ada,
    )
    assert shares.status_code == 422


def test_a_holding_can_be_added_with_what_is_already_owned(
    client: TestClient, ada: Headers, fin: str, folio: Json, feed: FakeFeed
) -> None:
    feed.prices[FUND_CODE] = {date(2024, 6, 3): "50", date(2025, 1, 6): "60"}
    fund = add_fund(
        client,
        fin,
        ada,
        folio["account_id"],
        opening={"trade_date": "2024-06-03", "amount": 1 * LAKH},
    )
    assert fund["quantity"] == "2000"
    assert fund["cost"] == 1 * LAKH

    with_units = add_fund(
        client,
        fin,
        ada,
        folio["account_id"],
        name="Nifty 50 Index Fund",
        symbol="",
        opening={"trade_date": "2023-04-01", "amount": 50_000_00, "quantity": "812.345"},
    )
    assert with_units["quantity"] == "812.345"
    # Bought before Orbit: no money moved in the ledger.
    activity = ok(
        client.get(
            f"{fin}/investment-transactions", params={"holding_id": with_units["id"]}, headers=ada
        )
    )["transactions"]
    assert [(entry["settlement"], entry["cash_transaction_id"]) for entry in activity] == [
        ("none", None)
    ]

    # A rejected opening position adds no holding.
    failed = client.post(
        f"{fin}/holdings",
        json={
            "account_id": folio["account_id"],
            "kind": "mutual_fund",
            "name": "Unknown Fund",
            "opening": {"trade_date": "2024-01-01", "amount": 1_000_00},
        },
        headers=ada,
    )
    assert failed.status_code == 422
    names = [item["name"] for item in ok(client.get(f"{fin}/holdings", headers=ada))["holdings"]]
    assert "Unknown Fund" not in names


def test_prices_can_be_refreshed(
    client: TestClient, ada: Headers, fin: str, folio: Json, feed: FakeFeed
) -> None:
    fund = add_fund(client, fin, ada, folio["account_id"])
    add_fund(client, fin, ada, folio["account_id"], name="No code", symbol="")
    today = datetime.now(UTC).date()
    feed.prices[FUND_CODE] = {today: "99.1234"}
    result = ok(client.post(f"{fin}/market-data/refresh", headers=ada))
    assert result == {"updated": 1, "failed": 0}
    assert ok(client.get(f"{fin}/holdings/{fund['id']}", headers=ada))["price"]["price"] == (
        "99.1234"
    )
    feed.failing = True
    assert ok(client.post(f"{fin}/market-data/refresh", headers=ada)) == {"updated": 0, "failed": 1}


def test_auto_debit_needs_a_fund_and_a_funding_account(
    client: TestClient, ada: Headers, fin: str, folio: Json, bank: Json
) -> None:
    fund = add_fund(client, fin, ada, folio["account_id"])
    sip = {"holding_id": fund["id"], "amount": 5_000_00, "next_due_date": "2025-01-05"}
    unfunded = client.post(f"{fin}/sip-plans", json={**sip, "auto_debit": True}, headers=ada)
    assert unfunded.status_code == 422
    plan = ok(
        client.post(
            f"{fin}/sip-plans",
            json={**sip, "auto_debit": True, "funding_account_id": bank["id"]},
            headers=ada,
        ),
        201,
    )
    assert plan["auto_debit"] is True
    cleared = client.patch(
        f"{fin}/sip-plans/{plan['id']}", json={"funding_account_id": None}, headers=ada
    )
    assert cleared.status_code == 422
    off = ok(client.patch(f"{fin}/sip-plans/{plan['id']}", json={"auto_debit": False}, headers=ada))
    assert off["auto_debit"] is False

    broker = ok(
        client.post(
            f"{fin}/investment-accounts", json={"name": "Zerodha", "kind": "brokerage"}, headers=ada
        ),
        201,
    )
    stock = ok(
        client.post(
            f"{fin}/holdings",
            json={"account_id": broker["account_id"], "kind": "stock", "name": "Infosys"},
            headers=ada,
        ),
        201,
    )
    stock_sip = client.post(
        f"{fin}/sip-plans",
        json={
            **sip,
            "holding_id": stock["id"],
            "auto_debit": True,
            "funding_account_id": bank["id"],
        },
        headers=ada,
    )
    assert stock_sip.status_code == 422


# The worker


def test_the_worker_records_due_auto_debit_installments_once(
    client: TestClient,
    ada: Headers,
    fin: str,
    folio: Json,
    bank: Json,
    feed: FakeFeed,
    market_settings: Settings,
) -> None:
    fund = add_fund(client, fin, ada, folio["account_id"])
    for anchor, auto in (("2025-01-05", True), ("2024-06-05", True), ("2025-01-05", False)):
        ok(
            client.post(
                f"{fin}/sip-plans",
                json={
                    "holding_id": fund["id"],
                    "amount": 5_000_00,
                    "next_due_date": anchor,
                    "funding_account_id": bank["id"],
                    "auto_debit": auto,
                },
                headers=ada,
            ),
            201,
        )
    clock = datetime(2025, 1, 6, 6, 0, tzinfo=UTC)

    async def run() -> list[int]:
        database = await open_database(market_settings)
        try:
            worker = ReminderWorker(
                database, clock=lambda: clock, market=MarketData(market_settings, feed)
            )
            counts = [await worker.record_sips()]  # The 5th's NAV isn't published yet.
            feed.prices[FUND_CODE] = {date(2025, 1, 5): "100"}
            counts.append(await worker.record_sips())
            counts.append(await worker.record_sips())
            return counts
        finally:
            await database.dispose()

    # Each auto-debit SIP records the 5 January installment once; the older SIP's missed
    # installments (from mid-2024) are left for the person, and the manual SIP is untouched.
    assert asyncio.run(run()) == [0, 2, 0]
    plans: list[Json] = ok(
        client.get(f"{fin}/sip-plans", params={"today": "2025-01-06"}, headers=ada)
    )["plans"]
    assert sorted((plan["auto_debit"], plan["installments"]) for plan in plans) == [
        (False, 0),
        (True, 1),
        (True, 1),
    ]
    assert ok(client.get(f"{fin}/holdings/{fund['id']}", headers=ada))["quantity"] == "100"
    assert balance(client, fin, ada, "HDFC Savings") == 10 * LAKH - 2 * 5_000_00
    notifications: list[Json] = ok(client.get(NOTIFICATIONS, headers=ada))["notifications"]
    titles = [item["title"] for item in notifications]
    assert titles.count("SIP recorded: Parag Parikh Flexi Cap Fund") == 2
    assert "50 units at a NAV of 100.00" in notifications[0]["body"]


def test_the_worker_refreshes_prices_only_while_market_data_is_on(
    client: TestClient,
    ada: Headers,
    fin: str,
    folio: Json,
    feed: FakeFeed,
    market_settings: Settings,
) -> None:
    fund = add_fund(client, fin, ada, folio["account_id"])
    now = datetime.now(UTC)
    feed.prices[FUND_CODE] = {now.date(): "42"}

    async def run(settings: Settings) -> int:
        database = await open_database(settings)
        try:
            worker = ReminderWorker(database, clock=lambda: now, market=MarketData(settings, feed))
            return await worker.refresh_prices()
        finally:
            await database.dispose()

    off = market_settings.model_copy(update={"market_data_enabled": False})
    assert asyncio.run(run(off)) == 0
    feed.asked.clear()
    assert asyncio.run(run(market_settings)) == 1
    assert feed.asked == [FUND_CODE]
    assert ok(client.get(f"{fin}/holdings/{fund['id']}", headers=ada))["price"]["price"] == "42"


# The adapter


def _holding(kind: HoldingKind, symbol: str, exchange: str = "", currency: str = "INR") -> Holding:
    now = datetime.now(UTC)
    return Holding(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        currency=cast(Currency, currency),
        kind=kind,
        name="Holding",
        symbol=symbol,
        exchange=exchange,
        isin="",
        issuer="",
        category="",
        folio="",
        notes="",
        created_at=now,
        updated_at=now,
    )


def test_price_keys() -> None:
    assert price_key(_holding("mutual_fund", FUND_CODE)) == FUND_CODE
    assert price_key(_holding("mutual_fund", "PPFAS")) is None
    assert price_key(_holding("stock", "infy", "nse")) == "INFY.NS"
    assert price_key(_holding("stock", "500209", "BSE")) == "500209.BO"
    assert price_key(_holding("etf", "VOO", "NYSE Arca")) == "VOO"
    assert price_key(_holding("stock", "RELIANCE.NS", "NSE")) == "RELIANCE.NS"
    assert price_key(_holding("stock", "")) is None


def _feed(handler: Callable[[httpx2.Request], httpx2.Response]) -> HttpPriceFeed:
    return HttpPriceFeed(transport=httpx2.MockTransport(handler))


def test_the_adapter_reads_mutual_fund_navs() -> None:
    seen: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(str(request.url))
        body = {
            "meta": {"scheme_code": 122639},
            "data": [
                {"date": "07-01-2025", "nav": "82.41230"},
                {"date": "06-01-2025", "nav": "81.9"},
                {"date": "03-01-2025", "nav": "bad"},
                {"date": "02-01-2025", "nav": "80.1"},
            ],
        }
        return httpx2.Response(200, json=body)

    async def run() -> tuple[list[Quote], list[Quote]]:
        feed = _feed(handler)
        try:
            fund = _holding("mutual_fund", FUND_CODE)
            usd = _holding("mutual_fund", FUND_CODE, currency="USD")
            return (
                await feed.quotes(fund, date(2025, 1, 3), date(2025, 1, 10)),
                await feed.quotes(usd, date(2025, 1, 3), date(2025, 1, 10)),
            )
        finally:
            await feed.aclose()

    quotes, other_currency = asyncio.run(run())
    assert [(quote.price_date, quote.price) for quote in quotes] == [
        (date(2025, 1, 6), 81_900_000),
        (date(2025, 1, 7), 82_412_300),
    ]
    assert other_currency == []
    assert seen == [f"https://api.mfapi.in/mf/{FUND_CODE}"]


def test_the_adapter_reads_yahoo_charts_in_the_exchange_time_zone() -> None:
    # 09:15 IST (03:45 UTC) on 6 and 7 January 2025; the second has no close.
    stamps = [1736135100, 1736221500]

    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/v8/finance/chart/INFY.NS"
        assert request.headers["user-agent"].startswith("Mozilla/5.0")
        if request.url.params.get("interval") != "1d":
            return httpx2.Response(400)
        result = {
            "meta": {"currency": "INR", "exchangeTimezoneName": "Asia/Kolkata"},
            "timestamp": stamps,
            "indicators": {"quote": [{"close": [1920.4500122070312, None]}]},
        }
        return httpx2.Response(200, json={"chart": {"result": [result], "error": None}})

    async def run() -> tuple[list[Quote], list[Quote]]:
        feed = _feed(handler)
        try:
            return (
                await feed.quotes(
                    _holding("stock", "INFY", "NSE"), date(2025, 1, 1), date(2025, 1, 7)
                ),
                await feed.quotes(
                    _holding("stock", "INFY", "NSE", currency="USD"),
                    date(2025, 1, 1),
                    date(2025, 1, 7),
                ),
            )
        finally:
            await feed.aclose()

    quotes, other_currency = asyncio.run(run())
    assert [(quote.price_date, quote.price) for quote in quotes] == [
        (date(2025, 1, 6), 1_920_450_012)
    ]
    assert other_currency == []


def test_the_adapter_searches_and_maps_markets() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.host == "api.mfapi.in":
            return httpx2.Response(
                200, json=[{"schemeCode": 122639, "schemeName": "Parag Parikh Flexi Cap Fund"}]
            )
        quotes = [
            {
                "symbol": "INFY.NS",
                "longname": "Infosys Limited",
                "quoteType": "EQUITY",
                "exchDisp": "NSE",
                "sector": "Technology",
            },
            {
                "symbol": "INFY",
                "shortname": "Infosys ADR",
                "quoteType": "EQUITY",
                "exchDisp": "NYSE",
            },
            {"symbol": "NIFTYBEES.NS", "longname": "Nippon Nifty BeES", "quoteType": "ETF"},
        ]
        return httpx2.Response(200, content=json.dumps({"quotes": quotes}).encode())

    async def run() -> tuple[list[Instrument], list[Instrument]]:
        feed = _feed(handler)
        try:
            return await feed.search("mutual_fund", "parag"), await feed.search("stock", "infy")
        finally:
            await feed.aclose()

    funds, stocks = asyncio.run(run())
    assert [(fund.symbol, fund.currency) for fund in funds] == [(FUND_CODE, "INR")]
    assert [(item.symbol, item.exchange, item.category, item.currency) for item in stocks] == [
        ("INFY", "NSE", "Technology", "INR"),
        ("INFY", "NYSE", "", None),
    ]


def test_adapter_failures_are_feed_errors() -> None:
    async def run(response: httpx2.Response) -> None:
        def handler(request: httpx2.Request) -> httpx2.Response:
            return response

        feed = _feed(handler)
        try:
            await feed.quotes(
                _holding("mutual_fund", FUND_CODE), date(2025, 1, 1), date(2025, 1, 2)
            )
        finally:
            await feed.aclose()

    for response in (httpx2.Response(500), httpx2.Response(200, content=b"not json")):
        with pytest.raises(PriceFeedError):
            asyncio.run(run(response))
