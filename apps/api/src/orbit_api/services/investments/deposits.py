"""Fixed and recurring deposit arithmetic: estimated value on a date and projected maturity. Pure;
`Decimal` with 60 significant digits, rounded half up to the minor unit once per contribution.

These are **estimates** built on stated assumptions, never guarantees. Banks differ in day
counts, compounding of broken periods, and tax deducted at source, so the bank's own maturity
amount (when the user enters it) is shown beside the estimate rather than replaced by it.

Assumptions:

- Interest compounds every whole period (month, quarter, half year, or year) counted in
  calendar months from the contribution date, keeping the day of the month (the 31st steps to
  the end of shorter months).
- The broken period after the last whole one earns simple interest on the compounded amount:
  `rate * days / 365`.
- `simple` deposits earn simple interest on the contribution: `rate * days / 365`.
- Nothing accrues after the maturity date or before the contribution date.
- A recurring deposit's projection assumes one installment on the start date's day of every
  month before maturity, each paid on time.
"""

from collections.abc import Iterable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Final, Literal

from orbit_api.services.commitments.schedule import BASIS_POINTS, add_months

Compounding = Literal["monthly", "quarterly", "half_yearly", "yearly", "simple"]
MONTHS_PER_COMPOUNDING: Final[dict[Compounding, int]] = {
    "monthly": 1,
    "quarterly": 3,
    "half_yearly": 6,
    "yearly": 12,
    "simple": 0,
}
DAYS_PER_YEAR: Final = 365


def _whole_periods(start: date, end: date, months: int) -> tuple[int, date]:
    """How many whole periods of `months` fit between the dates, and where the last one ends."""
    elapsed = (end.year - start.year) * 12 + end.month - start.month
    count = max(elapsed // months, 0)
    while count > 0 and add_months(start, count * months, start.day) > end:
        count -= 1
    return count, add_months(start, count * months, start.day)


def accrued(amount: int, rate_bps: int, compounding: Compounding, start: date, end: date) -> int:
    """What `amount` deposited on `start` is estimated to be worth on `end`."""
    if end <= start or rate_bps == 0:
        return amount
    with localcontext() as context:
        context.prec = 60
        rate = Decimal(rate_bps) / BASIS_POINTS
        months = MONTHS_PER_COMPOUNDING[compounding]
        if months == 0:
            value = Decimal(amount) * (1 + rate * (end - start).days / DAYS_PER_YEAR)
        else:
            periods, last = _whole_periods(start, end, months)
            per_period = rate * months / 12
            value = (
                Decimal(amount)
                * (1 + per_period) ** periods
                * (1 + rate * (end - last).days / DAYS_PER_YEAR)
            )
        return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def estimated_value(
    contributions: Iterable[tuple[date, int]],
    rate_bps: int,
    compounding: Compounding,
    as_of: date,
    maturity: date,
) -> int:
    """The estimated value on `as_of` of the contributions made on or before it, accruing until
    maturity at the latest."""
    end = min(as_of, maturity)
    return sum(
        accrued(amount, rate_bps, compounding, day, end)
        for day, amount in contributions
        if day <= as_of
    )


def recurring_installments(start: date, maturity: date, installment: int) -> list[tuple[date, int]]:
    """A recurring deposit's assumed installments: one a month from `start`, before maturity."""
    dates: list[tuple[date, int]] = []
    n = 0
    while (due := add_months(start, n, start.day)) < maturity:
        dates.append((due, installment))
        n += 1
    return dates
