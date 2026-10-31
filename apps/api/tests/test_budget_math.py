"""Budget arithmetic: periods, utilization, projections, rollover, and alert thresholds."""

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime
from typing import Any

import pytest

from orbit_api.services.budgets.calculation import (
    MAX_ROLLOVER,
    alerts_due,
    budget_status,
    crossed,
    next_period,
    period_containing,
    periods_through,
    projected_spending,
    ranges_overlap,
    rollover_amount,
    utilization,
    utilization_bps,
    utilization_status,
)
from orbit_api.services.budgets.models import Budget, RolloverMode

NOW = datetime(2026, 1, 1, tzinfo=UTC)


def budget(**fields: Any) -> Budget:
    base = Budget(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        name="Groceries",
        scope="overall",
        category_id=None,
        currency="INR",
        amount=10_000_00,
        period="monthly",
        start_date=date(2026, 1, 1),
        end_date=None,
        rollover="none",
        alerts_enabled=True,
        alert_thresholds=(50, 75, 90, 100),
        state="active",
        notes="",
        archived_at=None,
        created_at=NOW,
        updated_at=NOW,
    )
    return replace(base, **fields)


def test_monthly_periods_are_calendar_months_including_leap_february() -> None:
    monthly = budget(start_date=date(2028, 1, 1))
    assert period_containing(monthly, date(2028, 2, 14)) == (date(2028, 2, 1), date(2028, 2, 29))
    assert periods_through(monthly, date(2028, 3, 1)) == [
        (date(2028, 1, 1), date(2028, 1, 31)),
        (date(2028, 2, 1), date(2028, 2, 29)),
        (date(2028, 3, 1), date(2028, 3, 31)),
    ]
    assert period_containing(monthly, date(2027, 12, 31)) is None
    assert periods_through(monthly, date(2027, 12, 31)) == []


def test_month_boundaries_are_inclusive_dates() -> None:
    monthly = budget()
    assert period_containing(monthly, date(2026, 1, 31)) == (date(2026, 1, 1), date(2026, 1, 31))
    assert period_containing(monthly, date(2026, 2, 1)) == (date(2026, 2, 1), date(2026, 2, 28))


def test_ending_and_custom_budgets() -> None:
    ending = budget(end_date=date(2026, 2, 28))
    assert periods_through(ending, date(2026, 6, 1)) == [
        (date(2026, 1, 1), date(2026, 1, 31)),
        (date(2026, 2, 1), date(2026, 2, 28)),
    ]
    assert next_period(ending, date(2026, 1, 31)) == (date(2026, 2, 1), date(2026, 2, 28))
    assert next_period(ending, date(2026, 2, 28)) is None
    assert not budget(end_date=date(2026, 1, 31)).recurring
    assert budget().recurring and ending.recurring

    trip = budget(period="custom", start_date=date(2026, 3, 10), end_date=date(2026, 3, 24))
    assert period_containing(trip, date(2026, 3, 15)) == (date(2026, 3, 10), date(2026, 3, 24))
    assert periods_through(trip, date(2026, 12, 1)) == [(date(2026, 3, 10), date(2026, 3, 24))]
    assert next_period(trip, date(2026, 3, 24)) is None


def test_status_from_dates_and_state() -> None:
    ending = budget(start_date=date(2026, 2, 1), end_date=date(2026, 2, 28))
    assert budget_status(ending, date(2026, 1, 31)) == "upcoming"
    assert budget_status(ending, date(2026, 2, 28)) == "active"
    assert budget_status(ending, date(2026, 3, 1)) == "completed"
    assert budget_status(replace(ending, state="archived"), date(2026, 2, 5)) == "archived"


@pytest.mark.parametrize(
    ("first", "second", "overlaps"),
    [
        ((date(2026, 1, 1), date(2026, 1, 31)), (date(2026, 2, 1), None), False),
        ((date(2026, 1, 1), date(2026, 1, 31)), (date(2026, 1, 31), None), True),
        ((date(2026, 1, 1), None), (date(2030, 5, 1), date(2030, 5, 31)), True),
        ((date(2026, 3, 1), None), (date(2026, 1, 1), date(2026, 2, 28)), False),
    ],
)
def test_ranges_overlap(
    first: tuple[date, date | None], second: tuple[date, date | None], overlaps: bool
) -> None:
    assert ranges_overlap(*first, *second) is overlaps
    assert ranges_overlap(*second, *first) is overlaps


