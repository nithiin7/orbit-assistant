"""Investments: investment accounts, holdings and their prices, investment transactions, SIP
plans, fixed and recurring deposits, and the portfolio summary.

Accounting, decided deliberately and built on the Phase 1 ledger rather than beside it:

- **An investment account is an `investment` finance account** with a profile. Its ledger
  balance is the money moved into it (transfers in, income, minus fees and transfers out); its
  **cash** is that balance minus what it paid for positions plus what positions returned.
- **Buying is an asset allocation, never an expense.** A buy paid from the account's own cash
  touches no ledger row; a buy paid from a bank account records a `transfer` from the bank into
  the investment account, which the buy then spends, so the bank goes down, the holding goes up,
  and nothing is counted as spending or twice.
- **Selling converts a holding into cash.** Only the realized gain (FIFO) is performance; it is
  not income in cash-flow reports. Proceeds stay in the account's cash or are transferred out.
- **Dividends and interest are income** (`income` in the "Dividends" or "Interest" category);
  **fees are expenses** ("Fees and charges"), never part of cost basis.
- **Scheduled SIPs are expectations.** Only a recorded buy is an investment.

Every write commits once, so a buy and its transfer and fee expense are recorded together or
not at all. Every method takes a `workspace_id` the caller has already authorized; repositories
filter by it, and referenced accounts, holdings, and deposits are looked up in it too.
"""

import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from itertools import islice
from typing import Final, Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.commitments.schedule import due_dates
from orbit_api.services.finance.models import (
    ACCOUNT_CLASSES,
    Account,
    AccountChanges,
    AccountDraft,
    AccountNotFoundError,
    AccountView,
    InvalidTransactionError,
    TransactionDraft,
)
from orbit_api.services.finance.money import Currency, to_decimal_string
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.investments.lots import OversoldError
from orbit_api.services.investments.models import (
    Deposit,
    DepositChanges,
    DepositClosure,
    DepositDraft,
    DepositNotFoundError,
    DepositView,
    Holding,
    HoldingChanges,
    HoldingDraft,
    HoldingNotFoundError,
    HoldingView,
    InvalidInvestmentError,
    InvestmentAccountChanges,
    InvestmentAccountDraft,
    InvestmentAccountNotFoundError,
    InvestmentAccountView,
    InvestmentConflictError,
    InvestmentProfile,
    InvestmentTransaction,
    InvestmentTransactionDraft,
    InvestmentTransactionNotFoundError,
    InvestmentTransactionPage,
    InvestmentTransactionQuery,
    PortfolioSummary,
    Price,
    PriceNotFoundError,
    PriceSource,
    Settlement,
    SipPlan,
    SipPlanChanges,
    SipPlanDraft,
    SipPlanNotFoundError,
    SipPlanView,
    Slice,
)
from orbit_api.services.investments.portfolio import (
    account_cash,
    deposit_flows,
    deposit_view,
    holding_view,
    position,
)
from orbit_api.services.investments.quantities import percent
from orbit_api.services.investments.valuation import Quote
from orbit_api.services.reminders.managed import ReminderStore, ReminderTarget, point_reminder
from orbit_api.services.reminders.models import CommitmentLink
from orbit_api.services.reminders.recurrence import Schedule, local_to_utc
from orbit_api.services.reminders.service import OccurrenceScheduler
from orbit_api.services.transactions import ConflictError
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

DIVIDENDS_KEY: Final = "dividends"
INTEREST_KEY: Final = "interest"
FEES_KEY: Final = "fees_charges"
# The longest a deposit may run, and how far a SIP schedule is searched for its next due date.
MAX_DEPOSIT_YEARS: Final = 50
_SIP_SEARCH_LIMIT: Final = 5000

KIND_LABELS: Final[dict[str, str]] = {
    "mutual_fund": "Mutual funds",
    "stock": "Stocks",
    "etf": "ETFs",
    "deposit": "Deposits",
    "cash": "Cash",
}


class ProfileRepository(Protocol):
    async def add(self, profile: InvestmentProfile) -> None:
        """Raises `ConflictError` if the account already has a profile."""
        ...

    async def get(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID
    ) -> InvestmentProfile | None: ...

    async def list(self, workspace_id: uuid.UUID) -> list[InvestmentProfile]: ...

    async def save(self, profile: InvestmentProfile) -> None: ...


