"""Unit tests for recurrence: pure functions, no database or wall clock."""

from datetime import UTC, date, datetime, time

import pytest

from orbit_api.services.reminders.recurrence import (
    InvalidRecurrenceError,
    Recurrence,
    Schedule,
    is_valid_timezone,
    next_occurrence,
    recurrence_from_json,
    recurrence_to_json,
)

NEW_YORK = "America/New_York"


def utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=UTC)


def occurrences(schedule: Schedule, after: datetime, count: int) -> list[datetime]:
    """The next `count` occurrences after `after`, each found from the previous one."""
    found: list[datetime] = []
    for _ in range(count):
        at = next_occurrence(schedule, found[-1] if found else after)
        assert at is not None
        found.append(at)
    return found


# One-time


def test_one_time_fires_once_at_its_local_time() -> None:
    # Paris is UTC+1 in winter.
    schedule = Schedule(date(2030, 1, 15), time(9, 0), "Europe/Paris")

    assert next_occurrence(schedule, utc(2030, 1, 1)) == utc(2030, 1, 15, 8, 0)
    assert next_occurrence(schedule, utc(2030, 1, 15, 7, 59)) == utc(2030, 1, 15, 8, 0)


def test_one_time_has_no_occurrence_at_or_after_its_time() -> None:
    schedule = Schedule(date(2030, 1, 15), time(9, 0), "Europe/Paris")

    assert next_occurrence(schedule, utc(2030, 1, 15, 8, 0)) is None
    assert next_occurrence(schedule, utc(2031, 1, 1)) is None


@pytest.mark.parametrize(
    ("timezone", "local", "expected"),
    [
        # Ahead of UTC: 08:00 on the 2nd in Tokyo is 23:00 on the 1st in UTC.
        ("Asia/Tokyo", time(8, 0), utc(2030, 3, 1, 23, 0)),
        # Behind UTC: 23:30 on the 2nd in Los Angeles is 07:30 on the 3rd in UTC.
        ("America/Los_Angeles", time(23, 30), utc(2030, 3, 3, 7, 30)),
        # Half-hour and quarter-hour offsets.
        ("Asia/Kolkata", time(0, 15), utc(2030, 3, 1, 18, 45)),
        ("Asia/Kathmandu", time(12, 0), utc(2030, 3, 2, 6, 15)),
    ],
)
def test_local_times_convert_to_utc_across_midnight(
    timezone: str, local: time, expected: datetime
) -> None:
    schedule = Schedule(date(2030, 3, 2), local, timezone)

    assert next_occurrence(schedule, utc(2030, 1, 1)) == expected


# Daily, and daylight-saving changes (New York: clocks spring forward on 2026-03-08 at 02:00
# and fall back on 2026-11-01 at 02:00)


def test_daily_keeps_its_wall_clock_time_across_dst() -> None:
    schedule = Schedule(date(2026, 3, 6), time(9, 0), NEW_YORK, Recurrence("daily"))

    assert occurrences(schedule, utc(2026, 3, 6), 4) == [
        utc(2026, 3, 6, 14, 0),  # EST, UTC-5
        utc(2026, 3, 7, 14, 0),
        utc(2026, 3, 8, 13, 0),  # EDT, UTC-4
        utc(2026, 3, 9, 13, 0),
    ]


def test_a_time_skipped_by_dst_fires_when_it_would_have_been() -> None:
    # 02:30 doesn't exist on 2026-03-08; it fires at 03:30 EDT (07:30 UTC) instead.
    schedule = Schedule(date(2026, 3, 7), time(2, 30), NEW_YORK, Recurrence("daily"))

    assert occurrences(schedule, utc(2026, 3, 7), 3) == [
        utc(2026, 3, 7, 7, 30),  # 02:30 EST
        utc(2026, 3, 8, 7, 30),  # 03:30 EDT
        utc(2026, 3, 9, 6, 30),  # 02:30 EDT
    ]


def test_a_time_repeated_by_dst_fires_once_at_the_first() -> None:
    # 01:30 happens twice on 2026-11-01: at 05:30 UTC (EDT), then 06:30 UTC (EST).
    schedule = Schedule(date(2026, 10, 31), time(1, 30), NEW_YORK, Recurrence("daily"))

    assert occurrences(schedule, utc(2026, 10, 31), 3) == [
        utc(2026, 10, 31, 5, 30),
        utc(2026, 11, 1, 5, 30),
        utc(2026, 11, 2, 6, 30),
    ]


def test_one_time_in_a_dst_gap_fires_after_it() -> None:
    schedule = Schedule(date(2026, 3, 8), time(2, 30), NEW_YORK)

    assert next_occurrence(schedule, utc(2026, 1, 1)) == utc(2026, 3, 8, 7, 30)


def test_recurrence_starts_on_its_start_date() -> None:
    schedule = Schedule(date(2030, 6, 1), time(7, 0), "UTC", Recurrence("daily"))

    assert next_occurrence(schedule, utc(2026, 1, 1)) == utc(2030, 6, 1, 7, 0)


