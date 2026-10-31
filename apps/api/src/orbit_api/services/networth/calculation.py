"""Net worth on a date, in one currency: **total assets minus total liabilities**. Pure.

Each source is counted exactly once:

- **Accounts** count their ledger balance on the date: banks, savings, cash, and wallets as
  assets; credit cards and loans as liabilities (what they owe). A loan's balance is its Phase 2
  loan account, so the outstanding principal comes from the same ledger as everything else.
- **Investment accounts** with a profile count their **cash** (not their ledger balance, which
  includes money already spent on holdings), plus each holding at market value and each deposit
  at its estimated or manual value. An `investment` account without a profile tracks no
  holdings, so it counts its ledger balance, labelled as valued at cost.
- **Other assets** count their latest valuation, unless they duplicate an account balance or
  are left out (`AssetView.counted`).
- Buying an investment moves money from cash to a holding, so net worth changes only by the
  difference between the price paid and the holding's value; nothing is counted as both an
  expense and an asset.

Every item states where its value came from and how current it is, so stale and missing
valuations are visible rather than implied to be current.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Final, Literal

from orbit_api.services.finance.models import Account, AccountView
from orbit_api.services.finance.money import Currency
from orbit_api.services.investments.models import (
    AssetView,
    DepositView,
    Freshness,
    HoldingView,
    InvestmentAccountView,
    ValueSource,
)

Side = Literal["asset", "liability"]
NetWorthGroup = Literal[
    "cash",
    "investment_cash",
    "mutual_funds",
    "stocks",
    "etfs",
    "deposits",
    "investments_at_cost",
    "other_assets",
    "credit_cards",
    "loans",
]
GROUPS: Final[dict[NetWorthGroup, tuple[str, Side]]] = {
    "cash": ("Bank and cash", "asset"),
    "investment_cash": ("Cash in investment accounts", "asset"),
    "mutual_funds": ("Mutual funds", "asset"),
    "stocks": ("Stocks", "asset"),
    "etfs": ("ETFs", "asset"),
    "deposits": ("Fixed and recurring deposits", "asset"),
    "investments_at_cost": ("Investment accounts at cost", "asset"),
    "other_assets": ("Other assets", "asset"),
    "credit_cards": ("Credit cards", "liability"),
    "loans": ("Loans", "liability"),
}
ItemKind = Literal["account", "holding", "deposit", "asset"]
_HOLDING_GROUPS: Final[dict[str, NetWorthGroup]] = {
    "mutual_fund": "mutual_funds",
    "stock": "stocks",
    "etf": "etfs",
}


@dataclass(frozen=True, slots=True)
class NetWorthItem:
    kind: ItemKind
    id: uuid.UUID
    name: str
    group: NetWorthGroup
    # Positive for what it adds to its side: an asset's value, or what a liability owes.
    value: int
    valued_on: date | None
    source: ValueSource
    freshness: Freshness
    counted: bool
    note: str | None = None

    @property
    def side(self) -> Side:
        return GROUPS[self.group][1]


@dataclass(frozen=True, slots=True)
class GroupTotal:
    key: NetWorthGroup
    label: str
    side: Side
    value: int


@dataclass(frozen=True, slots=True)
class QualityCounts:
    """How many counted items aren't plain current values."""

    estimated: int
    manual: int
    stale: int
    missing: int


@dataclass(frozen=True, slots=True)
class NetWorth:
    currency: Currency
    as_of: date
    assets: int
    liabilities: int
    items: list[NetWorthItem]
    groups: list[GroupTotal]
    quality: QualityCounts

    @property
    def net_worth(self) -> int:
        return self.assets - self.liabilities


def _account_item(
    account: Account,
    as_of: date,
    group: NetWorthGroup,
    value: int,
    source: ValueSource = "ledger",
    freshness: Freshness = "current",
    note: str | None = None,
) -> NetWorthItem:
    return NetWorthItem(
        kind="account",
        id=account.id,
        name=account.name,
        group=group,
        value=value,
        valued_on=as_of,
        source=source,
        freshness=freshness,
        counted=True,
        note=note,
    )


