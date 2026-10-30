"""EMI and recurrence arithmetic: pure functions, exact integers, deliberate rounding."""

from datetime import date
from decimal import Decimal
from itertools import pairwise

import pytest

from orbit_api.services.commitments.schedule import (
    Frequency,
    LoanTerms,
    ScheduleError,
    add_months,
    amortize,
    annual_equivalent,
    divide_rounded,
    due_dates,
    flat_interest_split,
    flat_interest_total,
    installment_count,
    installments_until_repaid,
    monthly_equivalent,
    standard_emi,
)

LAKH = 100_000_00  # ₹1,00,000 in paise


def test_rounding_is_half_up_in_integers() -> None:
    assert divide_rounded(5, 2) == 3
    assert divide_rounded(7, 2) == 4
    assert divide_rounded(4, 3) == 1
    assert divide_rounded(5, 3) == 2
    assert divide_rounded(0, 7) == 0


def test_standard_reducing_emi_matches_the_textbook_formula() -> None:
    # ₹10,00,000 at 8.5% for 20 years: lenders quote ₹8,678.23.
    emi = standard_emi(10 * LAKH, 850, "monthly", 240, "reducing", 240)
    assert emi == 867_823
    # The formula computed independently with Decimal, rounded half up.
    r = Decimal(850) / Decimal(120_000)
    growth = (1 + r) ** 240
    expected = Decimal(10 * LAKH) * r * growth / (growth - 1)
    assert emi == int(expected.quantize(Decimal(1), rounding="ROUND_HALF_UP"))


def test_zero_interest_emi_divides_the_principal() -> None:
    assert standard_emi(1_000_00, 0, "monthly", 3, "reducing", 3) == 33_333
    schedule = amortize(LoanTerms(1_000_00, 0, "reducing", "monthly", 33_333, date(2026, 1, 5), 3))
    assert [entry.principal for entry in schedule] == [33_333, 33_333, 33_334]
    assert {entry.interest for entry in schedule} == {0}


def test_reducing_schedule_separates_principal_and_interest_and_settles_exactly() -> None:
    principal = 10 * LAKH
    emi = standard_emi(principal, 850, "monthly", 240, "reducing", 240)
    schedule = amortize(
        LoanTerms(principal, 850, "reducing", "monthly", emi, date(2026, 1, 5), 240)
    )

    assert len(schedule) == 240
    first = schedule[0]
    # Interest is the balance times 8.5%/12, rounded half up: 10,00,000 * 0.0070833… = 7083.33.
    assert first.interest == 708_333
    assert first.principal == emi - 708_333
    assert first.amount == emi
    # Principal components repay exactly what was borrowed; only the last installment differs.
    assert sum(entry.principal for entry in schedule) == principal
    assert schedule[-1].balance_after == 0
    assert all(entry.amount == emi for entry in schedule[:-1])
    assert abs(schedule[-1].amount - emi) < 240  # rounding drift stays tiny
    # Balances fall monotonically and interest shrinks as principal is repaid.
    assert all(a.balance_after > b.balance_after for a, b in pairwise(schedule))
    assert schedule[100].interest < schedule[10].interest
    assert [entry.sequence for entry in schedule[:3]] == [1, 2, 3]


def test_flat_rate_interest_is_spread_evenly_with_the_remainder_last() -> None:
    # ₹1,00,000 at 10% flat for 12 months: ₹10,000 interest, EMI ₹9,166.67.
    total = flat_interest_total(LAKH, 1000, 12)
    assert total == 10_000_00
    assert standard_emi(LAKH, 1000, "monthly", 12, "flat", 12) == 9_166_67
    split = flat_interest_split(10_000_01, 12)
    assert split[:-1] == (83_333,) * 11 and split[-1] == 83_338 and sum(split) == 10_000_01

    schedule = amortize(
        LoanTerms(
            LAKH, 1000, "flat", "monthly", 9_166_67, date(2026, 1, 1), 12,
            flat_interest=flat_interest_split(total, 12),
        )
    )  # fmt: skip
    assert sum(entry.interest for entry in schedule) == total
    assert sum(entry.principal for entry in schedule) == LAKH
    assert schedule[-1].balance_after == 0


def test_an_emi_that_does_not_cover_interest_is_rejected() -> None:
    with pytest.raises(ScheduleError, match="doesn't cover the interest"):
        amortize(LoanTerms(10 * LAKH, 1200, "reducing", "monthly", 5_000_00, date(2026, 1, 1), 12))
    with pytest.raises(ScheduleError):
        installments_until_repaid(10 * LAKH, 1200, "monthly", 5_000_00)