def test_recurrence_that_started_in_the_past_continues_from_now() -> None:
    schedule = Schedule(date(2020, 1, 1), time(7, 0), "UTC", Recurrence("daily"))

    assert next_occurrence(schedule, utc(2030, 6, 1, 7, 0)) == utc(2030, 6, 2, 7, 0)
    assert next_occurrence(schedule, utc(2030, 6, 1, 6, 59)) == utc(2030, 6, 1, 7, 0)


# Weekly


def test_weekly_repeats_on_the_chosen_weekdays() -> None:
    # 2030-01-07 is a Monday.
    weekdays = Recurrence("weekly", frozenset({"mon", "wed", "fri"}))
    schedule = Schedule(date(2030, 1, 7), time(18, 0), "UTC", weekdays)

    assert occurrences(schedule, utc(2030, 1, 1), 4) == [
        utc(2030, 1, 7, 18, 0),
        utc(2030, 1, 9, 18, 0),
        utc(2030, 1, 11, 18, 0),
        utc(2030, 1, 14, 18, 0),
    ]


def test_weekly_skips_a_start_date_on_another_weekday() -> None:
    # Starts on a Monday but repeats on Thursdays only.
    schedule = Schedule(
        date(2030, 1, 7), time(9, 0), "UTC", Recurrence("weekly", frozenset({"thu"}))
    )

    assert occurrences(schedule, utc(2030, 1, 1), 2) == [
        utc(2030, 1, 10, 9, 0),
        utc(2030, 1, 17, 9, 0),
    ]


# Monthly


def test_monthly_uses_the_last_day_of_shorter_months() -> None:
    schedule = Schedule(date(2027, 1, 31), time(9, 0), "UTC", Recurrence("monthly"))

    assert [at.date() for at in occurrences(schedule, utc(2027, 1, 1), 5)] == [
        date(2027, 1, 31),
        date(2027, 2, 28),
        date(2027, 3, 31),
        date(2027, 4, 30),
        date(2027, 5, 31),
    ]


def test_monthly_on_the_29th_lands_on_february_29_in_leap_years() -> None:
    schedule = Schedule(date(2027, 12, 29), time(9, 0), "UTC", Recurrence("monthly"))

    assert [at.date() for at in occurrences(schedule, utc(2027, 12, 1), 4)] == [
        date(2027, 12, 29),
        date(2028, 1, 29),
        date(2028, 2, 29),
        date(2028, 3, 29),
    ]


def test_monthly_crosses_the_year_and_dst() -> None:
    schedule = Schedule(date(2026, 10, 15), time(9, 0), NEW_YORK, Recurrence("monthly"))

    assert occurrences(schedule, utc(2026, 10, 1), 4) == [
        utc(2026, 10, 15, 13, 0),  # EDT
        utc(2026, 11, 15, 14, 0),  # EST
        utc(2026, 12, 15, 14, 0),
        utc(2027, 1, 15, 14, 0),
    ]


# Validation and storage


@pytest.mark.parametrize(
    ("frequency", "weekdays"),
    [("weekly", frozenset[str]()), ("daily", frozenset({"mon"})), ("monthly", frozenset({"mon"}))],
)
def test_recurrence_rejects_mismatched_weekdays(frequency: str, weekdays: frozenset[str]) -> None:
    with pytest.raises(InvalidRecurrenceError):
        Recurrence(frequency, weekdays)  # pyright: ignore[reportArgumentType] -- deliberately invalid input


@pytest.mark.parametrize(
    "recurrence",
    [None, Recurrence("daily"), Recurrence("monthly"), Recurrence("weekly", frozenset({"sun"}))],
)
def test_recurrence_round_trips_through_storage(recurrence: Recurrence | None) -> None:
    assert recurrence_from_json(recurrence_to_json(recurrence)) == recurrence


def test_stored_weekdays_are_in_weekday_order() -> None:
    stored = recurrence_to_json(Recurrence("weekly", frozenset({"sun", "mon", "wed"})))

    assert stored == {"version": 1, "frequency": "weekly", "weekdays": ["mon", "wed", "sun"]}


@pytest.mark.parametrize(
    "stored",
    [
        "daily",
        {"frequency": "daily", "weekdays": []},
        {"version": 2, "frequency": "daily", "weekdays": []},
        {"version": 1, "frequency": "hourly", "weekdays": []},
        {"version": 1, "frequency": "weekly", "weekdays": ["funday"]},
        {"version": 1, "frequency": "weekly", "weekdays": []},
        {"version": 1, "frequency": "weekly", "weekdays": "mon"},
    ],
)
def test_unreadable_stored_recurrence_is_rejected(stored: object) -> None:
    with pytest.raises(InvalidRecurrenceError):
        recurrence_from_json(stored)


@pytest.mark.parametrize(
    ("name", "valid"),
    [
        ("Europe/Paris", True),
        ("UTC", True),
        ("America/Argentina/Buenos_Aires", True),
        ("Mars/Olympus_Mons", False),
        ("europe/paris", False),
        ("", False),
        ("../../etc/passwd", False),
    ],
)
def test_time_zone_names_are_checked_against_the_iana_database(name: str, valid: bool) -> None:
    assert is_valid_timezone(name) is valid