@pytest.mark.parametrize(
    ("spent", "status"),
    [
        (0, "on_track"),
        (7_499_99, "on_track"),
        (7_500_00, "approaching"),
        (8_999_99, "approaching"),
        (9_000_00, "near"),
        (10_000_00, "near"),
        (10_000_01, "exceeded"),
    ],
)
def test_utilization_status_bands_are_exact_at_the_boundaries(spent: int, status: str) -> None:
    assert utilization_status(10_000_00, spent) == status


def test_utilization_percent_is_integer_and_rounds_down() -> None:
    # 1/3 is 33.33%, never 33.333…; nothing available has no percentage.
    assert utilization_bps(3_00, 1_00) == 3333
    assert utilization_bps(10_000_00, 12_345_67) == 12345
    assert utilization_bps(0, 5_00) is None
    assert utilization_status(0, 0) == "on_track"
    assert utilization_status(0, 1) == "exceeded"


def test_refunds_exceeding_spending_count_as_nothing_spent() -> None:
    usage = utilization(
        10_000_00, -2_000_00, date(2026, 1, 1), date(2026, 1, 31), date(2026, 1, 10)
    )
    assert usage.spent == 0
    assert usage.remaining == 10_000_00


def test_projection_needs_a_week_and_rounds_half_up() -> None:
    start, end = date(2026, 1, 1), date(2026, 1, 31)
    assert projected_spending(1_000_00, start, end, date(2026, 1, 6)) is None
    # 7 of 31 days: 1,000 x 31 ÷ 7 = 4,428.571… → 4,428.57
    assert projected_spending(1_000_00, start, end, date(2026, 1, 7)) == 4_428_57
    # Half a paisa rounds up: 1 x 3 ÷ 2 = 1.5 → 2.
    assert projected_spending(1, date(2026, 1, 1), date(2026, 1, 21), date(2026, 1, 14)) == 2
    assert projected_spending(5_00, start, end, date(2026, 2, 3)) == 5_00
    assert projected_spending(5_00, start, end, date(2025, 12, 31)) is None


@pytest.mark.parametrize(
    ("mode", "available", "spent", "next_base", "carried"),
    [
        ("none", 10_000_00, 8_000_00, 10_000_00, 0),
        ("surplus", 10_000_00, 8_000_00, 10_000_00, 2_000_00),
        ("surplus", 10_000_00, 12_000_00, 10_000_00, 0),
        ("full", 10_000_00, 8_000_00, 10_000_00, 2_000_00),
        ("full", 10_000_00, 12_000_00, 10_000_00, -2_000_00),
        # A deficit larger than the next month's budget empties it, no more.
        ("full", 10_000_00, 35_000_00, 10_000_00, -10_000_00),
    ],
)
def test_rollover_rules(
    mode: RolloverMode, available: int, spent: int, next_base: int, carried: int
) -> None:
    assert rollover_amount(mode, available, spent, next_base) == carried


def test_rollover_is_capped() -> None:
    assert rollover_amount("surplus", MAX_ROLLOVER + 5, 0, 1) == MAX_ROLLOVER


def test_thresholds_cross_by_exact_integer_comparison() -> None:
    thresholds = (50, 75, 90, 100)
    assert crossed(thresholds, 10_000_00, 4_999_99) == []
    assert crossed(thresholds, 10_000_00, 5_000_00) == [50]
    assert crossed(thresholds, 10_000_00, 10_000_00) == [50, 75, 90, 100]
    assert crossed((120,), 10_000_00, 12_000_00) == [120]
    assert crossed(thresholds, 0, 1) == [50, 75, 90, 100]
    assert crossed(thresholds, 0, 0) == []


def test_only_the_highest_new_threshold_notifies() -> None:
    record, notify = alerts_due((50, 75, 90, 100), 10_000_00, 9_500_00, set())
    assert record == [50, 75, 90]
    assert notify == 90


def test_thresholds_already_recorded_never_alert_again() -> None:
    assert alerts_due((50, 75, 90, 100), 10_000_00, 9_500_00, {50, 75, 90}) == ([], None)
    # Spending falls below 50% after a refund and rises again: still nothing new until 100%.
    assert alerts_due((50, 75, 90, 100), 10_000_00, 6_000_00, {50, 75, 90}) == ([], None)
    assert alerts_due((50, 75, 90, 100), 10_000_00, 10_000_00, {50, 75, 90}) == ([100], 100)


def test_a_lower_threshold_added_later_is_recorded_silently() -> None:
    record, notify = alerts_due((60, 90), 10_000_00, 9_500_00, {90})
    assert record == [60]
    assert notify is None
