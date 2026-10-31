"""The calendar's recurrence engine, occurrence expansion, and alert targeting. Pure functions."""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from orbit_api.services.calendar.models import CalendarEvent, EventException
from orbit_api.services.calendar.occurrences import (
    expand,
    in_date_window,
    occurrence_key,
    window_instants,
)
from orbit_api.services.calendar.recurrence import (
    EventRecurrence,
    InvalidEventRecurrenceError,
    is_occurrence,
    last_start,
    remaining_from,
    rule_from_json,
    rule_to_json,
    starts_between,
    truncate_before,
    validate_rule,
)
from orbit_api.services.calendar.service import alert_target, decode_cursor, encode_cursor

WORKSPACE = uuid.uuid4()
NOW = datetime(2026, 1, 1, tzinfo=UTC)


def local(text: str) -> datetime:
    return datetime.fromisoformat(text)


def event(
    start: str,
    end: str,
    *,
    rule: EventRecurrence | None = None,
    timezone: str = "UTC",
    all_day: bool = False,
    status: str = "confirmed",
) -> CalendarEvent:
    return CalendarEvent(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        title="Standup",
        description="",
        location="",
        category_id=None,
        all_day=all_day,
        timezone=timezone,
        start=local(start),
        end=local(end),
        recurrence=rule,
        status="cancelled" if status == "cancelled" else "confirmed",
        series_id=None,
        created_at=NOW,
        updated_at=NOW,
    )


def starts(rule: EventRecurrence, start: str, until: str) -> list[str]:
    values = starts_between(rule, local(start), local(start), local(until))
    return [value.isoformat(timespec="minutes") for value in values]


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


