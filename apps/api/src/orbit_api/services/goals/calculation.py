"""Savings goal arithmetic: progress and the suggested monthly contribution.

Pure integer functions, unit-tested in `tests/test_goal_math.py`.
"""

from collections.abc import Iterable
from datetime import date

from orbit_api.services.goals.models import Contribution, Progress


def months_left(today: date, target: date) -> int:
    """Calendar months from today's through the target's, inclusive: 1 when the target is this
    month, 0 once its month has passed."""
    months = (target.year - today.year) * 12 + target.month - today.month + 1
    return max(months, 0)


def suggested_monthly(remaining: int, months: int) -> int:
    """What to save each month to cover `remaining` in `months`, rounded up to the minor unit so
    the total is never short. Everything is due now when no months are left."""
    if remaining <= 0:
        return 0
    if months <= 0:
        return remaining
    return -(-remaining // months)


def saved(contributions: Iterable[Contribution]) -> int:
    return sum(
        entry.amount if entry.type == "contribution" else -entry.amount for entry in contributions
    )


def progress(
    target_amount: int,
    target_date: date | None,
    contributions: list[Contribution],
    today: date,
) -> Progress:
    total = saved(contributions)
    remaining = max(target_amount - total, 0)
    months = months_left(today, target_date) if target_date is not None else None
    this_month = saved(
        entry
        for entry in contributions
        if (entry.occurred_on.year, entry.occurred_on.month) == (today.year, today.month)
    )
    return Progress(
        saved=total,
        remaining=remaining,
        progress_bps=min(max(total, 0) * 10_000 // target_amount, 10_000),
        reached=total >= target_amount,
        suggested_monthly=suggested_monthly(remaining, months) if months is not None else None,
        months_left=months,
        this_month=this_month,
    )
