"""Net worth today, on any past date, and as stored monthly snapshots.

**Snapshots** record one currency's net worth for one calendar month, valued as of the month's
last day (or today, for the current month). They are idempotent: the database allows one per
workspace, currency, and month, so generating one twice returns the first. Only the current
month's snapshot can be deliberately refreshed; past months stay as recorded.

Each snapshot keeps where it came from (`scheduled` by the reminder worker at month end,
`manual` for the current month, or `backfill`, reconstructed later from history) and how many
of its values were estimates, manual valuations, stale, or missing, so a chart can tell actual
values from estimated ones.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Literal, Protocol

from orbit_api.services.finance.money import Currency, add_months, month_bounds
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.investments.assets import AssetService
from orbit_api.services.investments.models import InvalidInvestmentError, InvestmentConflictError
from orbit_api.services.investments.service import InvestmentService
from orbit_api.services.networth.calculation import GroupTotal, NetWorth, calculate
from orbit_api.services.transactions import ConflictError
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.clock import utc_now

SnapshotSource = Literal["scheduled", "manual", "backfill"]
# The periods the dashboard compares against, in months.
CHANGE_PERIODS = (1, 3, 6, 12)


@dataclass(frozen=True, slots=True)
class Snapshot:
    id: uuid.UUID
    workspace_id: uuid.UUID
    currency: Currency
    period_start: date
    as_of: date
    assets: int
    liabilities: int
    groups: list[GroupTotal]
    source: SnapshotSource
    estimated_items: int
    manual_items: int
    stale_items: int
    missing_items: int
    created_at: datetime
    updated_at: datetime

    @property
    def net_worth(self) -> int:
        return self.assets - self.liabilities


@dataclass(frozen=True, slots=True)
class PeriodChange:
    months: int
    # The snapshot of the month `months` before the current one, if one was taken.
    snapshot: Snapshot | None
    change: int | None


class SnapshotRepository(Protocol):
    async def add(self, snapshot: Snapshot) -> None:
        """Raises `ConflictError` if the period already has a snapshot."""
        ...

    async def get(
        self, workspace_id: uuid.UUID, currency: Currency, period_start: date
    ) -> Snapshot | None: ...

    async def list(self, workspace_id: uuid.UUID, currency: Currency) -> list[Snapshot]:
        """Oldest period first."""
        ...

    async def save(self, snapshot: Snapshot) -> None: ...

    async def workspaces_with_finance(self) -> Sequence[uuid.UUID]:
        """Workspaces with any finance account or asset: those a scheduled snapshot covers."""
        ...


class NetWorthService:
    def __init__(
        self,
        investments: InvestmentService,
        assets: AssetService,
        finance: FinanceService,
        snapshots: SnapshotRepository,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._investments = investments
        self._assets = assets
        self._finance = finance
        self._snapshots = snapshots
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def currencies(self, workspace_id: uuid.UUID) -> list[Currency]:
        """Currencies with any account or asset, in order. Net worth is per currency: amounts
        in different currencies are never added together."""
        found: set[Currency] = {
            view.account.currency for view in await self._finance.accounts(workspace_id)
        }
        found |= {view.asset.currency for view in await self._assets.views(workspace_id, date.max)}
        return sorted(found)

    async def net_worth(self, workspace_id: uuid.UUID, currency: Currency, as_of: date) -> NetWorth:
        book = await self._investments.book(workspace_id, as_of)
        return calculate(
            currency,
            as_of,
            list(book.ledger.values()),
            book.accounts,
            book.holdings,
            book.deposits,
            await self._assets.views(workspace_id, as_of),
        )

    async def snapshots(self, workspace_id: uuid.UUID, currency: Currency) -> list[Snapshot]:
        return await self._snapshots.list(workspace_id, currency)

    async def changes(
        self, workspace_id: uuid.UUID, current: NetWorth, today: date
    ) -> list[PeriodChange]:
        """How net worth today compares with the snapshots 1, 3, 6, and 12 months back."""
        snapshots = {
            entry.period_start: entry
            for entry in await self._snapshots.list(workspace_id, current.currency)
        }
        this_month = month_bounds(today)[0]
        result: list[PeriodChange] = []
        for months in CHANGE_PERIODS:
            then = snapshots.get(add_months(this_month, -months))
            result.append(
                PeriodChange(
                    months=months,
                    snapshot=then,
                    change=None if then is None else current.net_worth - then.net_worth,
                )
            )
        return result

    async def take_snapshot(
        self,
        workspace_id: uuid.UUID,
        currency: Currency,
        month: date,
        today: date,
        *,
        refresh: bool = False,
        scheduled: bool = False,
    ) -> tuple[Snapshot, bool]:
        """The month's snapshot, and whether this call created (or refreshed) it. A month that
        has one already returns it unchanged, unless it is the current month and `refresh`."""
        period, last_day = month_bounds(month)
        current_period = month_bounds(today)[0]
        if period > current_period:
            raise InvalidInvestmentError("Snapshots can't be taken for future months.")
        is_current = period == current_period
        if refresh and not is_current:
            raise InvestmentConflictError("Past months keep the snapshot they were given.")
        existing = await self._snapshots.get(workspace_id, currency, period)
        if existing is not None and not refresh:
            return existing, False

        as_of = today if is_current else last_day
        source: SnapshotSource = (
            "scheduled" if scheduled else "manual" if is_current else "backfill"
        )
        worth = await self.net_worth(workspace_id, currency, as_of)
        now = self._clock()
        snapshot = Snapshot(
            id=existing.id if existing else uuid.uuid4(),
            workspace_id=workspace_id,
            currency=currency,
            period_start=period,
            as_of=as_of,
            assets=worth.assets,
            liabilities=worth.liabilities,
            groups=worth.groups,
            source=source,
            estimated_items=worth.quality.estimated,
            manual_items=worth.quality.manual,
            stale_items=worth.quality.stale,
            missing_items=worth.quality.missing,
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        if existing is not None:
            await self._snapshots.save(replace(snapshot, source=source))
            await self._unit_of_work.commit()
            return snapshot, True
        try:
            await self._snapshots.add(snapshot)
            await self._unit_of_work.commit()
        except ConflictError:
            # A concurrent request or the worker took it first: keep theirs.
            await self._unit_of_work.rollback()
            taken = await self._snapshots.get(workspace_id, currency, period)
            if taken is None:
                raise
            return taken, False
        return snapshot, True

    async def close_month(self, workspace_id: uuid.UUID, today: date) -> int:
        """Take the previous month's snapshot in every currency, if missing. Called by the
        reminder worker; returns how many it created."""
        previous = add_months(month_bounds(today)[0], -1)
        created = 0
        for currency in await self.currencies(workspace_id):
            _, made = await self.take_snapshot(
                workspace_id, currency, previous, today, scheduled=True
            )
            created += made
        return created