class TestRules:
    def test_daily_with_interval(self) -> None:
        rule = EventRecurrence("daily", interval=2)
        assert starts(rule, "2026-03-01T09:00", "2026-03-07T23:59") == [
            "2026-03-01T09:00",
            "2026-03-03T09:00",
            "2026-03-05T09:00",
            "2026-03-07T09:00",
        ]

    def test_weekly_on_selected_weekdays(self) -> None:
        # 2 Mar 2026 is a Monday.
        rule = EventRecurrence("weekly", weekdays=frozenset({"mon", "wed", "fri"}))
        assert starts(rule, "2026-03-02T09:00", "2026-03-09T23:59") == [
            "2026-03-02T09:00",
            "2026-03-04T09:00",
            "2026-03-06T09:00",
            "2026-03-09T09:00",
        ]

    def test_every_other_week(self) -> None:
        rule = EventRecurrence("weekly", interval=2, weekdays=frozenset({"mon"}))
        assert starts(rule, "2026-03-02T09:00", "2026-03-31T23:59") == [
            "2026-03-02T09:00",
            "2026-03-16T09:00",
            "2026-03-30T09:00",
        ]

    def test_monthly_on_the_31st_falls_on_the_last_day_of_shorter_months(self) -> None:
        rule = EventRecurrence("monthly")
        assert starts(rule, "2026-01-31T10:00", "2026-06-30T23:59") == [
            "2026-01-31T10:00",
            "2026-02-28T10:00",
            "2026-03-31T10:00",
            "2026-04-30T10:00",
            "2026-05-31T10:00",
            "2026-06-30T10:00",
        ]

    def test_monthly_on_the_30th_in_a_leap_february(self) -> None:
        rule = EventRecurrence("monthly")
        assert starts(rule, "2028-01-30T10:00", "2028-03-31T23:59") == [
            "2028-01-30T10:00",
            "2028-02-29T10:00",
            "2028-03-30T10:00",
        ]

    def test_monthly_on_an_ordinary_day(self) -> None:
        rule = EventRecurrence("monthly", interval=3)
        assert starts(rule, "2026-01-15T10:00", "2026-12-31T23:59") == [
            "2026-01-15T10:00",
            "2026-04-15T10:00",
            "2026-07-15T10:00",
            "2026-10-15T10:00",
        ]

    def test_yearly_on_february_29_falls_on_the_28th_in_common_years(self) -> None:
        rule = EventRecurrence("yearly")
        assert starts(rule, "2028-02-29T00:00", "2032-12-31T00:00") == [
            "2028-02-29T00:00",
            "2029-02-28T00:00",
            "2030-02-28T00:00",
            "2031-02-28T00:00",
            "2032-02-29T00:00",
        ]

    def test_ends_after_a_count(self) -> None:
        rule = EventRecurrence("daily", count=3)
        assert starts(rule, "2026-03-01T09:00", "2026-12-31T00:00") == [
            "2026-03-01T09:00",
            "2026-03-02T09:00",
            "2026-03-03T09:00",
        ]
        assert last_start(rule, local("2026-03-01T09:00")) == local("2026-03-03T09:00")

    def test_ends_on_a_date_inclusive(self) -> None:
        rule = EventRecurrence("weekly", weekdays=frozenset({"mon"}), until=date(2026, 3, 16))
        assert starts(rule, "2026-03-02T09:00", "2026-12-31T00:00") == [
            "2026-03-02T09:00",
            "2026-03-09T09:00",
            "2026-03-16T09:00",
        ]

    def test_never_ending_series_has_no_last_start(self) -> None:
        assert last_start(EventRecurrence("daily"), local("2026-03-01T09:00")) is None

    def test_membership(self) -> None:
        rule = EventRecurrence("weekly", weekdays=frozenset({"mon"}))
        start = local("2026-03-02T09:00")
        assert is_occurrence(rule, start, local("2026-03-09T09:00"))
        assert not is_occurrence(rule, start, local("2026-03-10T09:00"))
        assert not is_occurrence(rule, start, local("2026-03-09T10:00"))

    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            ({"frequency": "weekly"}, "at least one weekday"),
            ({"frequency": "daily", "weekdays": frozenset({"mon"})}, "Only weekly"),
            ({"frequency": "daily", "interval": 0}, "interval"),
            ({"frequency": "daily", "count": 2, "until": date(2027, 1, 1)}, "not both"),
            ({"frequency": "daily", "count": 1000}, "count"),
        ],
    )
    def test_invalid_rules(self, kwargs: dict[str, object], message: str) -> None:
        with pytest.raises(InvalidEventRecurrenceError, match=message):
            EventRecurrence(**kwargs)  # type: ignore[arg-type]

    def test_weekly_rule_must_include_the_start_weekday(self) -> None:
        with pytest.raises(InvalidEventRecurrenceError, match="start date's weekday"):
            validate_rule(
                EventRecurrence("weekly", weekdays=frozenset({"tue"})), local("2026-03-02T09:00")
            )

    def test_round_trips_through_json(self) -> None:
        rule = EventRecurrence(
            "weekly", interval=2, weekdays=frozenset({"fri", "mon"}), until=date(2027, 1, 1)
        )
        stored = rule_to_json(rule)
        assert stored == {
            "version": 1,
            "frequency": "weekly",
            "interval": 2,
            "weekdays": ["mon", "fri"],
            "count": None,
            "until": "2027-01-01",
        }
        assert rule_from_json(stored) == rule

    @pytest.mark.parametrize(
        "stored",
        [
            "daily",
            {"version": 2, "frequency": "daily"},
            {"version": 1, "frequency": "hourly"},
            {"version": 1, "frequency": "weekly", "weekdays": ["someday"]},
            {"version": 1, "frequency": "daily", "until": "not a date"},
        ],
    )
    def test_rejects_stored_rules_it_cannot_read(self, stored: object) -> None:
        with pytest.raises(InvalidEventRecurrenceError):
            rule_from_json(stored)


class TestSplitting:
    def test_truncates_before_the_split(self) -> None:
        rule = EventRecurrence("weekly", weekdays=frozenset({"mon"}))
        start = local("2026-03-02T09:00")
        head = truncate_before(rule, start, local("2026-03-16T09:00"))
        assert head is not None and head.until == date(2026, 3, 9)
        assert truncate_before(rule, start, start) is None

    def test_following_keeps_the_remaining_count(self) -> None:
        rule = EventRecurrence("daily", count=10)
        start = local("2026-03-01T09:00")
        tail = remaining_from(rule, start, local("2026-03-04T09:00"))
        assert tail.count == 7
        head = truncate_before(rule, start, local("2026-03-04T09:00"))
        assert head is not None
        assert len(starts_between(head, start, start, local("2027-01-01T00:00"))) == 3


