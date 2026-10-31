"""Budgets: spending limits per month or custom period, read against the ledger.

**Spending comes from the ledger, through `FinanceService`.** A budget's spending is the net
spending (expenses minus refunds) in its currency and period: overall, or in its category. That
is exactly the dashboard's "spending by category" aggregate, so a budget and the Overview never
disagree. The phase 1 to 3 rules decide what is spending, and budgets inherit them: income,
transfers (card bills, investment purchases, savings moves, loan principal) never count; loan
interest, fees, subscription and bill payments count once, as the expenses they recorded; an
expected bill counts only once a payment is recorded; refunds reduce their category.

**Periods are stored as they start**, so history keeps its amounts: an edit changes the current
and future periods only. Reads never write; a period the worker hasn't stored yet is computed
from the budget as it is now, which is what storing it would record.

**Closing** happens once a period has ended (the reminder worker checks every few minutes, in
the owner's time zone; edits close finished periods first). It stores the spending at that moment
and writes the rollover into the next period, guarded by a conditional update so it happens once.
Later corrections to a closed period's transactions update its spending in history, but not the
rollover it already passed on.

**Alerts** are sent by the same worker check: one in-app notification when a threshold is first
crossed in a period, recorded per period and threshold so it is never repeated.

Every method takes a `workspace_id` the caller has authorized; repositories filter by it.
"""

import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Final, Protocol

from orbit_api.services.budgets.calculation import (
    alerts_due,
    budget_status,
    next_period,
    period_containing,
    periods_through,
    ranges_overlap,
    rollover_amount,
    utilization,
)
from orbit_api.services.budgets.models import (
    MAX_THRESHOLD_PERCENT,
    MAX_THRESHOLDS,
    Budget,
    BudgetAlert,
    BudgetChanges,
    BudgetConflictError,
    BudgetDetail,
    BudgetDraft,
    BudgetNotFoundError,
    BudgetOwner,
    BudgetPeriod,
    BudgetView,
    CategoryMonth,
    CopyResult,
    InvalidBudgetError,
    MonthSummary,
    PeriodView,
    TotalBasis,
)
from orbit_api.services.finance.models import Category, CategorySpending
from orbit_api.services.finance.money import (
    Currency,
    add_months,
    month_bounds,
    to_decimal_string,
)
from orbit_api.services.notifications.models import Notification
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

# A custom period longer than a year is a different kind of plan.
MAX_CUSTOM_DAYS: Final = 366