def calculate(
    currency: Currency,
    as_of: date,
    ledger: list[AccountView],
    investment_accounts: list[InvestmentAccountView],
    holdings: list[HoldingView],
    deposits: list[DepositView],
    assets: list[AssetView],
) -> NetWorth:
    """Net worth in `currency` from views already valued on `as_of`."""
    items: list[NetWorthItem] = []
    profiled = {view.account.id: view for view in investment_accounts}

    for view in ledger:
        account = view.account
        if account.currency != currency:
            continue

        if account.type in ("credit_card", "loan"):
            # A liability's balance is negative while money is owed.
            group: NetWorthGroup = "credit_cards" if account.type == "credit_card" else "loans"
            items.append(_account_item(account, as_of, group, -view.balance))
        elif account.id in profiled:
            if cash := profiled[account.id].cash:
                items.append(_account_item(account, as_of, "investment_cash", cash))
        elif account.type == "investment":
            items.append(
                _account_item(
                    account,
                    as_of,
                    "investments_at_cost",
                    view.balance,
                    source="cost",
                    freshness="missing",
                    note="Valued at what was moved in. Track its holdings for market value.",
                )
            )
        elif view.balance:
            items.append(_account_item(account, as_of, "cash", view.balance))

    for holding in holdings:
        if holding.holding.currency != currency or holding.quantity == 0:
            continue
        priced = holding.market_value is not None
        items.append(
            NetWorthItem(
                kind="holding",
                id=holding.holding.id,
                name=holding.holding.name,
                group=_HOLDING_GROUPS[holding.holding.kind],
                value=holding.value,
                valued_on=holding.price.price_date if holding.price else None,
                source="market" if priced else "cost",
                freshness=holding.freshness,
                counted=True,
                note=None if priced else "No price recorded; counted at cost.",
            )
        )

    for deposit in deposits:
        if deposit.deposit.currency != currency or deposit.value == 0:
            continue
        items.append(
            NetWorthItem(
                kind="deposit",
                id=deposit.deposit.id,
                name=deposit.deposit.name,
                group="deposits",
                value=deposit.value,
                valued_on=deposit.valued_on,
                source=deposit.source,
                freshness=deposit.freshness,
                counted=True,
                note="Estimated from the rate; not guaranteed."
                if deposit.source == "estimate"
                else None,
            )
        )

    for asset in assets:
        if asset.asset.currency != currency or asset.asset.archived_at is not None:
            continue
        items.append(
            NetWorthItem(
                kind="asset",
                id=asset.asset.id,
                name=asset.asset.name,
                group="other_assets",
                value=asset.value,
                valued_on=asset.valued_on,
                source="manual" if asset.latest is not None else "cost",
                freshness=asset.freshness,
                counted=asset.counted,
                note=asset.excluded_reason
                if not asset.counted
                else (
                    "No valuation recorded; counted at purchase cost."
                    if asset.latest is None
                    else None
                ),
            )
        )

    counted = [item for item in items if item.counted]
    totals: dict[NetWorthGroup, int] = {}
    for item in counted:
        totals[item.group] = totals.get(item.group, 0) + item.value
    groups = [
        GroupTotal(key=key, label=label, side=side, value=totals[key])
        for key, (label, side) in GROUPS.items()
        if key in totals
    ]
    return NetWorth(
        currency=currency,
        as_of=as_of,
        assets=sum(item.value for item in counted if item.side == "asset"),
        liabilities=sum(item.value for item in counted if item.side == "liability"),
        items=items,
        groups=groups,
        quality=QualityCounts(
            estimated=sum(1 for item in counted if item.freshness == "estimated"),
            manual=sum(1 for item in counted if item.source == "manual"),
            stale=sum(1 for item in counted if item.freshness == "stale"),
            missing=sum(1 for item in counted if item.freshness == "missing"),
        ),
    )
