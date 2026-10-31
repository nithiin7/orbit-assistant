"""Savings goal arithmetic: progress and suggested monthly contributions."""

import uuid
from datetime import UTC, date, datetime

import pytest

from orbit_api.services.goals.calculation import months_left, progress, suggested_monthly
from orbit_api.services.goals.models import Contribution, ContributionType

GOAL = uuid.uuid4()


def entry(amount: int, on: date, kind: ContributionType = "contribution") -> Contribution:
    return Contribution(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        goal_id=GOAL,
        type=kind,
        amount=amount,
        occurred_on=on,
        transaction_id=None,
        notes="",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


@pytest.mark.parametrize(
    ("today", "target", "months"),
    [
        (date(2026, 1, 15), date(2026, 1, 31), 1),
        (date(2026, 1, 31), date(2026, 2, 1), 2),
        (date(2026, 1, 15), date(2026, 12, 1), 12),
        (date(2026, 3, 1), date(2026, 2, 28), 0),
    ],
)
def test_months_left_counts_calendar_months(today: date, target: date, months: int) -> None:
    assert months_left(today, target) == months


def test_suggested_monthly_rounds_up_so_the_target_is_never_missed() -> None:
    # ₹1,000.00 over 3 months is 333.333… → 333.34; 3 x 333.34 ≥ 1,000.
    assert suggested_monthly(1_000_00, 3) == 333_34
    assert suggested_monthly(900_00, 3) == 300_00
    assert suggested_monthly(0, 3) == 0
    # The target date has passed: everything remaining is due now.
    assert suggested_monthly(500_00, 0) == 500_00


def test_progress_counts_contributions_less_withdrawals() -> None:
    entries = [
        entry(30_000_00, date(2026, 1, 5)),
        entry(20_000_00, date(2026, 2, 5)),
        entry(5_000_00, date(2026, 2, 20), "withdrawal"),
    ]
    result = progress(1_00_000_00, date(2026, 12, 31), entries, date(2026, 2, 25))
    assert result.saved == 45_000_00
    assert result.remaining == 55_000_00
    assert result.progress_bps == 4500
    assert not result.reached
    # February through December: 11 months.
    assert result.months_left == 11
    assert result.suggested_monthly == 5_000_00
    assert result.this_month == 15_000_00


def test_progress_caps_at_one_hundred_percent() -> None:
    result = progress(10_000_00, None, [entry(12_000_00, date(2026, 1, 5))], date(2026, 1, 6))
    assert result.progress_bps == 10_000
    assert result.reached
    assert result.remaining == 0
    assert result.suggested_monthly is None
    assert result.months_left is None


def test_progress_percent_rounds_down_in_integers() -> None:
    result = progress(3_00, None, [entry(1_00, date(2026, 1, 5))], date(2026, 1, 6))
    assert result.progress_bps == 3333