class HoldingRepository(Protocol):
    async def add(self, holding: Holding) -> None:
        """Raises `ConflictError` if the account already has a holding with its identity."""
        ...

    async def get(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> Holding | None: ...

    async def list(self, workspace_id: uuid.UUID) -> list[Holding]:
        """By name."""
        ...

    async def save(self, holding: Holding) -> None:
        """Raises `ConflictError` on a duplicate identity."""
        ...

    async def delete(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> None:
        """Raises `ConflictError` if transactions still reference the holding."""
        ...


class PriceRepository(Protocol):
    async def put(self, price: Price) -> Price:
        """Store the holding's price for its date, replacing one already there; return what is
        stored."""
        ...

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[Price]: ...

    async def for_holding(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> list[Price]:
        """Newest first."""
        ...

    async def delete(
        self, workspace_id: uuid.UUID, holding_id: uuid.UUID, price_id: uuid.UUID
    ) -> bool: ...


class InvestmentTransactionRepository(Protocol):
    async def add(self, transaction: InvestmentTransaction) -> None:
        """Raises `ConflictError` if a ledger row or SIP due date is already used."""
        ...

    async def get(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID
    ) -> InvestmentTransaction | None: ...

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[InvestmentTransaction]: ...

    async def find(
        self, workspace_id: uuid.UUID, query: InvestmentTransactionQuery
    ) -> InvestmentTransactionPage:
        """Newest first."""
        ...

    async def delete(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> None: ...


class SipPlanRepository(Protocol):
    async def add(self, plan: SipPlan) -> None: ...

    async def get(self, workspace_id: uuid.UUID, plan_id: uuid.UUID) -> SipPlan | None: ...

    async def list(self, workspace_id: uuid.UUID) -> list[SipPlan]: ...

    async def save(self, plan: SipPlan) -> None: ...


class DepositRepository(Protocol):
    async def add(self, deposit: Deposit) -> None: ...

    async def get(self, workspace_id: uuid.UUID, deposit_id: uuid.UUID) -> Deposit | None: ...

    async def list(self, workspace_id: uuid.UUID) -> list[Deposit]:
        """Active first, then by maturity date."""
        ...

    async def save(self, deposit: Deposit) -> None: ...


@dataclass(frozen=True, slots=True)
class InvestmentBook:
    """Every investment in a workspace, valued on one date."""

    as_of: date
    accounts: list[InvestmentAccountView]
    holdings: list[HoldingView]
    deposits: list[DepositView]
    transactions: list[InvestmentTransaction]
    # Every finance account's view on the date, by ID, for callers that need balances too.
    ledger: dict[uuid.UUID, AccountView]


def _short_date(day: date) -> str:
    return f"{day.day} {day:%b %Y}"


def _overlaps(day: date, date_from: date | None, date_to: date | None) -> bool:
    return (date_from is None or day >= date_from) and (date_to is None or day <= date_to)


class InvestmentService:
    def __init__(
        self,
        profiles: ProfileRepository,
        holdings: HoldingRepository,
        prices: PriceRepository,
        transactions: InvestmentTransactionRepository,
        sip_plans: SipPlanRepository,
        deposits: DepositRepository,
        finance: FinanceService,
        reminders: ReminderStore,
        scheduler: OccurrenceScheduler,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._profiles = profiles
        self._holdings = holdings
        self._prices = prices
        self._transactions = transactions
        self._sip_plans = sip_plans
        self._deposits = deposits
        self._finance = finance
        self._reminders = reminders
        self._scheduler = scheduler
        self._unit_of_work = unit_of_work
        self._clock = clock

    # Valuation

    async def book(self, workspace_id: uuid.UUID, as_of: date) -> InvestmentBook:
        """Every investment account, holding, and deposit, valued from history up to `as_of`."""
        ledger = {
            view.account.id: view for view in await self._finance.accounts(workspace_id, as_of)
        }
        transactions = await self._transactions.for_workspace(workspace_id)
        prices = await self._prices.for_workspace(workspace_id)
        by_holding: dict[uuid.UUID, list[InvestmentTransaction]] = {}
        by_deposit: dict[uuid.UUID, list[InvestmentTransaction]] = {}
        by_account: dict[uuid.UUID, list[InvestmentTransaction]] = {}
        for entry in transactions:
            if entry.holding_id is not None:
                by_holding.setdefault(entry.holding_id, []).append(entry)
            if entry.deposit_id is not None:
                by_deposit.setdefault(entry.deposit_id, []).append(entry)
            if entry.trade_date <= as_of:
                by_account.setdefault(entry.account_id, []).append(entry)
        prices_by_holding: dict[uuid.UUID, list[Price]] = {}
        for price in prices:
            prices_by_holding.setdefault(price.holding_id, []).append(price)

        holdings = [
            holding_view(
                holding,
                by_holding.get(holding.id, []),
                prices_by_holding.get(holding.id, []),
                as_of,
            )
            for holding in await self._holdings.list(workspace_id)
        ]
        deposits = [
            deposit_view(deposit, by_deposit.get(deposit.id, []), as_of)
            for deposit in await self._deposits.list(workspace_id)
            if deposit.start_date <= as_of
        ]
        accounts: list[InvestmentAccountView] = []
        for profile in await self._profiles.list(workspace_id):
            view = ledger.get(profile.account_id)
            if view is None:
                continue
            accounts.append(
                InvestmentAccountView(
                    profile=profile,
                    account=view.account,
                    ledger_balance=view.balance,
                    cash=account_cash(view.balance, by_account.get(profile.account_id, [])),
                    holdings_value=sum(
                        entry.value
                        for entry in holdings
                        if entry.holding.account_id == view.account.id
                    ),
                    deposits_value=sum(
                        entry.value
                        for entry in deposits
                        if entry.deposit.account_id == view.account.id
                    ),
                )
            )
        return InvestmentBook(
            as_of=as_of,
            accounts=accounts,
            holdings=holdings,
            deposits=deposits,
            transactions=transactions,
            ledger=ledger,
        )

    async def portfolio(
        self,
        workspace_id: uuid.UUID,
        currency: Currency,
        today: date,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> PortfolioSummary:
        """Values on `today`, and realized gains, income, and fees in the inclusive range."""
        book = await self.book(workspace_id, today)
        holdings = [entry for entry in book.holdings if entry.holding.currency == currency]
        deposits = [entry for entry in book.deposits if entry.deposit.currency == currency]
        transactions = [
            entry
            for entry in book.transactions
            if entry.currency == currency and entry.trade_date <= today
        ]
        cash = sum(entry.cash for entry in book.accounts if entry.account.currency == currency)

        by_holding: dict[uuid.UUID, list[InvestmentTransaction]] = {}
        for entry in transactions:
            if entry.holding_id is not None:
                by_holding.setdefault(entry.holding_id, []).append(entry)
        realized = sum(
            disposal.gain
            for history in by_holding.values()
            for disposal in position(history).disposals
            if _overlaps(disposal.sold_on, date_from, date_to)
        )
        in_range = [
            entry for entry in transactions if _overlaps(entry.trade_date, date_from, date_to)
        ]
        income = sum(entry.amount for entry in in_range if entry.type in ("dividend", "interest"))
        fees = sum(entry.fees for entry in in_range) + sum(
            entry.amount for entry in in_range if entry.type == "fee"
        )
        active_deposits = [entry for entry in deposits if entry.deposit.status == "active"]
        invested = sum(entry.cost for entry in holdings) + sum(
            entry.principal for entry in active_deposits
        )
        unrealized = sum(entry.unrealized or 0 for entry in holdings)
        total_return = unrealized + realized + income - fees
        # The return's basis: everything ever put in, including what has since been sold.
        contributed = sum(entry.bought for entry in holdings) + sum(
            entry.amount for entry in transactions if entry.type == "deposit"
        )

        allocation: dict[str, int] = {}
        categories: dict[str, int] = {}
        for entry in holdings:
            if entry.quantity == 0:
                continue
            kind = entry.holding.kind
            allocation[kind] = allocation.get(kind, 0) + entry.value
            label = entry.holding.category or KIND_LABELS[kind]
            categories[label] = categories.get(label, 0) + entry.value
        for entry in active_deposits:
            allocation["deposit"] = allocation.get("deposit", 0) + entry.value
            label = "Fixed deposits" if entry.deposit.kind == "fixed" else "Recurring deposits"
            categories[label] = categories.get(label, 0) + entry.value
        if cash > 0:
            allocation["cash"] = cash

        def slices(values: dict[str, int], labels: dict[str, str]) -> list[Slice]:
            return sorted(
                (
                    Slice(key=key, label=labels.get(key, key), value=value)
                    for key, value in values.items()
                    if value
                ),
                key=lambda entry: (-entry.value, entry.key),
            )

        return PortfolioSummary(
            currency=currency,
            invested=invested,
            current_value=sum(entry.value for entry in holdings)
            + sum(entry.value for entry in active_deposits),
            cash=cash,
            unrealized=unrealized,
            realized=realized,
            income=income,
            fees=fees,
            total_return=total_return,
            return_percent=percent(total_return, contributed),
            allocation=slices(allocation, KIND_LABELS),
            categories=slices(categories, {}),
            missing_prices=sum(1 for entry in holdings if entry.freshness == "missing"),
            stale_prices=sum(1 for entry in holdings if entry.freshness == "stale"),
        )

    # Investment accounts

    async def accounts(self, workspace_id: uuid.UUID, today: date) -> list[InvestmentAccountView]:
        return (await self.book(workspace_id, today)).accounts

    async def account(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, today: date
    ) -> InvestmentAccountView:
        for view in await self.accounts(workspace_id, today):
            if view.account.id == account_id:
                return view
        raise InvestmentAccountNotFoundError

    async def create_account(
        self, workspace_id: uuid.UUID, draft: InvestmentAccountDraft, today: date
    ) -> InvestmentAccountView:
        """Make an investment account: adopt an existing `investment` finance account, so its
        history and balance carry over, or create a new one."""
        if draft.account_id is not None:
            account = await self._existing_account(workspace_id, draft.account_id)
            if account.type != "investment":
                raise InvalidInvestmentError(
                    "Only investment accounts can hold investments. Choose one whose type is "
                    "Investment."
                )
            if account.archived_at is not None:
                raise InvalidInvestmentError(f"“{account.name}” is archived. Restore it first.")
            if await self._profiles.get(workspace_id, account.id) is not None:
                raise InvestmentConflictError("That account already tracks investments.")
            if draft.linked_account_id is not None:
                await self._linked_account(
                    workspace_id, draft.linked_account_id, account.currency, account.id
                )
        else:
            if draft.name is None or draft.currency is None:
                raise InvalidInvestmentError("Name the account and choose its currency.")
            if draft.linked_account_id is not None:
                await self._linked_account(
                    workspace_id, draft.linked_account_id, draft.currency, None
                )
            account = (
                await self._finance.create_account(
                    workspace_id,
                    AccountDraft(
                        name=draft.name,
                        type="investment",
                        currency=draft.currency,
                        notes=draft.notes,
                    ),
                    commit=False,
                )
            ).account
        now = self._clock()
        try:
            await self._profiles.add(
                InvestmentProfile(
                    account_id=account.id,
                    workspace_id=workspace_id,
                    currency=account.currency,
                    kind=draft.kind,
                    provider=draft.provider,
                    linked_account_id=draft.linked_account_id,
                    created_at=now,
                    updated_at=now,
                )
            )
        except ConflictError:
            await self._unit_of_work.rollback()
            raise InvestmentConflictError("That account already tracks investments.") from None
        await self._commit()
        return await self.account(workspace_id, account.id, today)

    async def update_account(
        self,
        workspace_id: uuid.UUID,
        account_id: uuid.UUID,
        changes: InvestmentAccountChanges,
        today: date,
    ) -> InvestmentAccountView:
        profile = await self._get_profile(workspace_id, account_id)
        if changes.linked_account_id is not UNSET and changes.linked_account_id is not None:
            await self._linked_account(
                workspace_id, changes.linked_account_id, profile.currency, account_id
            )
        updated = replace(
            profile,
            kind=profile.kind if changes.kind is UNSET else changes.kind,
            provider=profile.provider if changes.provider is UNSET else changes.provider,
            linked_account_id=profile.linked_account_id
            if changes.linked_account_id is UNSET
            else changes.linked_account_id,
        )
        if updated != profile:
            await self._profiles.save(replace(updated, updated_at=self._clock()))
        # The finance service commits its own changes, and with them the profile's.
        if changes.name is not UNSET or changes.notes is not UNSET:
            await self._finance.update_account(
                workspace_id, account_id, AccountChanges(name=changes.name, notes=changes.notes)
            )
        if changes.archived is True:
            await self._finance.archive_account(workspace_id, account_id)
        elif changes.archived is False:
            await self._finance.restore_account(workspace_id, account_id)
        await self._commit()
        return await self.account(workspace_id, account_id, today)

    # Holdings

    async def holdings(
        self, workspace_id: uuid.UUID, today: date, account_id: uuid.UUID | None = None
    ) -> list[HoldingView]:
        views = (await self.book(workspace_id, today)).holdings
        return [
            view for view in views if account_id is None or view.holding.account_id == account_id
        ]

    async def holding(
        self, workspace_id: uuid.UUID, holding_id: uuid.UUID, today: date
    ) -> HoldingView:
        for view in await self.holdings(workspace_id, today):
            if view.holding.id == holding_id:
                return view
        raise HoldingNotFoundError

    async def create_holding(
        self, workspace_id: uuid.UUID, draft: HoldingDraft, today: date
    ) -> HoldingView:
        profile = await self._usable_profile(workspace_id, draft.account_id)
        now = self._clock()
        holding = Holding(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            account_id=profile.account_id,
            currency=profile.currency,
            kind=draft.kind,
            name=draft.name,
            symbol=draft.symbol,
            exchange=draft.exchange,
            isin=draft.isin,
            issuer=draft.issuer,
            category=draft.category,
            folio=draft.folio,
            notes=draft.notes,
            created_at=now,
            updated_at=now,
        )
        await self._check_unique(workspace_id, holding)
        try:
            await self._holdings.add(holding)
        except ConflictError:
            await self._unit_of_work.rollback()
            raise _duplicate_holding() from None
        await self._commit()
        return await self.holding(workspace_id, holding.id, today)

    async def update_holding(
        self, workspace_id: uuid.UUID, holding_id: uuid.UUID, changes: HoldingChanges, today: date
    ) -> HoldingView:
        holding = await self._get_holding(workspace_id, holding_id)
        updated = replace(
            holding,
            name=holding.name if changes.name is UNSET else changes.name,
            symbol=holding.symbol if changes.symbol is UNSET else changes.symbol,
            exchange=holding.exchange if changes.exchange is UNSET else changes.exchange,
            isin=holding.isin if changes.isin is UNSET else changes.isin,
            issuer=holding.issuer if changes.issuer is UNSET else changes.issuer,
            category=holding.category if changes.category is UNSET else changes.category,
            folio=holding.folio if changes.folio is UNSET else changes.folio,
            notes=holding.notes if changes.notes is UNSET else changes.notes,
        )
        if updated != holding:
            await self._check_unique(workspace_id, updated)
            try:
                await self._holdings.save(replace(updated, updated_at=self._clock()))
            except ConflictError:
                await self._unit_of_work.rollback()
                raise _duplicate_holding() from None
            await self._commit()
        return await self.holding(workspace_id, holding_id, today)

    async def delete_holding(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> None:
        """Delete a holding with no transactions, with its prices and SIP plans."""
        await self._get_holding(workspace_id, holding_id)
        if any(
            entry.holding_id == holding_id
            for entry in await self._transactions.for_workspace(workspace_id)
        ):
            raise InvestmentConflictError(
                "This holding has transactions. Delete them first, or keep it as history."
            )
        try:
            await self._holdings.delete(workspace_id, holding_id)
        except ConflictError:
            await self._unit_of_work.rollback()
            raise InvestmentConflictError("This holding has transactions.") from None
        await self._commit()

    # Prices

    async def prices(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> list[Price]:
        await self._get_holding(workspace_id, holding_id)
        return await self._prices.for_holding(workspace_id, holding_id)

    async def record_price(
        self,
        workspace_id: uuid.UUID,
        holding_id: uuid.UUID,
        price_date: date,
        price: int,
        source: PriceSource = "manual",
    ) -> Price:
        """Record the holding's price on a date, replacing any price already on that date."""
        holding = await self._get_holding(workspace_id, holding_id)
        stored = await self._prices.put(
            Price(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                holding_id=holding.id,
                price_date=price_date,
                price=price,
                source=source,
                created_at=self._clock(),
            )
        )
        await self._commit()
        return stored

    async def record_prices(self, workspace_id: uuid.UUID, quotes: Iterable[Quote]) -> int:
        """Store prices from a feed or an import in one transaction, replacing any price already
        on the same holding and date; return how many were stored. Quotes for holdings outside
        the workspace are ignored."""
        holdings = {holding.id for holding in await self._holdings.list(workspace_id)}
        now = self._clock()
        stored = 0
        for quote in quotes:
            if quote.holding_id not in holdings:
                continue
            await self._prices.put(
                Price(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    holding_id=quote.holding_id,
                    price_date=quote.price_date,
                    price=quote.price,
                    source=quote.source,
                    created_at=now,
                )
            )
            stored += 1
        await self._commit()
        return stored

    async def delete_price(
        self, workspace_id: uuid.UUID, holding_id: uuid.UUID, price_id: uuid.UUID
    ) -> None:
        await self._get_holding(workspace_id, holding_id)
        if not await self._prices.delete(workspace_id, holding_id, price_id):
            raise PriceNotFoundError
        await self._commit()

    # Transactions

    async def transactions(
        self, workspace_id: uuid.UUID, query: InvestmentTransactionQuery
    ) -> InvestmentTransactionPage:
        return await self._transactions.find(workspace_id, query)

    async def transaction(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID
    ) -> InvestmentTransaction:
        entry = await self._transactions.get(workspace_id, transaction_id)
        if entry is None:
            raise InvestmentTransactionNotFoundError
        return entry

    async def record(
        self, workspace_id: uuid.UUID, draft: InvestmentTransactionDraft
    ) -> InvestmentTransaction:
        """Record an investment transaction and the ledger rows for its cash, atomically."""
        entry = await self._record(workspace_id, draft)
        await self._commit()
        return entry

    async def delete_transaction(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID, *, delete_ledger: bool
    ) -> None:
        """Delete an investment transaction. The ledger rows it recorded are kept (and become
        ordinary transactions) unless `delete_ledger`. A buy that later sales depend on can't
        be deleted."""
        entry = await self.transaction(workspace_id, transaction_id)
        if entry.deposit_id is not None:
            deposit = await self._get_deposit(workspace_id, entry.deposit_id)
            if deposit.status != "active":
                raise InvestmentConflictError(
                    "This deposit is closed. Reopen it to change its history."
                )
        if entry.type == "buy" and entry.holding_id is not None:
            remaining = [
                other
                for other in await self._transactions.for_workspace(workspace_id)
                if other.holding_id == entry.holding_id and other.id != entry.id
            ]
            try:
                position(remaining)
            except OversoldError:
                raise InvestmentConflictError(
                    "Later sales use units from this purchase. Delete those sales first."
                ) from None
        await self._remove(workspace_id, entry, delete_ledger=delete_ledger)
        await self._commit()

    # SIP plans

    async def sip_plans(
        self, workspace_id: uuid.UUID, today: date, holding_id: uuid.UUID | None = None
    ) -> list[SipPlanView]:
        transactions = await self._transactions.for_workspace(workspace_id)
        return [
            _sip_view(plan, transactions)
            for plan in await self._sip_plans.list(workspace_id)
            if holding_id is None or plan.holding_id == holding_id
        ]

    async def sip_plan(
        self, workspace_id: uuid.UUID, plan_id: uuid.UUID, today: date
    ) -> SipPlanView:
        plan = await self._get_sip(workspace_id, plan_id)
        return _sip_view(plan, await self._transactions.for_workspace(workspace_id))

    async def create_sip(
        self, workspace_id: uuid.UUID, draft: SipPlanDraft, today: date
    ) -> SipPlanView:
        holding = await self._get_holding(workspace_id, draft.holding_id)
        await self._usable_profile(workspace_id, holding.account_id)
        if draft.funding_account_id is not None:
            await self._cash_account(workspace_id, draft.funding_account_id, holding)
        if draft.end_date is not None and draft.end_date < draft.next_due_date:
            raise InvalidInvestmentError("The end date can't be before the next SIP date.")
        now = self._clock()
        plan = SipPlan(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            holding_id=holding.id,
            currency=holding.currency,
            amount=draft.amount,
            frequency=draft.frequency,
            anchor_date=draft.next_due_date,
            end_date=draft.end_date,
            funding_account_id=draft.funding_account_id,
            state="active",
            notes=draft.notes,
            created_at=now,
            updated_at=now,
        )
        await self._sip_plans.add(plan)
        await self._commit()
        return await self.sip_plan(workspace_id, plan.id, today)

    async def update_sip(
        self, workspace_id: uuid.UUID, plan_id: uuid.UUID, changes: SipPlanChanges, today: date
    ) -> SipPlanView:
        """Change, pause, cancel, or resume a SIP. Resuming starts again from the plan's next
        date on or after today, so missed dates while paused aren't owed."""
        plan = await self._get_sip(workspace_id, plan_id)
        holding = await self._get_holding(workspace_id, plan.holding_id)
        if changes.funding_account_id is not UNSET and changes.funding_account_id is not None:
            await self._cash_account(workspace_id, changes.funding_account_id, holding)
        anchor = plan.anchor_date if changes.next_due_date is UNSET else changes.next_due_date
        frequency = plan.frequency if changes.frequency is UNSET else changes.frequency
        state = plan.state if changes.state is UNSET else changes.state
        if state == "active" and plan.state != "active" and changes.next_due_date is UNSET:
            anchor = next(due_dates(anchor, frequency, start=today), anchor)
        updated = replace(
            plan,
            amount=plan.amount if changes.amount is UNSET else changes.amount,
            frequency=frequency,
            anchor_date=anchor,
            end_date=plan.end_date if changes.end_date is UNSET else changes.end_date,
            funding_account_id=plan.funding_account_id
            if changes.funding_account_id is UNSET
            else changes.funding_account_id,
            state=state,
            notes=plan.notes if changes.notes is UNSET else changes.notes,
        )
        if updated.end_date is not None and updated.end_date < updated.anchor_date:
            raise InvalidInvestmentError("The end date can't be before the next SIP date.")
        if updated != plan:
            await self._sip_plans.save(replace(updated, updated_at=self._clock()))
            await self._commit()
        return await self.sip_plan(workspace_id, plan_id, today)

    async def record_sip_installment(
        self,
        workspace_id: uuid.UUID,
        plan_id: uuid.UUID,
        *,
        trade_date: date,
        quantity: int,
        amount: int | None = None,
        due_date: date | None = None,
        settlement: Settlement | None = None,
        cash_account_id: uuid.UUID | None = None,
        fees: int = 0,
        notes: str = "",
    ) -> InvestmentTransaction:
        """Record a SIP installment as a buy: the SIP's amount, from its funding account,
        settling its next unrecorded due date, unless told otherwise."""
        plan = await self._get_sip(workspace_id, plan_id)
        if settlement is None:
            settlement = "account" if plan.funding_account_id else "investment_account"
            cash_account_id = cash_account_id or plan.funding_account_id
        return await self.record(
            workspace_id,
            InvestmentTransactionDraft(
                type="buy",
                trade_date=trade_date,
                amount=amount or plan.amount,
                settlement=settlement,
                holding_id=plan.holding_id,
                sip_plan_id=plan.id,
                sip_due_date=due_date,
                quantity=quantity,
                fees=fees,
                plan="sip",
                cash_account_id=cash_account_id if settlement == "account" else None,
                notes=notes,
            ),
        )

    # Deposits

    async def deposits(self, workspace_id: uuid.UUID, today: date) -> list[DepositView]:
        transactions = await self._transactions.for_workspace(workspace_id)
        return [
            deposit_view(
                deposit, [entry for entry in transactions if entry.deposit_id == deposit.id], today
            )
            for deposit in await self._deposits.list(workspace_id)
        ]

    async def deposit(
        self, workspace_id: uuid.UUID, deposit_id: uuid.UUID, today: date
    ) -> DepositView:
        deposit = await self._get_deposit(workspace_id, deposit_id)
        transactions = await self._transactions.for_workspace(workspace_id)
        return deposit_view(
            deposit, [entry for entry in transactions if entry.deposit_id == deposit.id], today
        )

    async def create_deposit(
        self, workspace_id: uuid.UUID, draft: DepositDraft, today: date
    ) -> DepositView:
        """Open a fixed or recurring deposit and record its first deposit (a fixed deposit's
        principal, or a recurring deposit's first installment) on its start date."""
        profile = await self._usable_profile(workspace_id, draft.account_id)
        _check_term(draft.start_date, draft.maturity_date)
        now = self._clock()
        deposit = Deposit(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            account_id=profile.account_id,
            currency=profile.currency,
            kind=draft.kind,
            name=draft.name,
            institution=draft.institution,
            interest_rate_bps=draft.interest_rate_bps,
            compounding=draft.compounding,
            start_date=draft.start_date,
            maturity_date=draft.maturity_date,
            installment_amount=draft.amount if draft.kind == "recurring" else None,
            stated_maturity_amount=draft.stated_maturity_amount,
            status="active",
            closed_on=None,
            manual_value=None,
            manual_valued_on=None,
            reminder=draft.reminder,
            notes=draft.notes,
            created_at=now,
            updated_at=now,
        )
        await self._deposits.add(deposit)
        await self._record(
            workspace_id,
            InvestmentTransactionDraft(
                type="deposit",
                trade_date=draft.start_date,
                amount=draft.amount,
                settlement=draft.settlement,
                deposit_id=deposit.id,
                cash_account_id=draft.cash_account_id,
            ),
        )
        await self._sync_reminder(workspace_id, deposit, now)
        await self._commit()
        return await self.deposit(workspace_id, deposit.id, today)

    async def update_deposit(
        self, workspace_id: uuid.UUID, deposit_id: uuid.UUID, changes: DepositChanges, today: date
    ) -> DepositView:
        deposit = await self._get_deposit(workspace_id, deposit_id)
        updated = replace(
            deposit,
            name=deposit.name if changes.name is UNSET else changes.name,
            institution=deposit.institution
            if changes.institution is UNSET
            else changes.institution,
            interest_rate_bps=deposit.interest_rate_bps
            if changes.interest_rate_bps is UNSET
            else changes.interest_rate_bps,
            compounding=deposit.compounding
            if changes.compounding is UNSET
            else changes.compounding,
            maturity_date=deposit.maturity_date
            if changes.maturity_date is UNSET
            else changes.maturity_date,
            installment_amount=deposit.installment_amount
            if changes.installment_amount is UNSET
            else changes.installment_amount,
            stated_maturity_amount=deposit.stated_maturity_amount
            if changes.stated_maturity_amount is UNSET
            else changes.stated_maturity_amount,
            notes=deposit.notes if changes.notes is UNSET else changes.notes,
            reminder=deposit.reminder if changes.reminder is UNSET else changes.reminder,
        )
        _check_term(updated.start_date, updated.maturity_date)
        if (updated.kind == "recurring") != (updated.installment_amount is not None):
            raise InvalidInvestmentError(
                "Recurring deposits need a monthly installment; fixed deposits don't have one."
            )
        if updated != deposit:
            now = self._clock()
            updated = replace(updated, updated_at=now)
            await self._deposits.save(updated)
            await self._sync_reminder(workspace_id, updated, now)
            await self._commit()
        return await self.deposit(workspace_id, deposit_id, today)

    async def value_deposit(
        self,
        workspace_id: uuid.UUID,
        deposit_id: uuid.UUID,
        value: int | None,
        valued_on: date | None,
        today: date,
    ) -> DepositView:
        """Set the deposit's value by hand (it then replaces the estimate), or clear it."""
        deposit = await self._get_deposit(workspace_id, deposit_id)
        if deposit.status != "active":
            raise InvalidInvestmentError("This deposit is closed.")
        if value is not None and valued_on is None:
            raise InvalidInvestmentError("Say when the deposit had that value.")
        updated = replace(
            deposit,
            manual_value=value,
            manual_valued_on=valued_on if value is not None else None,
            updated_at=self._clock(),
        )
        await self._deposits.save(updated)
        await self._commit()
        return await self.deposit(workspace_id, deposit_id, today)

    async def close_deposit(
        self, workspace_id: uuid.UUID, deposit_id: uuid.UUID, closure: DepositClosure, today: date
    ) -> DepositView:
        """Close a deposit at maturity (`matured`) or early (`closed`). The principal still held
        returns as a withdrawal; anything received above it is interest income. Receiving less
        than the principal (a penalty) withdraws what was received; the rest is a loss."""
        deposit = await self._get_deposit(workspace_id, deposit_id)
        if deposit.status != "active":
            raise InvestmentConflictError("This deposit is already closed.")
        if closure.closed_on < deposit.start_date:
            raise InvalidInvestmentError("A deposit can't close before it starts.")
        if closure.settlement == "none":
            raise InvalidInvestmentError("Choose where the money was paid.")
        transactions = await self._transactions.for_workspace(workspace_id)
        flows = deposit_flows(
            (entry for entry in transactions if entry.deposit_id == deposit.id), closure.closed_on
        )
        later = [
            entry
            for entry in transactions
            if entry.deposit_id == deposit.id and entry.trade_date > closure.closed_on
        ]
        if later:
            raise InvalidInvestmentError(
                "This deposit has transactions after that date. Choose a later closing date."
            )
        principal = max(flows.principal, 0)
        withdrawn = min(closure.amount, principal)
        if withdrawn:
            await self._record(
                workspace_id,
                InvestmentTransactionDraft(
                    type="withdrawal",
                    trade_date=closure.closed_on,
                    amount=withdrawn,
                    settlement=closure.settlement,
                    deposit_id=deposit.id,
                    cash_account_id=closure.cash_account_id,
                ),
                allow_closing=True,
            )
        if closure.amount > principal:
            await self._record(
                workspace_id,
                InvestmentTransactionDraft(
                    type="interest",
                    trade_date=closure.closed_on,
                    amount=closure.amount - principal,
                    settlement=closure.settlement,
                    deposit_id=deposit.id,
                    cash_account_id=closure.cash_account_id,
                ),
                allow_closing=True,
            )
        now = self._clock()
        closed = replace(
            deposit,
            status="matured" if closure.closed_on >= deposit.maturity_date else "closed",
            closed_on=closure.closed_on,
            updated_at=now,
        )
        await self._deposits.save(closed)
        await self._sync_reminder(workspace_id, closed, now)
        await self._commit()
        return await self.deposit(workspace_id, deposit_id, today)

    async def reopen_deposit(
        self, workspace_id: uuid.UUID, deposit_id: uuid.UUID, *, delete_ledger: bool, today: date
    ) -> DepositView:
        """Undo a closure: remove the withdrawal and interest recorded on the closing date."""
        deposit = await self._get_deposit(workspace_id, deposit_id)
        if deposit.status == "active" or deposit.closed_on is None:
            raise InvestmentConflictError("This deposit isn't closed.")
        for entry in await self._transactions.for_workspace(workspace_id):
            if (
                entry.deposit_id == deposit.id
                and entry.trade_date == deposit.closed_on
                and entry.type in ("withdrawal", "interest")
            ):
                await self._remove(workspace_id, entry, delete_ledger=delete_ledger)
        now = self._clock()
        reopened = replace(deposit, status="active", closed_on=None, updated_at=now)
        await self._deposits.save(reopened)
        await self._sync_reminder(workspace_id, reopened, now)
        await self._commit()
        return await self.deposit(workspace_id, deposit_id, today)

    # Recording

    async def _record(
        self,
        workspace_id: uuid.UUID,
        draft: InvestmentTransactionDraft,
        *,
        allow_closing: bool = False,
    ) -> InvestmentTransaction:
        """Validate the transaction, create its ledger rows, and add it, without committing."""
        holding: Holding | None = None
        deposit: Deposit | None = None
        if draft.holding_id is not None:
            holding = await self._get_holding(workspace_id, draft.holding_id, missing="invalid")
        if draft.deposit_id is not None:
            deposit = await self._get_deposit(workspace_id, draft.deposit_id, missing="invalid")
        _check_shape(draft, holding, deposit)

        if holding is not None:
            account_id = holding.account_id
        elif deposit is not None:
            account_id = deposit.account_id
        elif draft.account_id is not None:
            account_id = draft.account_id
        else:
            raise InvalidInvestmentError("Choose the investment account.")
        profile = await self._usable_profile(workspace_id, account_id)
        if deposit is not None and deposit.status != "active" and not allow_closing:
            raise InvalidInvestmentError("This deposit is closed.")
        if deposit is not None and draft.trade_date < deposit.start_date:
            raise InvalidInvestmentError("That date is before the deposit started.")

        cash_account_id: uuid.UUID | None = None
        if draft.settlement == "account":
            if draft.cash_account_id is None:
                raise InvalidInvestmentError("Choose the account the money came from or went to.")
            if draft.cash_account_id == profile.account_id:
                raise InvalidInvestmentError(
                    "Choose another account, or settle through the investment account's cash."
                )
            cash_account_id = draft.cash_account_id
            await self._cash_account(workspace_id, cash_account_id, profile)
        elif draft.cash_account_id is not None:
            raise InvalidInvestmentError("Only money settled through another account names one.")

        transactions = await self._transactions.for_workspace(workspace_id)
        now = self._clock()
        entry = InvestmentTransaction(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            account_id=profile.account_id,
            currency=profile.currency,
            type=draft.type,
            trade_date=draft.trade_date,
            amount=draft.amount,
            fees=draft.fees,
            holding_id=draft.holding_id,
            deposit_id=draft.deposit_id,
            sip_plan_id=draft.sip_plan_id,
            sip_due_date=draft.sip_due_date,
            quantity=draft.quantity,
            plan=(draft.plan or "lump_sum") if draft.type == "buy" else None,
            settlement=draft.settlement,
            cash_account_id=cash_account_id,
            cash_transaction_id=None,
            fee_transaction_id=None,
            notes=draft.notes,
            created_at=now,
            updated_at=now,
        )
        if draft.sip_plan_id is not None:
            plan = await self._get_sip(workspace_id, draft.sip_plan_id, missing="invalid")
            if holding is None or plan.holding_id != holding.id:
                raise InvalidInvestmentError("That SIP is for another holding.")
            due = draft.sip_due_date or _next_sip_due(plan, transactions)
            if due is None:
                raise InvalidInvestmentError("This SIP has no installment left to record.")
            if any(
                other.sip_plan_id == plan.id and other.sip_due_date == due for other in transactions
            ):
                raise InvestmentConflictError(
                    f"The installment due {_short_date(due)} is already recorded."
                )
            entry = replace(entry, plan="sip", sip_due_date=due)

        if holding is not None and draft.type in ("buy", "sell"):
            history = [other for other in transactions if other.holding_id == holding.id]
            try:
                position([*history, entry])
            except OversoldError as error:
                raise InvalidInvestmentError(
                    f"That sells more units than were held on {_short_date(error.sold_on)}."
                ) from None
        if deposit is not None and draft.type == "withdrawal" and not allow_closing:
            held = deposit_flows(
                (other for other in transactions if other.deposit_id == deposit.id),
                draft.trade_date,
            ).principal
            if draft.amount > held:
                raise InvalidInvestmentError(
                    "That withdraws more than the deposit's principal. Close the deposit to "
                    "record interest."
                )

        label = holding.name if holding else deposit.name if deposit else "Investment account"
        try:
            entry = await self._ledger_rows(workspace_id, entry, label)
        except InvalidTransactionError as error:
            await self._unit_of_work.rollback()
            raise InvalidInvestmentError(error.message) from None
        try:
            await self._transactions.add(entry)
        except ConflictError:
            await self._unit_of_work.rollback()
            raise InvestmentConflictError(
                "Something changed in the meantime. Refresh and try again."
            ) from None
        return entry

    async def _ledger_rows(
        self, workspace_id: uuid.UUID, entry: InvestmentTransaction, label: str
    ) -> InvestmentTransaction:
        """Create the ledger rows for the transaction's cash and fees; return it linked."""
        own = entry.account_id
        other = entry.cash_account_id
        payer = other or own
        cash_id: uuid.UUID | None = None
        if entry.type in ("buy", "deposit") and other is not None:
            cash_id = await self._ledger(
                workspace_id,
                TransactionDraft(
                    type="transfer",
                    amount=entry.amount,
                    occurred_on=entry.trade_date,
                    description=f"{label} {'purchase' if entry.type == 'buy' else 'deposit'}",
                    account_id=other,
                    to_account_id=own,
                ),
            )
        elif entry.type in ("sell", "withdrawal") and other is not None:
            cash_id = await self._ledger(
                workspace_id,
                TransactionDraft(
                    type="transfer",
                    amount=entry.amount,
                    occurred_on=entry.trade_date,
                    description=f"{label} {'sale' if entry.type == 'sell' else 'withdrawal'}",
                    account_id=own,
                    to_account_id=other,
                ),
            )
        elif entry.type in ("dividend", "interest"):
            key = DIVIDENDS_KEY if entry.type == "dividend" else INTEREST_KEY
            cash_id = await self._ledger(
                workspace_id,
                TransactionDraft(
                    type="income",
                    amount=entry.amount,
                    occurred_on=entry.trade_date,
                    description=f"{label} {entry.type}",
                    account_id=payer,
                    category_id=await self._category(workspace_id, key),
                ),
            )
        elif entry.type == "fee":
            cash_id = await self._ledger(
                workspace_id,
                TransactionDraft(
                    type="expense",
                    amount=entry.amount,
                    occurred_on=entry.trade_date,
                    description=f"{label} charges",
                    account_id=payer,
                    category_id=await self._category(workspace_id, FEES_KEY),
                ),
            )
        fee_id: uuid.UUID | None = None
        if entry.fees:
            fee_id = await self._ledger(
                workspace_id,
                TransactionDraft(
                    type="expense",
                    amount=entry.fees,
                    occurred_on=entry.trade_date,
                    description=f"{label} {entry.type} charges",
                    account_id=payer,
                    category_id=await self._category(workspace_id, FEES_KEY),
                ),
            )
        return replace(entry, cash_transaction_id=cash_id, fee_transaction_id=fee_id)

    async def _ledger(self, workspace_id: uuid.UUID, draft: TransactionDraft) -> uuid.UUID:
        return (await self._finance.create(workspace_id, draft, commit=False)).id

    async def _remove(
        self, workspace_id: uuid.UUID, entry: InvestmentTransaction, *, delete_ledger: bool
    ) -> None:
        await self._transactions.delete(workspace_id, entry.id)
        if delete_ledger:
            for ledger_id in (entry.cash_transaction_id, entry.fee_transaction_id):
                if ledger_id is not None:
                    await self._finance.delete(workspace_id, ledger_id, commit=False)

    async def _category(self, workspace_id: uuid.UUID, key: str) -> uuid.UUID | None:
        # Reading the categories seeds the built-in ones.
        for category in await self._finance.categories(workspace_id):
            if category.key == key:
                return category.id
        return None

    # Reminders

    async def _sync_reminder(
        self, workspace_id: uuid.UUID, deposit: Deposit, now: datetime
    ) -> None:
        """Keep the deposit's maturity reminder pointed at its maturity date, or delete it when
        reminders are off, the deposit is closed, or the reminder time has passed."""
        target: ReminderTarget | None = None
        settings = deposit.reminder
        if settings is not None and deposit.status == "active":
            start = deposit.maturity_date - timedelta(days=settings.days_before)
            if local_to_utc(start, settings.time_of_day, ZoneInfo(settings.timezone)) > now:
                amount = deposit.stated_maturity_amount
                prefix = "" if amount is not None else "About "
                if amount is None:
                    transactions = [
                        entry
                        for entry in await self._transactions.for_workspace(workspace_id)
                        if entry.deposit_id == deposit.id
                    ]
                    amount = deposit_view(
                        deposit, transactions, deposit.start_date
                    ).projected_maturity_amount
                target = ReminderTarget(
                    schedule=Schedule(
                        start_date=start,
                        time_of_day=settings.time_of_day,
                        timezone=settings.timezone,
                    ),
                    title=f"{deposit.name} matures {_short_date(deposit.maturity_date)}",
                    description=(
                        f"{prefix}{deposit.currency} "
                        f"{to_decimal_string(amount, deposit.currency)} at maturity"
                    ),
                )
        await point_reminder(
            self._reminders,
            self._scheduler,
            workspace_id,
            CommitmentLink("deposit", deposit.id),
            target,
            now,
        )

    # Lookups

    async def _existing_account(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> Account:
        try:
            return (await self._finance.account(workspace_id, account_id)).account
        except AccountNotFoundError:
            raise InvalidInvestmentError("That account doesn't exist in this workspace.") from None

    async def _linked_account(
        self,
        workspace_id: uuid.UUID,
        account_id: uuid.UUID,
        currency: Currency,
        own_id: uuid.UUID | None,
    ) -> None:
        account = await self._existing_account(workspace_id, account_id)
        if account.id == own_id:
            raise InvalidInvestmentError("Link a different account.")
        if ACCOUNT_CLASSES[account.type] == "liability":
            raise InvalidInvestmentError("Link a bank, cash, or other asset account.")
        if account.currency != currency:
            raise InvalidInvestmentError(f"Link an account in {currency}.")

    async def _cash_account(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, owner: InvestmentProfile | Holding
    ) -> None:
        account = await self._existing_account(workspace_id, account_id)
        if account.currency != owner.currency:
            raise InvalidInvestmentError(f"Choose an account in {owner.currency}.")
        if account.type == "loan":
            raise InvalidInvestmentError("Money can't come from or go to a loan account.")
        if account.archived_at is not None:
            raise InvalidInvestmentError(f"“{account.name}” is archived. Restore it first.")

    async def _get_profile(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID
    ) -> InvestmentProfile:
        profile = await self._profiles.get(workspace_id, account_id)
        if profile is None:
            raise InvestmentAccountNotFoundError
        return profile

    async def _usable_profile(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID
    ) -> InvestmentProfile:
        profile = await self._profiles.get(workspace_id, account_id)
        if profile is None:
            raise InvalidInvestmentError("That investment account doesn't exist in this workspace.")
        account = await self._existing_account(workspace_id, account_id)
        if account.archived_at is not None:
            raise InvalidInvestmentError(f"“{account.name}” is archived. Restore it first.")
        return profile

    async def _get_holding(
        self, workspace_id: uuid.UUID, holding_id: uuid.UUID, *, missing: str = "not_found"
    ) -> Holding:
        holding = await self._holdings.get(workspace_id, holding_id)
        if holding is None:
            if missing == "invalid":
                raise InvalidInvestmentError("That holding doesn't exist in this workspace.")
            raise HoldingNotFoundError
        return holding

    async def _get_deposit(
        self, workspace_id: uuid.UUID, deposit_id: uuid.UUID, *, missing: str = "not_found"
    ) -> Deposit:
        deposit = await self._deposits.get(workspace_id, deposit_id)
        if deposit is None:
            if missing == "invalid":
                raise InvalidInvestmentError("That deposit doesn't exist in this workspace.")
            raise DepositNotFoundError
        return deposit

    async def _get_sip(
        self, workspace_id: uuid.UUID, plan_id: uuid.UUID, *, missing: str = "not_found"
    ) -> SipPlan:
        plan = await self._sip_plans.get(workspace_id, plan_id)
        if plan is None:
            if missing == "invalid":
                raise InvalidInvestmentError("That SIP doesn't exist in this workspace.")
            raise SipPlanNotFoundError
        return plan

    async def _check_unique(self, workspace_id: uuid.UUID, holding: Holding) -> None:
        for other in await self._holdings.list(workspace_id):
            if (
                other.id != holding.id
                and other.account_id == holding.account_id
                and other.identity == holding.identity
            ):
                raise _duplicate_holding()

    async def _commit(self) -> None:
        try:
            await self._unit_of_work.commit()
        except ConflictError:
            raise InvestmentConflictError(
                "Something changed in the meantime. Refresh and try again."
            ) from None


def _duplicate_holding() -> InvestmentConflictError:
    return InvestmentConflictError(
        "This account already has that holding (same ISIN, symbol, or name, and folio)."
    )


def _check_term(start: date, maturity: date) -> None:
    if maturity <= start:
        raise InvalidInvestmentError("The maturity date must be after the start date.")
    if maturity.year - start.year > MAX_DEPOSIT_YEARS:
        raise InvalidInvestmentError(f"Deposits can run for at most {MAX_DEPOSIT_YEARS} years.")


def _check_shape(
    draft: InvestmentTransactionDraft, holding: Holding | None, deposit: Deposit | None
) -> None:
    """The rules each type follows (mirrored by the table's CHECK constraints)."""
    kind = draft.type
    if kind in ("buy", "sell"):
        if holding is None or deposit is not None:
            raise InvalidInvestmentError("Buys and sales are of a holding.")
        if not draft.quantity:
            raise InvalidInvestmentError("Enter how many units.")
    elif draft.quantity is not None:
        raise InvalidInvestmentError("Only buys and sales have units.")
    if kind in ("deposit", "withdrawal") and (deposit is None or holding is not None):
        raise InvalidInvestmentError(
            "Deposits and withdrawals are of a fixed or recurring deposit."
        )
    if kind == "dividend" and (holding is None or deposit is not None):
        raise InvalidInvestmentError("Dividends are paid on a holding.")
    if kind in ("interest", "fee") and holding is not None and deposit is not None:
        raise InvalidInvestmentError("Choose a holding or a deposit, not both.")
    if draft.fees and kind not in ("buy", "sell"):
        raise InvalidInvestmentError("Only buys and sales have charges; record a fee instead.")
    if draft.settlement == "none":
        if kind not in ("buy", "deposit"):
            raise InvalidInvestmentError(
                "Only buys and deposits can be from outside Orbit; choose where the money went."
            )
        if draft.fees:
            raise InvalidInvestmentError("Charges need an account to be paid from.")
    if draft.plan is not None and kind != "buy":
        raise InvalidInvestmentError("Only buys are lump sums or SIP installments.")
    if draft.sip_plan_id is None and draft.sip_due_date is not None:
        raise InvalidInvestmentError("A SIP due date needs its SIP.")
    if draft.sip_plan_id is not None and kind != "buy":
        raise InvalidInvestmentError("SIP installments are buys.")


def _next_sip_due(plan: SipPlan, transactions: Iterable[InvestmentTransaction]) -> date | None:
    """The plan's first due date with no buy recorded for it, possibly already past."""
    if plan.state != "active":
        return None
    recorded = {entry.sip_due_date for entry in transactions if entry.sip_plan_id == plan.id}
    for due in islice(
        due_dates(plan.anchor_date, plan.frequency, end=plan.end_date), _SIP_SEARCH_LIMIT
    ):
        if due not in recorded:
            return due
    return None


def _sip_view(plan: SipPlan, transactions: Iterable[InvestmentTransaction]) -> SipPlanView:
    """The next due date doesn't depend on today: one before today is overdue."""
    entries = list(transactions)
    bought = [entry for entry in entries if entry.sip_plan_id == plan.id]
    return SipPlanView(
        plan=plan,
        next_due_date=_next_sip_due(plan, entries),
        installments=len(bought),
        invested=sum(entry.amount for entry in bought),
        last_bought_on=max((entry.trade_date for entry in bought), default=None),
    )
