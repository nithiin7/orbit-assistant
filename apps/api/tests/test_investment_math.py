"""Pure investment arithmetic: fixed-point quantities and prices, FIFO cost basis, deposit
estimates, and valuing holdings, deposits, and cash on a date."""

import uuid
from datetime import UTC, date, datetime

import pytest

from orbit_api.services.investments.deposits import (
    accrued,
    estimated_value,
    recurring_installments,
)
from orbit_api.services.investments.lots import OversoldError, Trade, replay
from orbit_api.services.investments.models import (
    Deposit,
    Holding,
    InvestmentTransaction,
    InvestmentTransactionType,
    Price,
    Settlement,
)
from orbit_api.services.investments.portfolio import account_cash, deposit_view, holding_view
from orbit_api.services.investments.quantities import (
    divide_half_up,
    format_price,
    format_quantity,
    market_value,
    parse_price,
    parse_quantity,
    percent,
    unit_price,
)

NOW = datetime(2026, 1, 1, tzinfo=UTC)
WORKSPACE = uuid.uuid4()
ACCOUNT = uuid.uuid4()


def units(text: str) -> int:
    return parse_quantity(text)


def buy(day: str, quantity: str, amount: int) -> Trade:
    return Trade(uuid.uuid4(), "buy", date.fromisoformat(day), units(quantity), amount)


def sell(day: str, quantity: str, amount: int) -> Trade:
    return Trade(uuid.uuid4(), "sell", date.fromisoformat(day), units(quantity), amount)


# Quantities and prices


def test_quantities_parse_and_format_exactly() -> None:
    assert parse_quantity("12.345") == 12_345_000
    assert parse_quantity("10") == 10_000_000
    assert parse_quantity("0.000001") == 1
    assert format_quantity(12_345_000) == "12.345"
    assert format_quantity(10_000_000) == "10"
    assert parse_price("45.6789") == 45_678_900
    assert format_price(45_678_900) == "45.6789"


@pytest.mark.parametrize("text", ["", "-1", "+1", "1e3", "1.0000001", "abc", "NaN", "1_000"])
def test_quantities_reject_anything_but_plain_decimals(text: str) -> None:
    with pytest.raises(ValueError):
        parse_quantity(text)


def test_market_value_rounds_half_up_once() -> None:
    # 218.92 units at ₹45.6789 = ₹10,000.0248, to the paisa.
    assert market_value(units("218.92"), parse_price("45.6789"), "INR") == 10_000_02
    # 1 unit at ₹0.005 is half a paisa: rounds up.
    assert market_value(units("1"), parse_price("0.005"), "INR") == 1
    assert market_value(units("1"), parse_price("0.004999"), "INR") == 0
    # Yen has no minor unit.
    assert market_value(units("3"), parse_price("1000.5"), "JPY") == 3002


def test_unit_price_is_the_average_cost() -> None:
    assert unit_price(10_000_00, units("218.92"), "INR") == parse_price("45.678787")
    assert unit_price(1_500_00, units("10"), "INR") == parse_price("150")


def test_division_and_percentages_round_half_away_from_zero() -> None:
    assert divide_half_up(5, 2) == 3
    assert divide_half_up(-5, 2) == -3
    assert divide_half_up(4, 3) == 1
    assert percent(1, 8) == "12.5"
    assert percent(-1, 3) == "-33.33"
    assert percent(5, 0) is None


# FIFO


def test_fifo_sells_the_oldest_lots_first() -> None:
    position = replay(
        [
            buy("2025-01-01", "10", 1_000_00),  # ₹100 a share
            buy("2025-02-01", "10", 2_000_00),  # ₹200 a share
            sell("2025-03-01", "15", 3_000_00),  # takes all of lot 1 and half of lot 2
        ]
    )
    assert position.quantity == units("5")
    assert position.cost == 1_000_00
    assert position.bought == 3_000_00
    [disposal] = position.disposals
    assert disposal.cost == 2_000_00
    assert disposal.gain == 1_000_00
    assert position.realized == 1_000_00


def test_partial_lot_cost_rounds_and_the_last_units_take_the_rest() -> None:
    position = replay(
        [
            buy("2025-01-01", "3", 100),  # 33.33… paise a unit
            sell("2025-01-02", "1", 50),
            sell("2025-01-03", "1", 50),
            sell("2025-01-04", "1", 50),
        ]
    )
    costs = [disposal.cost for disposal in position.disposals]
    # 100/3 → 33, then 67/2 → 34 (half up), then the last 33 exactly: nothing lost or made.
    assert costs == [33, 34, 33]
    assert sum(costs) == 100
    assert position.quantity == 0
    assert position.cost == 0


