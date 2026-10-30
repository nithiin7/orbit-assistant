"""Budget arithmetic: periods, utilization, projections, rollover, and alert thresholds.

Pure functions on integers and dates, unit-tested in `tests/test_budget_math.py`. Money is in
minor units and percentages are compared by cross-multiplying, so no division (and no float)
decides whether a threshold has been crossed.
"""

from collections.abc import Iterable
from datetime import date
from typing import Final

from orbit_api.services.budgets.models import (
    Budget,
    BudgetStatus,
    RolloverMode,
    Utilization,
    UtilizationStatus,
)
from orbit_api.services.finance.money import add_months, month_bounds

# A projection needs this many days of the period behind it; earlier, one large purchase on the
# first day would project absurd totals.
MIN_PROJECTION_DAYS: Final = 7
# Where the statuses begin, in percent of what is available.
APPROACHING_PERCENT: Final = 75
NEAR_PERCENT: Final = 90
BPS_PER_UNIT: Final = 10_000
# Unspent money carried month after month is capped far below the 64-bit range (mirrored by a
# CHECK on `finance_budget_periods`).
MAX_ROLLOVER: Final = 10**15


def period_containing(budget: Budget, day: date) -> tuple[date, date] | None:
    """The budget's period that includes `day`, or `None` if `day` is outside the budget."""
    if day < budget.start_date or (budget.end_date is not None and day > budget.end_date):
        return None
    if budget.period == "custom":
        # A custom budget always has an end date (the service and a CHECK guarantee it).
        assert budget.end_date is not None
        return budget.start_date, budget.end_date
    return month_bounds(day)


def periods_through(budget: Budget, day: date) -> list[tuple[date, date]]:
    """Every period from the budget's start through the one containing `day` (or through its
    last period, if `day` is after it), oldest first. Empty if `day` is before the start."""
    if day < budget.start_date:
        return []
    last = day if budget.end_date is None else min(day, budget.end_date)
    if budget.period == "custom":
        assert budget.end_date is not None
        return [(budget.start_date, budget.end_date)]
    result: list[tuple[date, date]] = []
    month = budget.start_date.replace(day=1)
    while month <= last:
        result.append(month_bounds(month))
        month = add_months(month, 1)
    return result


def next_period(budget: Budget, period_end: date) -> tuple[date, date] | None:
    """The period after the one ending on `period_end`, if the budget has one."""
    if budget.period == "custom":
        return None
    start = add_months(period_end.replace(day=1), 1)
    if budget.end_date is not None and start > budget.end_date:
        return None
    return month_bounds(start)


def budget_status(budget: Budget, today: date) -> BudgetStatus:
    if budget.state == "archived":
        return "archived"
    if today < budget.start_date:
        return "upcoming"
    if budget.end_date is not None and today > budget.end_date:
        return "completed"
    return "active"


def ranges_overlap(
    first_start: date, first_end: date | None, second_start: date, second_end: date | None
) -> bool:
    """Whether two inclusive date ranges share a day; `None` is an open end."""
    first_ends_before = first_end is not None and first_end < second_start
    second_ends_before = second_end is not None and second_end < first_start
    return not (first_ends_before or second_ends_before)


def utilization_bps(available: int, spent: int) -> int | None:
    """Spending as hundredths of a percent of what is available, rounded down."""
    if available <= 0:
        return None
    return spent * BPS_PER_UNIT // available


def utilization_status(available: int, spent: int) -> UtilizationStatus:
    if spent > available:
        return "exceeded"
    if available <= 0:
        return "on_track"
    if spent * 100 >= NEAR_PERCENT * available:
        return "near"
    if spent * 100 >= APPROACHING_PERCENT * available:
        return "approaching"
    return "on_track"


def projected_spending(spent: int, start: date, end: date, today: date) -> int | None:
    """Spending at the period's end if it continues at its average daily pace so far, rounded
    half up: the actual spending once the period is over, `None` before it starts or while too
    little of it has passed."""
    if today < start:
        return None
    if today > end:
        return spent
    elapsed = (today - start).days + 1
    if elapsed < MIN_PROJECTION_DAYS:
        return None
    total = (end - start).days + 1
    return (2 * spent * total + elapsed) // (2 * elapsed)


def utilization(
    available: int, net_spending: int, start: date, end: date, today: date
) -> Utilization:
    """A period's figures. Net spending below zero (refunds of earlier purchases exceeding this
    period's spending) counts as nothing spent."""
    spent = max(net_spending, 0)
    return Utilization(
        available=available,
        spent=spent,
        remaining=available - spent,
        utilization_bps=utilization_bps(available, spent),
        status=utilization_status(available, spent),
        projected=projected_spending(spent, start, end, today),
    )


def rollover_amount(mode: RolloverMode, available: int, spent: int, next_base: int) -> int:
    """What a closing period carries into the next one.

    `surplus` carries only money left unspent. `full` also carries overspending as a negative
    amount, capped at the next period's base amount, so the next period starts at zero at worst
    and a deficit is never carried twice.
    """
    leftover = available - spent
    match mode:
        case "none":
            return 0
        case "surplus":
            return min(max(leftover, 0), MAX_ROLLOVER)
        case "full":
            return min(max(leftover, -next_base), MAX_ROLLOVER)


def crossed(thresholds: Iterable[int], available: int, spent: int) -> list[int]:
    """The thresholds (whole percentages) that `spent` has reached, ascending. With nothing
    available, any spending crosses every threshold."""
    if available <= 0:
        return sorted(thresholds) if spent > 0 else []
    return sorted(threshold for threshold in thresholds if spent * 100 >= threshold * available)


def alerts_due(
    thresholds: Iterable[int], available: int, spent: int, alerted: set[int]
) -> tuple[list[int], int | None]:
    """Thresholds to record now, and the one (if any) to notify about.

    Each threshold is recorded once per period, so spending that falls back (a refund, a larger
    budget) and rises again never alerts twice. Of several thresholds crossed at once, only the
    highest notifies. A threshold below one already notified (added to the budget later) is
    recorded silently: announcing "50% used" after "90% used" would mislead.
    """
    new = [
        threshold for threshold in crossed(thresholds, available, spent) if threshold not in alerted
    ]
    if not new:
        return [], None
    highest = new[-1]
    if alerted and highest < max(alerted):
        return new, None
    return new, highest


def normalize_thresholds(thresholds: Iterable[int]) -> tuple[int, ...]:
    return tuple(sorted(set(thresholds)))
