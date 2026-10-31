"""Budget types: spending limits per period, their stored periods, and threshold alerts.

A **budget** is what the user edits: a limit on net spending (expenses minus refunds) in one
currency, overall or for one expense category, either every calendar month (`monthly`, optionally
until an end month) or over one custom date range (`custom`).

A **period** is one occurrence of a budget: a calendar month of a monthly budget, or a custom
budget's whole range. Periods are stored so that history keeps the amount it had: editing a
budget changes its current and future periods, never past ones. A period records its `base_amount`
(the budget's amount at the time) and its `rollover_amount` (carried from the previous period)
separately. Once a period has ended it is **closed**: its spending at that moment is stored and its
rollover into the next period is written, once.

Amounts are integers in the currency's minor unit.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Final, Literal

from orbit_api.services.finance.money import Currency
from orbit_api.utils.changes import UNSET, Change

BudgetScope = Literal["overall", "category"]
BudgetPeriodType = Literal["monthly", "custom"]
# What happens to a monthly period's leftover when it closes:
# - `none`: nothing; the next month starts with its own amount.
# - `surplus`: money left unspent is added to the next month; overspending carries nothing.
# - `full`: the leftover carries either way, so overspending reduces the next month, but never
#   below zero.
RolloverMode = Literal["none", "surplus", "full"]
BudgetState = Literal["active", "archived"]
# `upcoming` (starts after today) and `completed` (ended before today) are derived from the
# dates of an active budget; `archived` is stored.
BudgetStatus = Literal["upcoming", "active", "completed", "archived"]
# How much of a period's budget is used: under 75%, from 75%, from 90%, or more than all of it.
UtilizationStatus = Literal["on_track", "approaching", "near", "exceeded"]

DEFAULT_THRESHOLDS: Final[tuple[int, ...]] = (50, 75, 90, 100)
MAX_THRESHOLDS: Final = 6
# Thresholds are whole percentages; above 100 alerts on overspending by that much.
MAX_THRESHOLD_PERCENT: Final = 200


@dataclass(frozen=True, slots=True)
class Budget:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    scope: BudgetScope
    # Set exactly for `category` budgets: the expense category whose net spending counts.
    category_id: uuid.UUID | None
    currency: Currency
    # The base amount of each period from now on, in minor units.
    amount: int
    period: BudgetPeriodType
    # Monthly budgets start on the first of a month and end (if ever) on the last day of one.
    start_date: date
    # `None` only for a monthly budget that repeats every month without end.
    end_date: date | None
    rollover: RolloverMode
    alerts_enabled: bool
    # Whole percentages, ascending, without duplicates.
    alert_thresholds: tuple[int, ...]
    state: BudgetState
    notes: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @property
    def recurring(self) -> bool:
        return self.period == "monthly" and (
            self.end_date is None
            or (self.end_date.year, self.end_date.month)
            != (self.start_date.year, self.start_date.month)
        )


@dataclass(frozen=True, slots=True)
class BudgetPeriod:
    id: uuid.UUID
    workspace_id: uuid.UUID
    budget_id: uuid.UUID
    start: date
    end: date
    # The budget's amount for this period, fixed once the period has started.
    base_amount: int
    # Carried from the previous period when it closed: positive (unspent money) or negative
    # (overspending, with `full` rollover). Zero without rollover.
    rollover_amount: int
    # Set together when the period closes, once.
    closed_at: datetime | None
    spent_at_close: int | None
    created_at: datetime

    @property
    def available(self) -> int:
        """What can be spent in the period. Never negative: a deficit carried from an earlier
        month empties the budget rather than going below zero."""
        return max(self.base_amount + self.rollover_amount, 0)


@dataclass(frozen=True, slots=True)
class Utilization:
    """How a period's budget is being used, computed from the ledger when read."""

    available: int
    # Net spending (expenses minus refunds) in the period, never below zero.
    spent: int
    # `available - spent`: negative when overspent.
    remaining: int
    # Hundredths of a percent of `available` spent: 8750 is 87.5%. `None` when nothing is
    # available, since no percentage of zero means anything.
    utilization_bps: int | None
    status: UtilizationStatus
    # Linear projection of spending to the period's end, for the current period once enough of
    # it has passed; the actual spending for a finished one; `None` otherwise.
    projected: int | None