class TestExpansion:
    def test_expands_only_the_window(self) -> None:
        series = event("2026-03-02T09:00", "2026-03-02T09:30", rule=EventRecurrence("daily"))
        found = expand(series, {}, utc("2026-03-10T00:00"), utc("2026-03-12T00:00"))
        assert [o.start.isoformat() for o in found] == [
            "2026-03-10T09:00:00",
            "2026-03-11T09:00:00",
        ]

    def test_keeps_local_time_across_dst(self) -> None:
        # Paris moves to summer time on 29 Mar 2026: 09:00 is 08:00 UTC before and 07:00 after.
        series = event(
            "2026-03-27T09:00",
            "2026-03-27T10:00",
            rule=EventRecurrence("daily"),
            timezone="Europe/Paris",
        )
        found = expand(series, {}, utc("2026-03-27T00:00"), utc("2026-03-31T00:00"))
        assert [o.start_at for o in found] == [
            utc("2026-03-27T08:00"),
            utc("2026-03-28T08:00"),
            utc("2026-03-29T07:00"),
            utc("2026-03-30T07:00"),
        ]
        assert all(o.end_at - o.start_at == timedelta(hours=1) for o in found)

    def test_a_time_skipped_by_dst_happens_after_the_jump(self) -> None:
        series = event(
            "2026-03-28T02:30",
            "2026-03-28T03:00",
            rule=EventRecurrence("daily"),
            timezone="Europe/Paris",
        )
        found = expand(series, {}, utc("2026-03-29T00:00"), utc("2026-03-29T12:00"))
        # 02:30 doesn't exist on 29 Mar; it happens at 03:30 local (01:30 UTC).
        assert [o.start_at for o in found] == [utc("2026-03-29T01:30")]

    def test_skipped_and_modified_occurrences(self) -> None:
        series = event("2026-03-02T09:00", "2026-03-02T10:00", rule=EventRecurrence("daily"))
        exceptions = {
            local("2026-03-03T09:00"): EventException(
                uuid.uuid4(), WORKSPACE, series.id, local("2026-03-03T09:00"), "skipped"
            ),
            local("2026-03-04T09:00"): EventException(
                uuid.uuid4(),
                WORKSPACE,
                series.id,
                local("2026-03-04T09:00"),
                "modified",
                title="Moved standup",
                start=local("2026-03-04T14:00"),
                end=local("2026-03-04T15:00"),
            ),
        }
        found = expand(series, exceptions, utc("2026-03-02T00:00"), utc("2026-03-05T00:00"))
        assert [(o.title, o.start.isoformat(), o.modified) for o in found] == [
            ("Standup", "2026-03-02T09:00:00", False),
            ("Moved standup", "2026-03-04T14:00:00", True),
        ]

    def test_finds_an_occurrence_moved_into_the_window_once(self) -> None:
        series = event("2026-03-02T09:00", "2026-03-02T10:00", rule=EventRecurrence("daily"))
        original = local("2026-03-02T09:00")
        moved = EventException(
            uuid.uuid4(),
            WORKSPACE,
            series.id,
            original,
            "modified",
            start=local("2026-03-20T09:00"),
            end=local("2026-03-20T10:00"),
        )
        found = expand(series, {original: moved}, utc("2026-03-20T00:00"), utc("2026-03-21T00:00"))
        keys = [occurrence_key(o) for o in found]
        # The moved occurrence and the 20th's own: no duplicates, stable identities.
        assert len(keys) == len(set(keys)) == 2
        assert keys[0].endswith("2026-03-02T09:00")

    def test_expanding_twice_gives_identical_keys(self) -> None:
        series = event("2026-03-02T09:00", "2026-03-02T10:00", rule=EventRecurrence("daily"))
        window = (utc("2026-03-01T00:00"), utc("2026-04-01T00:00"))
        first = [occurrence_key(o) for o in expand(series, {}, *window)]
        assert first == [occurrence_key(o) for o in expand(series, {}, *window)]
        assert len(first) == len(set(first)) == 30  # 2 to 31 March

    def test_cancelled_occurrence_and_cancelled_series(self) -> None:
        series = event("2026-03-02T09:00", "2026-03-02T10:00", rule=EventRecurrence("daily"))
        original = local("2026-03-03T09:00")
        exceptions = {
            original: EventException(
                uuid.uuid4(), WORKSPACE, series.id, original, "modified", status="cancelled"
            )
        }
        found = expand(series, exceptions, utc("2026-03-02T00:00"), utc("2026-03-04T00:00"))
        assert [o.status for o in found] == ["confirmed", "cancelled"]

    def test_all_day_events_match_by_date_in_any_time_zone(self) -> None:
        birthday = event(
            "2026-05-10T00:00",
            "2026-05-11T00:00",
            all_day=True,
            timezone="Pacific/Auckland",
            rule=EventRecurrence("yearly"),
        )
        found = expand(birthday, {}, utc("2027-05-08T00:00"), utc("2027-05-12T00:00"))
        assert len(found) == 1
        assert in_date_window(found[0], date(2027, 5, 10), date(2027, 5, 11))
        assert not in_date_window(found[0], date(2027, 5, 11), date(2027, 5, 12))