def test_a_loss_is_a_negative_realized_gain() -> None:
    position = replay([buy("2025-01-01", "2", 500_00), sell("2025-06-01", "2", 300_00)])
    assert position.realized == -200_00


def test_selling_more_than_was_held_is_rejected() -> None:
    late_buy = buy("2025-03-01", "10", 1_000_00)
    early_sale = sell("2025-02-01", "5", 600_00)
    with pytest.raises(OversoldError) as error:
        replay([buy("2025-01-01", "4", 400_00), early_sale, late_buy])
    assert error.value.trade_id == early_sale.id
    assert error.value.held == units("4")


# Deposits


def test_fixed_deposit_compounds_quarterly() -> None:
    # ₹1,00,000 at 7% compounded quarterly for exactly one year: 1.0175^4.
    value = accrued(1_00_000_00, 700, "quarterly", date(2025, 1, 1), date(2026, 1, 1))
    assert value == 1_07_185_90


def test_broken_periods_earn_simple_interest() -> None:
    # One whole quarter, then 31 days of simple interest on the compounded amount.
    value = accrued(1_00_000_00, 700, "quarterly", date(2025, 1, 1), date(2025, 5, 1))
    # 1,01,750.00 after the quarter to 1 Apr, then 30 days at 7%: 585.41… more.
    assert value == 1_02_335_41


def test_simple_interest_deposits() -> None:
    assert accrued(1_00_000_00, 730, "simple", date(2025, 1, 1), date(2026, 1, 1)) == 1_07_300_00


def test_nothing_accrues_before_the_start_or_after_maturity() -> None:
    assert accrued(1_000_00, 700, "monthly", date(2025, 1, 1), date(2024, 1, 1)) == 1_000_00
    at_maturity = estimated_value(
        [(date(2025, 1, 1), 1_000_00)], 700, "yearly", date(2026, 1, 1), date(2026, 1, 1)
    )
    later = estimated_value(
        [(date(2025, 1, 1), 1_000_00)], 700, "yearly", date(2030, 1, 1), date(2026, 1, 1)
    )
    assert at_maturity == later == 1_070_00


def test_recurring_deposit_installments_run_monthly_until_maturity() -> None:
    planned = recurring_installments(date(2025, 1, 31), date(2025, 5, 1), 5_000_00)
    assert [day for day, _ in planned] == [
        date(2025, 1, 31),
        date(2025, 2, 28),
        date(2025, 3, 31),
        date(2025, 4, 30),
    ]


# Valuation on a date


def transaction(
    kind: InvestmentTransactionType,
    day: str,
    amount: int,
    *,
    quantity: str | None = None,
    settlement: Settlement = "investment_account",
    fees: int = 0,
    holding_id: uuid.UUID | None = None,
    deposit_id: uuid.UUID | None = None,
) -> InvestmentTransaction:
    return InvestmentTransaction(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        account_id=ACCOUNT,
        currency="INR",
        type=kind,
        trade_date=date.fromisoformat(day),
        amount=amount,
        fees=fees,
        holding_id=holding_id,
        deposit_id=deposit_id,
        sip_plan_id=None,
        sip_due_date=None,
        quantity=units(quantity) if quantity else None,
        plan=None,
        settlement=settlement,
        cash_account_id=None,
        cash_transaction_id=None,
        fee_transaction_id=None,
        notes="",
        created_at=NOW,
        updated_at=NOW,
    )


def make_holding() -> Holding:
    return Holding(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        account_id=ACCOUNT,
        currency="INR",
        kind="stock",
        name="Infosys",
        symbol="INFY",
        exchange="NSE",
        isin="",
        issuer="",
        category="",
        folio="",
        notes="",
        created_at=NOW,
        updated_at=NOW,
    )


def price(holding: Holding, day: str, value: str) -> Price:
    return Price(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        holding_id=holding.id,
        price_date=date.fromisoformat(day),
        price=parse_price(value),
        source="manual",
        created_at=NOW,
    )