class BudgetRepository(Protocol):
    async def add(self, budget: Budget) -> None: ...

    async def get(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> Budget | None:
        """The budget, only if it belongs to `workspace_id`."""
        ...

    async def list(self, workspace_id: uuid.UUID) -> list[Budget]:
        """Every budget in the workspace, oldest first."""
        ...

    async def save(self, budget: Budget) -> None: ...

    async def delete(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> None:
        """Delete the budget with its periods and alert records. Notifications stay."""
        ...

    async def owners(self) -> Sequence[BudgetOwner]:
        """Workspaces with an active budget, with their owner and the owner's time zone."""
        ...


class PeriodRepository(Protocol):
    async def for_budget(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> list[BudgetPeriod]:
        """The budget's stored periods, oldest first."""
        ...

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[BudgetPeriod]: ...

    async def add(self, period: BudgetPeriod) -> None:
        """Raises `ConflictError` if the budget has a period starting that day already."""
        ...

    async def save(self, period: BudgetPeriod) -> None:
        """Store an open period's dates, base amount, and rollover."""
        ...

    async def close(
        self, workspace_id: uuid.UUID, period_id: uuid.UUID, spent: int, closed_at: datetime
    ) -> bool:
        """Close the period if it is still open; report whether this call closed it."""
        ...

    async def delete(self, workspace_id: uuid.UUID, period_ids: Iterable[uuid.UUID]) -> None:
        """Delete open periods (with their alert records)."""
        ...


class AlertRepository(Protocol):
    async def thresholds(self, workspace_id: uuid.UUID, period_id: uuid.UUID) -> set[int]:
        """The thresholds already recorded for the period."""
        ...

    async def add(self, alert: BudgetAlert) -> None:
        """Raises `ConflictError` if the period has that threshold recorded already."""
        ...


class CategoryLookup(Protocol):
    async def get(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> Category | None: ...


class SpendingReader(Protocol):
    """Net spending per category: `FinanceService.spending_by_category`."""

    async def spending_by_category(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[CategorySpending]: ...


class NotificationSink(Protocol):
    async def add(self, notification: Notification) -> None: ...


@dataclass(frozen=True, slots=True)
class MonthSpending:
    """One month's net spending in one currency: in total and per category (`None` for
    uncategorized). Totals can't go below zero."""

    total: int
    by_category: dict[uuid.UUID | None, int]


@dataclass(frozen=True, slots=True)
class CheckReport:
    closed: int
    alerts: int


class _Spending:
    """Spending per currency and date range, read once per service call."""

    def __init__(self, reader: SpendingReader, workspace_id: uuid.UUID) -> None:
        self._reader = reader
        self._workspace_id = workspace_id
        self._cache: dict[tuple[Currency, date, date], MonthSpending] = {}

    async def of(self, currency: Currency, start: date, end: date) -> MonthSpending:
        key = (currency, start, end)
        if key not in self._cache:
            entries = await self._reader.spending_by_category(
                self._workspace_id, currency, start, end
            )
            self._cache[key] = MonthSpending(
                total=max(sum(entry.net for entry in entries), 0),
                by_category={entry.category_id: entry.net for entry in entries},
            )
        return self._cache[key]

    async def for_budget(self, budget: Budget, start: date, end: date) -> int:
        spending = await self.of(budget.currency, start, end)
        if budget.scope == "overall":
            return spending.total
        return spending.by_category.get(budget.category_id, 0)


class BudgetService:
    def __init__(
        self,
        budgets: BudgetRepository,
        periods: PeriodRepository,
        alerts: AlertRepository,
        categories: CategoryLookup,
        spending: SpendingReader,
        notifications: NotificationSink,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._budgets = budgets
        self._periods = periods
        self._alerts = alerts
        self._categories = categories
        self._spending = spending
        self._notifications = notifications
        self._unit_of_work = unit_of_work
        self._clock = clock

    # Reads

    async def views(self, workspace_id: uuid.UUID, today: date) -> list[BudgetView]:
        """Every budget with its current period: active ones first, then by name."""
        budgets = await self._budgets.list(workspace_id)
        stored = _by_budget(await self._periods.for_workspace(workspace_id))
        spending = _Spending(self._spending, workspace_id)
        views = [
            await self._view(budget, stored.get(budget.id, []), today, spending)
            for budget in budgets
        ]
        order = {"active": 0, "upcoming": 1, "completed": 2, "archived": 3}
        return sorted(views, key=lambda view: (order[view.status], view.budget.name.casefold()))

    async def detail(
        self, workspace_id: uuid.UUID, budget_id: uuid.UUID, today: date
    ) -> BudgetDetail:
        budget = await self._get(workspace_id, budget_id)
        stored = await self._periods.for_budget(workspace_id, budget_id)
        spending = _Spending(self._spending, workspace_id)
        timeline = await self._timeline(budget, stored, _through(budget, today), today, spending)
        closed = [entry for entry in timeline if entry.period.closed_at is not None]
        within = sum(
            1 for entry in closed if (entry.period.spent_at_close or 0) <= entry.period.available
        )
        return BudgetDetail(
            view=BudgetView(
                budget=budget,
                status=budget_status(budget, today),
                current=timeline[-1] if timeline else None,
            ),
            periods=list(reversed(timeline)),
            periods_within=within,
            periods_closed=len(closed),
        )

    async def month(
        self, workspace_id: uuid.UUID, currency: Currency, month: date, today: date
    ) -> tuple[list[PeriodView], list[Budget], MonthSpending]:
        """The periods of non-archived budgets in `currency` that overlap the calendar month,
        their budgets, and the month's spending."""
        start, end = month_bounds(month)
        spending = _Spending(self._spending, workspace_id)
        stored = _by_budget(await self._periods.for_workspace(workspace_id))
        periods: list[PeriodView] = []
        budgets: list[Budget] = []
        for budget in await self._budgets.list(workspace_id):
            if budget.state == "archived" or budget.currency != currency:
                continue
            if not ranges_overlap(budget.start_date, budget.end_date, start, end):
                continue
            through = period_containing(budget, max(start, budget.start_date))
            if through is None:
                continue
            timeline = await self._timeline(
                budget, stored.get(budget.id, []), through[0], today, spending
            )
            if timeline:
                periods.append(timeline[-1])
                budgets.append(budget)
        return periods, budgets, await spending.of(currency, start, end)

    async def summary(
        self, workspace_id: uuid.UUID, currency: Currency, month: date, today: date
    ) -> MonthSummary:
        periods, budgets, spending = await self.month(workspace_id, currency, month, today)
        return summarize_month(
            month_bounds(month)[0], list(zip(budgets, periods, strict=True)), spending
        )

    async def history(
        self,
        workspace_id: uuid.UUID,
        currency: Currency,
        last_month: date,
        months: int,
        today: date,
    ) -> list[MonthSummary]:
        """`summary` for each of the `months` months through `last_month`, oldest first."""
        first = add_months(month_bounds(last_month)[0], -(months - 1))
        return [
            await self.summary(workspace_id, currency, add_months(first, offset), today)
            for offset in range(months)
        ]

    # Changes

    async def create(self, workspace_id: uuid.UUID, draft: BudgetDraft, today: date) -> BudgetView:
        now = self._clock()
        budget = Budget(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=draft.name,
            scope=draft.scope,
            category_id=draft.category_id if draft.scope == "category" else None,
            currency=draft.currency,
            amount=draft.amount,
            period=draft.period,
            start_date=draft.start_date,
            end_date=draft.end_date,
            rollover=draft.rollover,
            alerts_enabled=draft.alerts_enabled,
            alert_thresholds=_thresholds(draft.alert_thresholds),
            state="active",
            notes=draft.notes,
            archived_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._check(budget)
        await self._budgets.add(budget)
        await self._settle(budget, [], today)
        await self._unit_of_work.commit()
        return await self._view_of(budget, today)

    async def update(
        self, workspace_id: uuid.UUID, budget_id: uuid.UUID, changes: BudgetChanges, today: date
    ) -> BudgetView:
        """Change a budget from the current period on. Finished periods are closed first, so they
        keep the amount and rollover they had."""
        budget = await self._get(workspace_id, budget_id)
        stored = await self._settle(
            budget, await self._periods.for_budget(workspace_id, budget_id), today
        )
        updated = replace(
            budget,
            name=budget.name if changes.name is UNSET else changes.name,
            amount=budget.amount if changes.amount is UNSET else changes.amount,
            start_date=budget.start_date if changes.start_date is UNSET else changes.start_date,
            end_date=budget.end_date if changes.end_date is UNSET else changes.end_date,
            rollover=budget.rollover if changes.rollover is UNSET else changes.rollover,
            alerts_enabled=budget.alerts_enabled
            if changes.alerts_enabled is UNSET
            else changes.alerts_enabled,
            alert_thresholds=budget.alert_thresholds
            if changes.alert_thresholds is UNSET
            else _thresholds(changes.alert_thresholds),
            notes=budget.notes if changes.notes is UNSET else changes.notes,
        )
        if updated == budget:
            await self._unit_of_work.commit()
            return await self._view_of(budget, today)

        closed = [period for period in stored if period.closed_at is not None]
        open_periods = [period for period in stored if period.closed_at is None]
        if updated.start_date != budget.start_date and closed:
            raise InvalidBudgetError(
                "This budget has finished periods, so its start can't move. End it and add a new "
                "budget instead."
            )
        if closed and updated.period == "custom" and updated.end_date != budget.end_date:
            raise InvalidBudgetError("This period has finished, so its dates can't change.")
        if closed and updated.end_date is not None and updated.end_date < closed[-1].end:
            raise InvalidBudgetError(
                "A budget can't end before a period that has already finished."
            )
        await self._check(updated)

        # Open periods follow the new definition: those now outside the budget go (a moved custom
        # range is rebuilt at its new dates), the rest take the new dates and amount. Closed ones
        # are history and stay as they are.
        dropped = [
            period
            for period in open_periods
            if period_containing(updated, period.start) is None
            or (updated.period == "custom" and period.start != updated.start_date)
        ]
        await self._periods.delete(workspace_id, [period.id for period in dropped])
        for period in open_periods:
            if period in dropped:
                continue
            bounds = period_containing(updated, period.start)
            assert bounds is not None
            await self._periods.save(
                replace(period, start=bounds[0], end=bounds[1], base_amount=updated.amount)
            )
        saved = replace(updated, updated_at=self._clock())
        await self._budgets.save(saved)
        await self._settle(saved, await self._periods.for_budget(workspace_id, budget_id), today)
        await self._unit_of_work.commit()
        return await self._view_of(saved, today)

    async def archive(
        self, workspace_id: uuid.UUID, budget_id: uuid.UUID, today: date
    ) -> BudgetView:
        """Stop tracking the budget, keeping its history. Idempotent."""
        budget = await self._get(workspace_id, budget_id)
        if budget.state != "archived":
            await self._settle(
                budget, await self._periods.for_budget(workspace_id, budget_id), today
            )
            budget = replace(
                budget, state="archived", archived_at=self._clock(), updated_at=self._clock()
            )
            await self._budgets.save(budget)
            await self._unit_of_work.commit()
        return await self._view_of(budget, today)

    async def restore(
        self, workspace_id: uuid.UUID, budget_id: uuid.UUID, today: date
    ) -> BudgetView:
        budget = await self._get(workspace_id, budget_id)
        if budget.state == "archived":
            budget = replace(budget, state="active", archived_at=None, updated_at=self._clock())
            await self._check(budget)
            await self._budgets.save(budget)
            await self._settle(
                budget, await self._periods.for_budget(workspace_id, budget_id), today
            )
            await self._unit_of_work.commit()
        return await self._view_of(budget, today)

    async def delete(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> None:
        """Delete the budget and its history. Transactions are untouched; notifications already
        sent stay in the inbox."""
        await self._get(workspace_id, budget_id)
        await self._budgets.delete(workspace_id, budget_id)
        await self._unit_of_work.commit()

    async def copy_month(
        self, workspace_id: uuid.UUID, source: date, target: date, today: date
    ) -> CopyResult:
        """Copy the monthly budgets of `source`'s month into `target`'s as one-month budgets,
        with the amounts they had then. Budgets already covering the target month (recurring
        ones, or one added there) are skipped, as are custom ones."""
        source_start = month_bounds(source)[0]
        target_start, target_end = month_bounds(target)
        if source_start == target_start:
            raise InvalidBudgetError("Choose a different month to copy from.")
        budgets = [
            budget for budget in await self._budgets.list(workspace_id) if budget.state == "active"
        ]
        stored = _by_budget(await self._periods.for_workspace(workspace_id))
        created: list[Budget] = []
        skipped: list[Budget] = []
        now = self._clock()
        for budget in budgets:
            if budget.period != "monthly" or period_containing(budget, source_start) is None:
                continue
            covered = any(
                other.currency == budget.currency
                and other.scope == budget.scope
                and other.category_id == budget.category_id
                and ranges_overlap(other.start_date, other.end_date, target_start, target_end)
                for other in [*budgets, *created]
            )
            if covered:
                skipped.append(budget)
                continue
            period = next(
                (entry for entry in stored.get(budget.id, []) if entry.start == source_start),
                None,
            )
            copy = replace(
                budget,
                id=uuid.uuid4(),
                amount=period.base_amount if period else budget.amount,
                start_date=target_start,
                end_date=target_end,
                rollover="none",
                created_at=now,
                updated_at=now,
            )
            await self._budgets.add(copy)
            await self._settle(copy, [], today)
            created.append(copy)
        await self._unit_of_work.commit()
        return CopyResult(created=created, skipped=skipped)

    # The worker

    async def owners(self) -> Sequence[BudgetOwner]:
        return await self._budgets.owners()

    async def check(self, owner: BudgetOwner, today: date) -> CheckReport:
        """Close the workspace's finished periods and send alerts for thresholds crossed in the
        current ones. Called by the reminder worker with `today` in the owner's time zone; safe
        to run any number of times."""
        workspace_id = owner.workspace_id
        closed = 0
        alerts = 0
        spending = _Spending(self._spending, workspace_id)
        for budget in await self._budgets.list(workspace_id):
            if budget.state != "active":
                continue
            stored = await self._periods.for_budget(workspace_id, budget.id)
            closed_before = sum(1 for period in stored if period.closed_at is not None)
            stored = await self._settle(budget, stored, today, spending)
            closed += sum(1 for period in stored if period.closed_at is not None) - closed_before
            if not budget.alerts_enabled:
                continue
            bounds = period_containing(budget, today)
            current = next(
                (period for period in stored if bounds and period.start == bounds[0]), None
            )
            if current is None:
                continue
            alerts += await self._alert(owner, budget, current, spending)
        await self._unit_of_work.commit()
        return CheckReport(closed=closed, alerts=alerts)

    # Helpers

    async def _get(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> Budget:
        budget = await self._budgets.get(workspace_id, budget_id)
        if budget is None:
            raise BudgetNotFoundError
        return budget

    async def _view_of(self, budget: Budget, today: date) -> BudgetView:
        stored = await self._periods.for_budget(budget.workspace_id, budget.id)
        return await self._view(
            budget, stored, today, _Spending(self._spending, budget.workspace_id)
        )

    async def _view(
        self, budget: Budget, stored: list[BudgetPeriod], today: date, spending: _Spending
    ) -> BudgetView:
        timeline = await self._timeline(budget, stored, _through(budget, today), today, spending)
        return BudgetView(
            budget=budget,
            status=budget_status(budget, today),
            current=timeline[-1] if timeline else None,
        )

    async def _timeline(
        self,
        budget: Budget,
        stored: list[BudgetPeriod],
        through: date,
        today: date,
        spending: _Spending,
    ) -> list[PeriodView]:
        """Every period from the budget's start through the one containing `through`, oldest
        first, using stored periods where they exist and computing the rest. A computed period's
        rollover is what closing the one before it would carry."""
        by_start = {period.start: period for period in stored}
        result: list[PeriodView] = []
        previous: PeriodView | None = None
        for start, end in periods_through(budget, through):
            period = by_start.get(start)
            is_stored = period is not None
            if period is None:
                carried = 0
                if previous is not None and previous.period.end < today:
                    carried = rollover_amount(
                        budget.rollover,
                        previous.period.available,
                        previous.period.spent_at_close
                        if previous.period.spent_at_close is not None
                        else previous.utilization.spent,
                        budget.amount,
                    )
                period = BudgetPeriod(
                    id=uuid.uuid5(budget.id, start.isoformat()),
                    workspace_id=budget.workspace_id,
                    budget_id=budget.id,
                    start=start,
                    end=end,
                    base_amount=budget.amount,
                    rollover_amount=carried,
                    closed_at=None,
                    spent_at_close=None,
                    created_at=budget.created_at,
                )
            elif (
                previous is not None
                and previous.period.closed_at is None
                and previous.period.end < today
            ):
                # Stored before the previous period closed, so its rollover isn't written yet.
                period = replace(
                    period,
                    rollover_amount=rollover_amount(
                        budget.rollover,
                        previous.period.available,
                        previous.utilization.spent,
                        period.base_amount,
                    ),
                )
            spent = await spending.for_budget(budget, start, end)
            view = PeriodView(
                period=period,
                utilization=utilization(period.available, spent, start, end, today),
                stored=is_stored,
            )
            result.append(view)
            previous = view
        return result

    async def _settle(
        self,
        budget: Budget,
        stored: list[BudgetPeriod],
        today: date,
        spending: _Spending | None = None,
    ) -> list[BudgetPeriod]:
        """Store every period that has started (through today, or the first one of an upcoming
        budget), and close those that have ended, oldest first, carrying rollover forward.
        Returns the stored periods afterwards. Doesn't commit."""
        spending = spending or _Spending(self._spending, budget.workspace_id)
        by_start = {period.start: period for period in stored}
        for start, end in periods_through(budget, _through(budget, today)):
            period = by_start.get(start)
            if period is None:
                period = BudgetPeriod(
                    id=uuid.uuid4(),
                    workspace_id=budget.workspace_id,
                    budget_id=budget.id,
                    start=start,
                    end=end,
                    base_amount=budget.amount,
                    rollover_amount=0,
                    closed_at=None,
                    spent_at_close=None,
                    created_at=self._clock(),
                )
                await self._periods.add(period)
                by_start[start] = period
            if period.closed_at is not None or end >= today:
                continue
            spent = max(await spending.for_budget(budget, start, end), 0)
            now = self._clock()
            if not await self._periods.close(budget.workspace_id, period.id, spent, now):
                # Another worker closed it a moment ago; its rollover is written.
                continue
            by_start[start] = replace(period, closed_at=now, spent_at_close=spent)
            following = next_period(budget, end)
            if following is None:
                continue
            carried = rollover_amount(budget.rollover, period.available, spent, budget.amount)
            successor = by_start.get(following[0])
            if successor is None:
                successor = BudgetPeriod(
                    id=uuid.uuid4(),
                    workspace_id=budget.workspace_id,
                    budget_id=budget.id,
                    start=following[0],
                    end=following[1],
                    base_amount=budget.amount,
                    rollover_amount=carried,
                    closed_at=None,
                    spent_at_close=None,
                    created_at=now,
                )
                await self._periods.add(successor)
            elif successor.closed_at is None:
                successor = replace(
                    successor,
                    rollover_amount=rollover_amount(
                        budget.rollover, period.available, spent, successor.base_amount
                    ),
                )
                await self._periods.save(successor)
            by_start[following[0]] = successor
        return sorted(by_start.values(), key=lambda period: period.start)

    async def _alert(
        self, owner: BudgetOwner, budget: Budget, period: BudgetPeriod, spending: _Spending
    ) -> int:
        """Record newly crossed thresholds and notify about the highest; return 1 if a
        notification was sent."""
        spent = max(await spending.for_budget(budget, period.start, period.end), 0)
        alerted = await self._alerts.thresholds(budget.workspace_id, period.id)
        record, notify = alerts_due(budget.alert_thresholds, period.available, spent, alerted)
        if not record:
            return 0
        now = self._clock()
        notification_id: uuid.UUID | None = None
        if notify is not None:
            notification_id = uuid.uuid4()
            await self._notifications.add(
                Notification(
                    id=notification_id,
                    user_id=owner.user_id,
                    workspace_id=owner.workspace_id,
                    reminder_id=None,
                    occurrence_id=None,
                    title=_alert_title(budget, notify, period.available, spent),
                    body=_alert_body(budget, period, spent),
                    scheduled_for=now,
                    created_at=now,
                    read_at=None,
                )
            )
        for threshold in record:
            await self._alerts.add(
                BudgetAlert(
                    id=uuid.uuid4(),
                    workspace_id=budget.workspace_id,
                    period_id=period.id,
                    threshold=threshold,
                    spent=spent,
                    available=period.available,
                    notification_id=notification_id if threshold == notify else None,
                    created_at=now,
                )
            )
        return 1 if notify is not None else 0

    async def _check(self, budget: Budget) -> None:
        """Validate the budget's shape and that no other active budget covers the same spending
        in an overlapping period."""
        if budget.period == "monthly":
            if budget.start_date.day != 1:
                raise InvalidBudgetError("A monthly budget starts on the first day of a month.")
            if budget.end_date is not None and budget.end_date != month_bounds(budget.end_date)[1]:
                raise InvalidBudgetError("A monthly budget ends on the last day of a month.")
        else:
            if budget.end_date is None:
                raise InvalidBudgetError("A custom period needs an end date.")
            if (budget.end_date - budget.start_date).days + 1 > MAX_CUSTOM_DAYS:
                raise InvalidBudgetError("A custom period can be at most a year long.")
            if budget.rollover != "none":
                raise InvalidBudgetError(
                    "Only monthly budgets roll over: a custom period has no next period."
                )
        if budget.end_date is not None and budget.end_date < budget.start_date:
            raise InvalidBudgetError("The end can't be before the start.")
        if budget.scope == "category":
            if budget.category_id is None:
                raise InvalidBudgetError("Choose a category for a category budget.")
            category = await self._categories.get(budget.workspace_id, budget.category_id)
            if category is None:
                raise InvalidBudgetError("That category doesn't exist in this workspace.")
            if category.type != "expense":
                raise InvalidBudgetError("Budgets limit spending: choose an expense category.")
        if budget.state != "active":
            return
        for other in await self._budgets.list(budget.workspace_id):
            if (
                other.id != budget.id
                and other.state == "active"
                and other.currency == budget.currency
                and other.scope == budget.scope
                and other.category_id == budget.category_id
                and ranges_overlap(
                    other.start_date, other.end_date, budget.start_date, budget.end_date
                )
            ):
                raise BudgetConflictError(
                    f"“{other.name}” already covers this spending in an overlapping period. "
                    "Edit that budget, or end it before this one starts."
                )


def summarize_month(
    month: date, budgets: list[tuple[Budget, PeriodView]], spending: MonthSpending
) -> MonthSummary:
    """A month's totals. Only monthly budgets add up to the month's total: a custom period
    overlapping the month covers other days too, so it is listed but not added in."""
    monthly = [(budget, view) for budget, view in budgets if budget.period == "monthly"]
    overall = [view for budget, view in monthly if budget.scope == "overall"]
    by_category = {
        budget.category_id: view for budget, view in monthly if budget.scope == "category"
    }
    total: int | None = None
    basis: TotalBasis | None = None
    if overall:
        total, basis = overall[0].period.available, "overall"
    elif by_category:
        total = sum(view.period.available for view in by_category.values())
        basis = "categories"
    ids = set(spending.by_category) | set(by_category)
    categories = sorted(
        (
            CategoryMonth(
                category_id=category_id,
                spent=spending.by_category.get(category_id, 0),
                budget=by_category[category_id].period.available
                if category_id in by_category
                else None,
            )
            for category_id in ids
        ),
        key=lambda entry: (-entry.spent, str(entry.category_id)),
    )
    unbudgeted = (
        max(
            sum(
                net
                for category_id, net in spending.by_category.items()
                if category_id not in by_category
            ),
            0,
        )
        if by_category
        else None
    )
    return MonthSummary(
        month=month,
        budgets=budgets,
        total=total,
        basis=basis,
        spent=spending.total,
        counted=len(monthly),
        within=sum(1 for _, view in monthly if view.utilization.status != "exceeded"),
        categories=categories,
        unbudgeted=unbudgeted,
    )


def _through(budget: Budget, today: date) -> date:
    """The day whose period is a budget's "current" one: today, clamped into the budget."""
    if today < budget.start_date:
        return budget.start_date
    if budget.end_date is not None and today > budget.end_date:
        return budget.end_date
    return today


def _by_budget(periods: Iterable[BudgetPeriod]) -> dict[uuid.UUID, list[BudgetPeriod]]:
    grouped: dict[uuid.UUID, list[BudgetPeriod]] = {}
    for period in periods:
        grouped.setdefault(period.budget_id, []).append(period)
    for entries in grouped.values():
        entries.sort(key=lambda period: period.start)
    return grouped


def _thresholds(values: Iterable[int]) -> tuple[int, ...]:
    thresholds = tuple(sorted(set(values)))
    if len(thresholds) > MAX_THRESHOLDS:
        raise InvalidBudgetError(f"Choose at most {MAX_THRESHOLDS} alert thresholds.")
    if any(not 1 <= value <= MAX_THRESHOLD_PERCENT for value in thresholds):
        raise InvalidBudgetError(f"Alert thresholds are 1% to {MAX_THRESHOLD_PERCENT}%.")
    return thresholds


def _alert_title(budget: Budget, threshold: int, available: int, spent: int) -> str:
    if spent > available:
        return f"{budget.name}: budget exceeded"
    return f"{budget.name}: {threshold}% of budget used"


def _alert_body(budget: Budget, period: BudgetPeriod, spent: int) -> str:
    currency = budget.currency
    spent_text = f"{currency} {to_decimal_string(spent, currency)}"
    available_text = f"{currency} {to_decimal_string(period.available, currency)}"
    span = (
        period.start.strftime("%B %Y")
        if budget.period == "monthly"
        else f"{period.start.isoformat()} to {period.end.isoformat()}"
    )
    return f"{spent_text} of {available_text} spent ({span})."