class TestTimeZones:
    def test_day_boundaries_follow_the_viewer(self) -> None:
        start, end = window_instants(date(2026, 7, 1), date(2026, 7, 2), "America/New_York")
        assert start == utc("2026-07-01T04:00")
        assert end == utc("2026-07-02T04:00")

    def test_a_dst_day_is_23_hours_long(self) -> None:
        start, end = window_instants(date(2026, 3, 8), date(2026, 3, 9), "America/New_York")
        assert end - start == timedelta(hours=23)

    def test_event_time_zone_decides_the_instant(self) -> None:
        tokyo = event("2026-06-01T09:00", "2026-06-01T10:00", timezone="Asia/Tokyo")
        (occurrence,) = expand(tokyo, {}, utc("2026-05-31T00:00"), utc("2026-06-02T00:00"))
        assert occurrence.start_at == datetime(2026, 6, 1, 9, tzinfo=ZoneInfo("Asia/Tokyo"))


class TestAlerts:
    def test_points_at_the_next_occurrence_whose_alert_is_ahead(self) -> None:
        series = event("2026-03-02T09:00", "2026-03-02T09:30", rule=EventRecurrence("daily"))
        now = utc("2026-03-05T08:50")
        target = alert_target(series, {}, 15, now)
        # 08:45 today has passed; tomorrow's 08:45 is next.
        assert target is not None
        assert (target.schedule.start_date, target.schedule.time_of_day.isoformat()) == (
            date(2026, 3, 6),
            "08:45:00",
        )
        assert target.schedule.timezone == "UTC"

    def test_skips_cancelled_and_skipped_occurrences(self) -> None:
        series = event("2026-03-02T09:00", "2026-03-02T09:30", rule=EventRecurrence("daily"))
        exceptions = {
            local("2026-03-06T09:00"): EventException(
                uuid.uuid4(), WORKSPACE, series.id, local("2026-03-06T09:00"), "skipped"
            ),
            local("2026-03-07T09:00"): EventException(
                uuid.uuid4(),
                WORKSPACE,
                series.id,
                local("2026-03-07T09:00"),
                "modified",
                status="cancelled",
            ),
        }
        target = alert_target(series, exceptions, 0, utc("2026-03-05T10:00"))
        assert target is not None and target.schedule.start_date == date(2026, 3, 8)

    def test_nothing_for_a_cancelled_or_finished_series(self) -> None:
        past = event("2026-03-02T09:00", "2026-03-02T09:30", rule=EventRecurrence("daily", count=2))
        assert alert_target(past, {}, 0, utc("2026-04-01T00:00")) is None
        cancelled = event("2026-05-02T09:00", "2026-05-02T09:30", status="cancelled")
        assert alert_target(cancelled, {}, 0, utc("2026-04-01T00:00")) is None

    def test_all_day_alerts_use_nine_in_the_morning(self) -> None:
        trip = event("2026-05-10T00:00", "2026-05-11T00:00", all_day=True, timezone="Europe/Paris")
        target = alert_target(trip, {}, 24 * 60, utc("2026-05-01T00:00"))
        # 09:00 Paris on 9 May is 07:00 UTC.
        assert target is not None
        assert (target.schedule.start_date, target.schedule.time_of_day.hour) == (
            date(2026, 5, 9),
            7,
        )


def test_agenda_cursor_round_trip() -> None:
    cursor = encode_cursor(utc("2026-03-02T09:00"), "1:abc:2026-03-02T09:00")
    assert decode_cursor(cursor) == (utc("2026-03-02T09:00"), "1:abc:2026-03-02T09:00")
