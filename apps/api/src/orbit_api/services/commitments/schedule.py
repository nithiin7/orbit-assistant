"""Pure date and money arithmetic for financial commitments: payment dates, EMIs, and
amortization schedules. No I/O and no floats: amounts are integer minor units, and interest is
computed with `Decimal` and rounded half up to the minor unit once per installment.

EMI assumptions, decided deliberately:

- **Reducing balance** (the default): each installment's interest is the outstanding principal
  times the periodic rate (`annual rate / installments per year`), rounded half up. The standard
  EMI is `P*r*(1+r)^n / ((1+r)^n - 1)`, rounded half up; with a zero rate it is `P / n`.
- **Flat rate**: total interest is `P * annual rate * tenure in years`, spread evenly over the
  installments; any rounding remainder goes to the last one. Principal is the EMI minus that
  interest.
- **The last installment settles exactly**: whatever principal is left is repaid in full, so
  rounding never leaves a paisa outstanding or overpaid.
- **Payment dates** keep the first date's day of the month, using the month's last day when it
  is shorter (the 31st becomes Feb 28, then Mar 31), like monthly reminders.
"""

import calendar
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Final, Literal

# How often a loan's installments fall due.
EmiFrequency = Literal["monthly", "quarterly", "half_yearly", "yearly"]
# How often a subscription renews or a bill falls due.
Frequency = Literal["weekly", "monthly", "quarterly", "half_yearly", "yearly"]
InterestMethod = Literal["reducing", "flat"]

# Months between due dates; weekly schedules step by days instead.
MONTHS_PER_PERIOD: Final[dict[Frequency, int]] = {
    "weekly": 0,
    "monthly": 1,
    "quarterly": 3,
    "half_yearly": 6,
    "yearly": 12,
}
PERIODS_PER_YEAR: Final[dict[Frequency, int]] = {
    "weekly": 52,
    "monthly": 12,
    "quarterly": 4,
    "half_yearly": 2,
    "yearly": 1,
}
# The longest schedule Orbit generates: 50 years of monthly installments.
MAX_INSTALLMENTS: Final = 600
# Interest rates are integer basis points: 8.5% a year is 850.
BASIS_POINTS: Final = 10_000