def test_a_holding_is_valued_at_its_latest_price_on_or_before_the_date() -> None:
    holding = make_holding()
    history = [
        transaction("buy", "2025-01-10", 15_000_00, quantity="10", fees=20_00),
        transaction("sell", "2025-03-10", 8_000_00, quantity="4"),
        transaction("dividend", "2025-04-01", 300_00),
    ]
    prices = [price(holding, "2025-03-01", "1600"), price(holding, "2025-05-01", "1700")]

    view = holding_view(holding, history, prices, date(2025, 5, 5))
    assert view.quantity == units("6")
    assert view.cost == 9_000_00
    assert view.average_cost == parse_price("1500")
    assert view.market_value == 10_200_00
    assert view.unrealized == 1_200_00
    assert view.realized == 2_000_00
    assert view.dividends == 300_00
    assert view.fees == 20_00
    assert view.freshness == "current"

    # Earlier: before the sale and the later price.
    earlier = holding_view(holding, history, prices, date(2025, 3, 5))
    assert earlier.quantity == units("10")
    assert earlier.market_value == 16_000_00
    assert earlier.freshness == "current"
    # Eight days after the 1 March price, with no newer one: stale.
    stale = holding_view(holding, history, prices, date(2025, 3, 9))
    assert stale.freshness == "stale"


def test_a_holding_without_a_price_counts_at_cost_and_says_so() -> None:
    holding = make_holding()
    view = holding_view(
        holding, [transaction("buy", "2025-01-10", 5_000_00, quantity="5")], [], date(2025, 2, 1)
    )
    assert view.market_value is None
    assert view.unrealized is None
    assert view.value == 5_000_00
    assert view.freshness == "missing"


def make_deposit(**fields: object) -> Deposit:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "workspace_id": WORKSPACE,
        "account_id": ACCOUNT,
        "currency": "INR",
        "kind": "fixed",
        "name": "SBI FD",
        "institution": "SBI",
        "interest_rate_bps": 700,
        "compounding": "quarterly",
        "start_date": date(2025, 1, 1),
        "maturity_date": date(2026, 1, 1),
        "installment_amount": None,
        "stated_maturity_amount": None,
        "status": "active",
        "closed_on": None,
        "manual_value": None,
        "manual_valued_on": None,
        "reminder": None,
        "notes": "",
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(fields)
    return Deposit(**values)  # pyright: ignore[reportArgumentType] - test factory


def test_deposits_are_estimates_until_valued_by_hand_or_closed() -> None:
    deposit = make_deposit()
    history = [transaction("deposit", "2025-01-01", 1_00_000_00, deposit_id=deposit.id)]

    view = deposit_view(deposit, history, date(2026, 1, 1))
    assert view.principal == 1_00_000_00
    assert view.value == view.estimated_value == 1_07_185_90
    assert view.source == "estimate"
    assert view.freshness == "estimated"
    assert view.projected_maturity_amount == 1_07_185_90
    assert view.projected_interest == 7_185_90

    manual = make_deposit(manual_value=1_05_000_00, manual_valued_on=date(2025, 9, 1))
    valued = deposit_view(manual, history, date(2025, 10, 1))
    assert (valued.value, valued.source, valued.freshness) == (1_05_000_00, "manual", "current")
    # A manual value dated after the date asked about doesn't apply.
    assert deposit_view(manual, history, date(2025, 8, 1)).source == "estimate"

    closed = make_deposit(status="matured", closed_on=date(2026, 1, 1))
    assert deposit_view(closed, history, date(2026, 2, 1)).value == 0
    assert deposit_view(closed, history, date(2025, 12, 1)).value > 0


def test_recurring_deposit_projection_assumes_every_installment() -> None:
    deposit = make_deposit(
        kind="recurring",
        installment_amount=1_000_00,
        compounding="simple",
        interest_rate_bps=0,
        maturity_date=date(2025, 7, 1),
    )
    view = deposit_view(deposit, [], date(2025, 1, 1))
    assert view.projected_contributions == 6_000_00
    assert view.projected_maturity_amount == 6_000_00
    assert view.principal == 0


def test_investment_cash_excludes_money_spent_on_positions() -> None:
    history = [
        transaction("buy", "2025-01-01", 6_000_00, quantity="1"),
        transaction("buy", "2025-01-02", 2_000_00, quantity="1", settlement="account"),
        transaction("buy", "2025-01-03", 9_000_00, quantity="1", settlement="none"),
        transaction("sell", "2025-02-01", 2_500_00, quantity="1"),
        transaction("deposit", "2025-02-02", 1_000_00),
    ]
    # Ledger: ₹10,000 moved in, plus the ₹2,000 transfer for the second buy.
    assert account_cash(12_000_00, history) == 12_000_00 - 6_000_00 - 2_000_00 + 2_500_00 - 1_000_00