def test_a_larger_emi_repays_sooner() -> None:
    count = installments_until_repaid(LAKH, 1200, "monthly", 10_000_00)
    assert count == 11
    schedule = amortize(
        LoanTerms(LAKH, 1200, "reducing", "monthly", 10_000_00, date(2026, 1, 1), count)
    )
    assert len(schedule) == 11 and schedule[-1].balance_after == 0
    assert schedule[-1].amount <= 10_000_00


def test_tenure_must_be_whole_periods() -> None:
    assert installment_count(240, "monthly") == 240
    assert installment_count(24, "quarterly") == 8
    with pytest.raises(ScheduleError, match="whole number of quarters"):
        installment_count(25, "quarterly")
    with pytest.raises(ScheduleError, match="at most 600"):
        installment_count(601, "monthly")


def test_month_end_due_dates_clamp_and_return_to_their_day() -> None:
    dates = list(due_dates(date(2028, 1, 31), "monthly", end=date(2028, 5, 1)))
    assert dates == [date(2028, 1, 31), date(2028, 2, 29), date(2028, 3, 31), date(2028, 4, 30)]
    assert add_months(date(2027, 1, 31), 1) == date(2027, 2, 28)


@pytest.mark.parametrize(
    ("frequency", "expected"),
    [
        ("weekly", [date(2026, 1, 1), date(2026, 1, 8), date(2026, 1, 15)]),
        ("quarterly", [date(2026, 1, 1), date(2026, 4, 1), date(2026, 7, 1)]),
        ("half_yearly", [date(2026, 1, 1), date(2026, 7, 1), date(2027, 1, 1)]),
        ("yearly", [date(2026, 1, 1), date(2027, 1, 1), date(2028, 1, 1)]),
    ],
)
def test_every_frequency_repeats_from_its_anchor(
    frequency: Frequency, expected: list[date]
) -> None:
    generated = due_dates(date(2026, 1, 1), frequency)
    assert [next(generated) for _ in range(3)] == expected


def test_due_dates_can_start_late_without_walking_from_the_anchor() -> None:
    later = due_dates(date(2020, 3, 15), "monthly", start=date(2026, 10, 16))
    assert next(later) == date(2026, 11, 15)
    weekly = due_dates(date(2026, 1, 1), "weekly", start=date(2026, 1, 9), end=date(2026, 1, 22))
    assert list(weekly) == [date(2026, 1, 15), date(2026, 1, 22)]
    # Regenerating the same window yields the same dates: generation is idempotent.
    assert list(
        due_dates(date(2026, 1, 1), "weekly", start=date(2026, 1, 9), end=date(2026, 1, 22))
    ) == [
        date(2026, 1, 15),
        date(2026, 1, 22),
    ]


def test_monthly_and_annual_costs() -> None:
    assert monthly_equivalent(649_00, "monthly") == 649_00
    assert monthly_equivalent(1_499_00, "yearly") == 124_92  # 12491.67 rounds up
    assert monthly_equivalent(100_00, "weekly") == 433_33  # 52 weeks / 12
    assert monthly_equivalent(3_00, "quarterly") == 1_00
    assert annual_equivalent(649_00, "monthly") == 7_788_00
    assert annual_equivalent(100_00, "weekly") == 5_200_00


def test_today_defaults_to_the_users_time_zone(monkeypatch: pytest.MonkeyPatch) -> None:
    import uuid
    from datetime import UTC, datetime

    from orbit_api.api.v1 import commitments
    from orbit_api.services.accounts.models import User

    # 20:00 UTC on Jan 31 is already Feb 1 in Kolkata (UTC+5:30), still Jan 31 in New York.
    monkeypatch.setattr(commitments, "utc_now", lambda: datetime(2026, 1, 31, 20, 0, tzinfo=UTC))

    def user(timezone: str | None) -> User:
        return User(
            id=uuid.uuid4(), auth_provider="local", email="a@example.com", display_name="A",
            created_at=datetime(2026, 1, 1, tzinfo=UTC), timezone=timezone,
        )  # fmt: skip

    assert commitments.local_today(user("Asia/Kolkata"), None) == date(2026, 2, 1)
    assert commitments.local_today(user("America/New_York"), None) == date(2026, 1, 31)
    assert commitments.local_today(user(None), None) == date(2026, 1, 31)
    assert commitments.local_today(user("Asia/Kolkata"), date(2026, 3, 3)) == date(2026, 3, 3)
