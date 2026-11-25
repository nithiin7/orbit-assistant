"""Yearly dates for People: next occurrences, leap days, and what the reminder announces."""

import uuid
from datetime import UTC, date, datetime, time

import pytest

from orbit_api.services.people.dates import (
    check_dates,
    next_alert,
    next_occurrence,
    reminder_target,
)
from orbit_api.services.people.models import Person, PersonDate, PersonDateError


def person(*dates: PersonDate, timezone: str = "UTC", name: str = "Priya") -> Person:
    now = datetime(2030, 1, 1, tzinfo=UTC)
    return Person(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        name=name,
        relationship="friend",
        phone="",
        email="",
        note="",
        favorite=False,
        dates=dates,
        reminder_time=time(9, 0),
        timezone=timezone,
        created_at=now,
        updated_at=now,
    )


def birthday(month: int, day: int, year: int | None = None, before: int | None = 0) -> PersonDate:
    return PersonDate(kind="birthday", month=month, day=day, year=year, remind_days_before=before)


class TestNextOccurrence:
    def test_today_counts_and_past_dates_move_to_next_year(self) -> None:
        assert next_occurrence(birthday(3, 12), date(2030, 3, 12)) == date(2030, 3, 12)
        assert next_occurrence(birthday(3, 12), date(2030, 3, 13)) == date(2031, 3, 12)

    def test_leap_day_falls_on_28_february_in_other_years(self) -> None:
        assert next_occurrence(birthday(2, 29), date(2030, 1, 1)) == date(2030, 2, 28)
        assert next_occurrence(birthday(2, 29), date(2031, 3, 1)) == date(2032, 2, 29)


class TestCheckDates:
    def test_rejects_days_the_month_lacks(self) -> None:
        with pytest.raises(PersonDateError, match="April has no day 31"):
            check_dates([birthday(4, 31)])
        with pytest.raises(PersonDateError, match="February 2023 has no day 29"):
            check_dates([birthday(2, 29, year=2023)])
        check_dates([birthday(2, 29)])
        check_dates([birthday(2, 29, year=2024)])

    def test_rejects_a_second_birthday(self) -> None:
        with pytest.raises(PersonDateError, match="only one birthday"):
            check_dates([birthday(1, 1), birthday(2, 2)])


class TestReminders:
    def test_announces_the_soonest_alert_across_dates(self) -> None:
        anniversary = PersonDate(
            kind="anniversary", month=6, day=1, year=2020, remind_days_before=1
        )
        someone = person(birthday(9, 10, year=1996, before=7), anniversary)
        target = reminder_target(someone, datetime(2030, 5, 1, tzinfo=UTC))
        assert target is not None
        assert target.schedule.start_date == date(2030, 5, 31)
        assert target.title == "Priya's anniversary is tomorrow (10 years)"
        assert target.description == "Anniversary on 1 June 2030. Open People to see more."

    def test_age_when_the_year_is_known(self) -> None:
        target = reminder_target(
            person(birthday(9, 10, year=1996, before=7)), datetime(2030, 5, 1, tzinfo=UTC)
        )
        assert target is not None
        assert target.title == "Priya turns 34 in 7 days"
        assert target.schedule.start_date == date(2030, 9, 3)

    def test_early_reminders_can_fall_in_the_previous_year(self) -> None:
        target = reminder_target(
            person(birthday(1, 2, before=7)), datetime(2030, 12, 1, tzinfo=UTC)
        )
        assert target is not None
        assert target.schedule.start_date == date(2030, 12, 26)
        assert target.title == "Priya's birthday is in 7 days"

    def test_moves_past_a_reminder_already_due_today(self) -> None:
        someone = person(birthday(3, 12))
        alert = next_alert(someone, datetime(2030, 3, 12, 9, 0, 1, tzinfo=UTC))
        assert alert is not None
        assert alert.on == date(2031, 3, 12)

    def test_time_zone_and_no_reminder(self) -> None:
        kolkata = person(birthday(3, 12), timezone="Asia/Kolkata")
        alert = next_alert(kolkata, datetime(2030, 3, 1, tzinfo=UTC))
        assert alert is not None
        assert alert.at == datetime(2030, 3, 12, 3, 30, tzinfo=UTC)
        assert reminder_target(person(birthday(3, 12, before=None)), datetime.now(UTC)) is None

    def test_named_dates_and_long_names(self) -> None:
        other = PersonDate(kind="other", label="Name day", month=7, day=4, remind_days_before=0)
        target = reminder_target(person(other, name="R" * 190), datetime(2030, 7, 1, tzinfo=UTC))
        assert target is not None
        assert len(target.title) == 200
        assert target.title.endswith("…")
