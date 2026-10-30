"""FIFO cost basis: replay a holding's buys and sells in order to find what is still held, what it
cost, and the gain or loss each sale realized. Pure and deterministic.

The method, decided deliberately and used for every holding (stocks, ETFs, and mutual funds):

- **First in, first out.** Each buy opens a lot. A sale takes units from the oldest open lot
  first, then the next.
- **Cost of a partial lot** is the lot's remaining cost times the share of its remaining units
  sold, rounded half up to the minor unit. Selling a lot's last units takes its remaining cost
  exactly, so rounding never leaves cost behind or creates it.
- **Realized gain** is a sale's gross proceeds minus the cost of the units it took. Fees are
  expenses in the ledger, never part of cost or proceeds.
- **Order** is the trade date, then the order the trades were recorded in. The caller sorts.
- A sale of more units than were held at that point is an error, never a negative holding.

Corporate actions (splits, bonuses, mergers) are not modelled: they would need their own
transaction type to adjust lots without realizing gains.
"""

import uuid
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Literal

from orbit_api.services.investments.quantities import divide_half_up


@dataclass(frozen=True, slots=True)
class Trade:
    id: uuid.UUID
    side: Literal["buy", "sell"]
    trade_date: date
    # Scaled units (see `quantities.py`), always positive.
    quantity: int
    # Minor units: what a buy cost, or a sale's gross proceeds.
    amount: int


@dataclass(frozen=True, slots=True)
class Lot:
    trade_id: uuid.UUID
    acquired_on: date
    quantity: int
    cost: int


@dataclass(frozen=True, slots=True)
class Disposal:
    """One sale and the cost of the units it took."""

    trade_id: uuid.UUID
    sold_on: date
    quantity: int
    proceeds: int
    cost: int

    @property
    def gain(self) -> int:
        return self.proceeds - self.cost


@dataclass(frozen=True, slots=True)
class Position:
    # Units still held and what they cost (the open lots' remaining cost).
    quantity: int
    cost: int
    lots: tuple[Lot, ...]
    disposals: tuple[Disposal, ...]
    # Everything ever paid for buys, including units since sold.
    bought: int

    @property
    def realized(self) -> int:
        return sum(disposal.gain for disposal in self.disposals)


class OversoldError(ValueError):
    """A sale takes more units than were held on its date."""

    def __init__(self, trade_id: uuid.UUID, sold_on: date, held: int) -> None:
        super().__init__(f"Sale {trade_id} on {sold_on} exceeds the {held} units held.")
        self.trade_id = trade_id
        self.sold_on = sold_on
        self.held = held


EMPTY_POSITION = Position(quantity=0, cost=0, lots=(), disposals=(), bought=0)


def replay(trades: Iterable[Trade]) -> Position:
    """The position after `trades`, which must be in order. Raises `OversoldError`."""
    # Each open lot as [trade id, acquired on, remaining units, remaining cost].
    open_lots: deque[tuple[uuid.UUID, date, int, int]] = deque()
    disposals: list[Disposal] = []
    bought = 0
    for trade in trades:
        if trade.side == "buy":
            open_lots.append((trade.id, trade.trade_date, trade.quantity, trade.amount))
            bought += trade.amount
            continue
        held = sum(lot[2] for lot in open_lots)
        if trade.quantity > held:
            raise OversoldError(trade.id, trade.trade_date, held)
        remaining = trade.quantity
        cost = 0
        while remaining:
            lot_id, acquired, units, lot_cost = open_lots[0]
            if remaining >= units:
                cost += lot_cost
                remaining -= units
                open_lots.popleft()
                continue
            taken = divide_half_up(lot_cost * remaining, units)
            cost += taken
            open_lots[0] = (lot_id, acquired, units - remaining, lot_cost - taken)
            remaining = 0
        disposals.append(
            Disposal(
                trade_id=trade.id,
                sold_on=trade.trade_date,
                quantity=trade.quantity,
                proceeds=trade.amount,
                cost=cost,
            )
        )
    lots = tuple(
        Lot(trade_id=lot_id, acquired_on=acquired, quantity=units, cost=lot_cost)
        for lot_id, acquired, units, lot_cost in open_lots
    )
    return Position(
        quantity=sum(lot.quantity for lot in lots),
        cost=sum(lot.cost for lot in lots),
        lots=lots,
        disposals=tuple(disposals),
        bought=bought,
    )