@dataclass(frozen=True, slots=True)
class PeriodView:
    period: BudgetPeriod
    utilization: Utilization
    # Whether the period is stored. A period that has started but hasn't been stored yet (the
    # worker hasn't reached it) is computed from the budget as it is now, which is what storing
    # it would record.
    stored: bool


@dataclass(frozen=True, slots=True)
class BudgetView:
    budget: Budget
    status: BudgetStatus
    # The period containing `today`; for a budget that has ended or not started, its last or
    # first period. `None` only if the budget has no period at all (it can't happen).
    current: PeriodView | None


@dataclass(frozen=True, slots=True)
class BudgetDetail:
    view: BudgetView
    # Every period from the budget's start through the current one, newest first.
    periods: list[PeriodView]
    # Of the closed periods, how many stayed within their budget.
    periods_within: int
    periods_closed: int


# What a month's total budget is: its overall monthly budget, else the sum of its monthly category
# budgets.
TotalBasis = Literal["overall", "categories"]


@dataclass(frozen=True, slots=True)
class CategoryMonth:
    # `None` for uncategorized spending.
    category_id: uuid.UUID | None
    # Net spending; negative when refunds of earlier purchases exceed it.
    spent: int
    # The category budget's available amount for the month, if it has one.
    budget: int | None


@dataclass(frozen=True, slots=True)
class MonthSummary:
    """One calendar month of budgets in one currency."""

    month: date
    # The budgets covering the month, each with its period that overlaps it.
    budgets: list[tuple[Budget, PeriodView]]
    total: int | None
    basis: TotalBasis | None
    # The month's net spending, never below zero: the dashboard's spending figure.
    spent: int
    # Monthly budgets counted, and how many of them were not exceeded.
    counted: int
    within: int
    # Every category with spending or a budget, largest spending first.
    categories: list[CategoryMonth]
    # Spending in categories without a category budget, when any category has one.
    unbudgeted: int | None


@dataclass(frozen=True, slots=True)
class BudgetDraft:
    name: str
    scope: BudgetScope
    currency: Currency
    amount: int
    period: BudgetPeriodType
    start_date: date
    end_date: date | None
    category_id: uuid.UUID | None = None
    rollover: RolloverMode = "none"
    alerts_enabled: bool = True
    alert_thresholds: tuple[int, ...] = DEFAULT_THRESHOLDS
    notes: str = ""


@dataclass(frozen=True, slots=True)
class BudgetChanges:
    """A partial update. Scope, category, currency, and period type are fixed; a budget for
    something else is a new budget."""

    name: Change[str] = UNSET
    amount: Change[int] = UNSET
    start_date: Change[date] = UNSET
    end_date: Change[date | None] = UNSET
    rollover: Change[RolloverMode] = UNSET
    alerts_enabled: Change[bool] = UNSET
    alert_thresholds: Change[tuple[int, ...]] = UNSET
    notes: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class BudgetAlert:
    """A threshold that has been crossed in one period. One row per period and threshold makes
    an alert impossible to send twice."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    period_id: uuid.UUID
    threshold: int
    # What had been spent, and was available, when the threshold was first crossed.
    spent: int
    available: int
    # The notification sent; `None` for thresholds recorded without one (a lower threshold
    # crossed at the same moment as a higher one, or one added after a higher one fired).
    notification_id: uuid.UUID | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class CopyResult:
    created: list[Budget]
    # Budgets of the source month that weren't copied, because the target month is already
    # covered (a recurring budget, or a budget added there already).
    skipped: list[Budget]


@dataclass(frozen=True, slots=True)
class BudgetOwner:
    """A workspace with budgets, as the worker sees it: who gets alerts, and their time zone."""

    workspace_id: uuid.UUID
    user_id: uuid.UUID
    timezone: str | None


class BudgetNotFoundError(Exception):
    """The budget does not exist in this workspace."""


class InvalidBudgetError(Exception):
    """The request breaks a rule. The message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class BudgetConflictError(Exception):
    """Another active budget already covers the same spending in an overlapping period. The
    message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