class ScheduleError(ValueError):
    """Terms that can't produce a schedule. The message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def divide_rounded(numerator: int, denominator: int) -> int:
    """`numerator / denominator` rounded half up, in integers. Both must be non-negative."""
    return (2 * numerator + denominator) // (2 * denominator)


def add_months(day: date, months: int, anchor_day: int | None = None) -> date:
    """`day` moved by `months`, on `anchor_day` (default: `day`'s own day), clamped to the end
    of shorter months."""
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(anchor_day or day.day, last))


def nth_due_date(anchor: date, frequency: Frequency, n: int) -> date:
    """The `n`-th due date (from 0) of a schedule whose first due date is `anchor`."""
    if frequency == "weekly":
        return anchor + timedelta(weeks=n)
    return add_months(anchor, n * MONTHS_PER_PERIOD[frequency], anchor.day)


def due_dates(
    anchor: date, frequency: Frequency, *, start: date | None = None, end: date | None = None
) -> Iterator[date]:
    """The schedule's due dates from `start` (default: the anchor) onward, in order, stopping
    after `end` when given. Starts near `start` rather than walking from the anchor."""
    n = 0
    if start is not None and start > anchor:
        if frequency == "weekly":
            n = (start - anchor).days // 7
        else:
            months = (start.year - anchor.year) * 12 + start.month - anchor.month
            n = max(months // MONTHS_PER_PERIOD[frequency] - 1, 0)
    while True:
        due = nth_due_date(anchor, frequency, n)
        if end is not None and due > end:
            return
        if start is None or due >= start:
            yield due
        n += 1


def installment_count(tenure_months: int, frequency: EmiFrequency) -> int:
    """How many installments a tenure has; the tenure must be whole periods."""
    months = MONTHS_PER_PERIOD[frequency]
    if tenure_months <= 0 or tenure_months % months:
        raise ScheduleError(f"The tenure must be a whole number of {_period_name(frequency)}.")
    count = tenure_months // months
    if count > MAX_INSTALLMENTS:
        raise ScheduleError(f"A loan can have at most {MAX_INSTALLMENTS} installments.")
    return count


def _period_name(frequency: EmiFrequency) -> str:
    return {
        "monthly": "months",
        "quarterly": "quarters (3 months)",
        "half_yearly": "half-years (6 months)",
        "yearly": "years (12 months)",
    }[frequency]


def periodic_rate(rate_bps: int, frequency: EmiFrequency) -> Decimal:
    """The interest rate per installment period as an exact fraction."""
    return Decimal(rate_bps) / Decimal(BASIS_POINTS * PERIODS_PER_YEAR[frequency])


def standard_emi(
    principal: int,
    rate_bps: int,
    frequency: EmiFrequency,
    count: int,
    method: InterestMethod,
    tenure_months: int,
) -> int:
    """The installment a lender would quote for these terms, in minor units."""
    if method == "flat":
        return divide_rounded(
            principal + flat_interest_total(principal, rate_bps, tenure_months), count
        )
    if rate_bps == 0:
        return divide_rounded(principal, count)
    with localcontext() as context:
        # 60 significant digits keep (1 + r)^600 exact far beyond the paisa.
        context.prec = 60
        rate = periodic_rate(rate_bps, frequency)
        growth = (1 + rate) ** count
        return _round(Decimal(principal) * rate * growth / (growth - 1))


def flat_interest_total(principal: int, rate_bps: int, tenure_months: int) -> int:
    """Total interest on a flat-rate loan: principal * annual rate * years, rounded half up."""
    return divide_rounded(principal * rate_bps * tenure_months, BASIS_POINTS * 12)


@dataclass(frozen=True, slots=True)
class PlannedInstallment:
    sequence: int
    due_date: date
    principal: int
    interest: int
    # The principal still owed once this installment is paid.
    balance_after: int

    @property
    def amount(self) -> int:
        return self.principal + self.interest


@dataclass(frozen=True, slots=True)
class LoanTerms:
    """What an amortization schedule is built from."""

    # The principal still owed when the schedule starts.
    outstanding: int
    rate_bps: int
    method: InterestMethod
    frequency: EmiFrequency
    emi: int
    first_due: date
    # Installments to generate.
    count: int
    # Flat rate only: the interest charged per installment over the whole original loan, from
    # which this schedule takes its last `count`.
    flat_interest: tuple[int, ...] = ()
    first_sequence: int = 1


def flat_interest_split(total: int, count: int) -> tuple[int, ...]:
    """Flat interest spread evenly over `count` installments; the remainder goes last."""
    base = total // count
    return (base,) * (count - 1) + (total - base * (count - 1),)


def amortize(terms: LoanTerms) -> list[PlannedInstallment]:
    """The installments that repay `terms.outstanding`. The last one settles whatever is left.

    Raises `ScheduleError` when the EMI doesn't cover a reducing-balance installment's interest,
    since the loan would never be repaid.
    """
    if terms.count < 1:
        raise ScheduleError("A schedule needs at least one installment.")
    rate = periodic_rate(terms.rate_bps, terms.frequency)
    flat = terms.flat_interest[-terms.count :] if terms.method == "flat" else ()
    balance = terms.outstanding
    planned: list[PlannedInstallment] = []
    for index in range(terms.count):
        last = index == terms.count - 1
        if terms.method == "flat":
            interest = flat[index] if index < len(flat) else 0
        else:
            with localcontext() as context:
                context.prec = 60
                interest = _round(Decimal(balance) * rate)
        if last:
            principal = balance
        else:
            if terms.emi <= interest and balance > 0:
                raise ScheduleError(
                    "The EMI doesn't cover the interest, so the loan would never be repaid. "
                    "Enter a larger EMI."
                )
            principal = min(max(terms.emi - interest, 0), balance)
        balance -= principal
        planned.append(
            PlannedInstallment(
                sequence=terms.first_sequence + index,
                due_date=nth_due_date(terms.first_due, terms.frequency, index),
                principal=principal,
                interest=interest,
                balance_after=balance,
            )
        )
        if balance == 0 and terms.method == "reducing" and not last:
            # Repaid early (a generous EMI): no further installments.
            break
    return planned


def installments_until_repaid(
    outstanding: int, rate_bps: int, frequency: EmiFrequency, emi: int
) -> int:
    """How many reducing-balance installments of `emi` repay `outstanding`, the last one
    possibly smaller. Raises `ScheduleError` if it never would within `MAX_INSTALLMENTS`."""
    rate = periodic_rate(rate_bps, frequency)
    balance = outstanding
    for count in range(1, MAX_INSTALLMENTS + 1):
        with localcontext() as context:
            context.prec = 60
            interest = _round(Decimal(balance) * rate)
        if balance + interest <= emi:
            return count
        if emi <= interest:
            break
        balance -= emi - interest
    raise ScheduleError("That EMI wouldn't repay the loan within 50 years. Enter a larger EMI.")


def monthly_equivalent(amount: int, frequency: Frequency) -> int:
    """What a recurring amount costs per month on average, rounded half up. Weekly amounts
    recur 52 times a year."""
    return divide_rounded(amount * PERIODS_PER_YEAR[frequency], 12)


def annual_equivalent(amount: int, frequency: Frequency) -> int:
    return amount * PERIODS_PER_YEAR[frequency]
