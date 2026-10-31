"""Valuing investments on a date, from their recorded history. Pure: the same inputs and date
always give the same values, so today's figures and historical snapshots use the same code.

- **Holdings** are worth `quantity * the latest price on or before the date`. Without a price
  they are counted **at cost** and marked `missing`; a price older than `PRICE_STALE_DAYS` is
  marked `stale`. Quantity and cost come from FIFO (`lots.py`).
- **Deposits** are worth their estimated accrued value (`deposits.py`), marked `estimated`,
  unless the user entered a value by hand, which then wins (marked `stale` after a year).
  Closed deposits are worth nothing; their money is back in an account.
- **An investment account's cash** is its ledger balance minus what it paid for buys and
  deposits, plus what sales and withdrawals returned to it. Trades settled outside Orbit
  (`settlement = none`) don't touch cash, and trades settled through another account had their
  transfer recorded in the ledger, which cancels out.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from orbit_api.services.investments.deposits import estimated_value, recurring_installments
from orbit_api.services.investments.lots import Position, Trade, replay
from orbit_api.services.investments.models import (
    PRICE_STALE_DAYS,
    VALUATION_STALE_DAYS,
    Deposit,
    DepositView,
    Freshness,
    Holding,
    HoldingView,
    InvestmentTransaction,
    Price,
    ValueSource,
)
from orbit_api.services.investments.quantities import market_value, unit_price


def in_order(transactions: Iterable[InvestmentTransaction]) -> list[InvestmentTransaction]:
    """Transactions in the order they happened: by date, then as recorded."""
    return sorted(transactions, key=lambda entry: (entry.trade_date, entry.created_at, entry.id))


def position(transactions: Iterable[InvestmentTransaction]) -> Position:
    """The FIFO position after a holding's buys and sells. Raises `OversoldError`."""
    return replay(
        Trade(
            id=entry.id,
            side="buy" if entry.type == "buy" else "sell",
            trade_date=entry.trade_date,
            quantity=entry.quantity or 0,
            amount=entry.amount,
        )
        for entry in in_order(transactions)
        if entry.type in ("buy", "sell") and entry.quantity
    )


def latest_price(prices: Iterable[Price], as_of: date) -> Price | None:
    eligible = [price for price in prices if price.price_date <= as_of]
    return max(eligible, key=lambda price: price.price_date, default=None)


def holding_view(
    holding: Holding,
    transactions: Iterable[InvestmentTransaction],
    prices: Iterable[Price],
    as_of: date,
) -> HoldingView:
    """The holding on `as_of`, from its transactions and prices up to that date."""
    history = [entry for entry in transactions if entry.trade_date <= as_of]
    held = position(history)
    price = latest_price(prices, as_of)
    freshness: Freshness = "current"
    market: int | None
    if held.quantity == 0:
        market = 0
    elif price is None:
        market = None
        freshness = "missing"
    else:
        market = market_value(held.quantity, price.price, holding.currency)
        if (as_of - price.price_date).days > PRICE_STALE_DAYS:
            freshness = "stale"
    return HoldingView(
        holding=holding,
        quantity=held.quantity,
        cost=held.cost,
        average_cost=unit_price(held.cost, held.quantity, holding.currency)
        if held.quantity
        else None,
        bought=held.bought,
        price=price,
        market_value=market,
        realized=held.realized,
        dividends=sum(entry.amount for entry in history if entry.type == "dividend"),
        fees=sum(entry.fees for entry in history)
        + sum(entry.amount for entry in history if entry.type == "fee"),
        freshness=freshness,
    )


@dataclass(frozen=True, slots=True)
class DepositFlows:
    contributions: list[tuple[date, int]]
    withdrawn: int
    interest: int

    @property
    def principal(self) -> int:
        return sum(amount for _, amount in self.contributions) - self.withdrawn


def deposit_flows(transactions: Iterable[InvestmentTransaction], as_of: date) -> DepositFlows:
    history = [entry for entry in transactions if entry.trade_date <= as_of]
    return DepositFlows(
        contributions=[
            (entry.trade_date, entry.amount) for entry in history if entry.type == "deposit"
        ],
        withdrawn=sum(entry.amount for entry in history if entry.type == "withdrawal"),
        interest=sum(entry.amount for entry in history if entry.type == "interest"),
    )


def deposit_view(
    deposit: Deposit, transactions: Iterable[InvestmentTransaction], as_of: date
) -> DepositView:
    """The deposit on `as_of`, with its projected maturity from the terms."""
    entries = list(transactions)
    flows = deposit_flows(entries, as_of)
    estimate = estimated_value(
        flows.contributions,
        deposit.interest_rate_bps,
        deposit.compounding,
        as_of,
        deposit.maturity_date,
    )
    if deposit.kind == "recurring" and deposit.installment_amount:
        planned = recurring_installments(
            deposit.start_date, deposit.maturity_date, deposit.installment_amount
        )
    else:
        planned = deposit_flows(entries, deposit.maturity_date).contributions
    projected = estimated_value(
        planned,
        deposit.interest_rate_bps,
        deposit.compounding,
        deposit.maturity_date,
        deposit.maturity_date,
    )
    contributed = sum(amount for _, amount in planned)

    closed = deposit.closed_on is not None and deposit.closed_on <= as_of
    source: ValueSource
    freshness: Freshness
    if closed:
        value, valued_on, source, freshness = 0, deposit.closed_on or as_of, "ledger", "current"
    elif (
        deposit.manual_value is not None
        and deposit.manual_valued_on is not None
        and deposit.manual_valued_on <= as_of
    ):
        value, valued_on, source = deposit.manual_value, deposit.manual_valued_on, "manual"
        stale = (as_of - deposit.manual_valued_on).days > VALUATION_STALE_DAYS
        freshness = "stale" if stale else "current"
    else:
        value, valued_on, source, freshness = estimate, as_of, "estimate", "estimated"
    return DepositView(
        deposit=deposit,
        principal=flows.principal,
        interest_received=flows.interest,
        estimated_value=0 if closed else estimate,
        value=value,
        valued_on=valued_on,
        source=source,
        freshness=freshness,
        projected_maturity_amount=projected,
        projected_interest=projected - contributed,
        projected_contributions=contributed,
    )


def account_cash(ledger_balance: int, transactions: Iterable[InvestmentTransaction]) -> int:
    """An investment account's uninvested cash, from its ledger balance and the trades and
    deposit flows settled through it (directly, or by a transfer the ledger recorded)."""
    cash = ledger_balance
    for entry in transactions:
        if entry.settlement == "none":
            continue
        if entry.type in ("buy", "deposit"):
            cash -= entry.amount
        elif entry.type in ("sell", "withdrawal"):
            cash += entry.amount
    return cash
