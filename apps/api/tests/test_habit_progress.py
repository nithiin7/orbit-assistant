"""Habit schedules, day states, periods, streaks, and rates: the pure rules behind the API.

2030-01-07 is a Monday.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest

from orbit_api.services.habits.insights import habit_reminder_target
from orbit_api.services.habits.models import Habit, HabitLog, HabitReminder
from orbit_api.services.habits.progress import (
    LogEntry,
    day_state,
    period_on,
    periods,
    rate,
    streaks,
)
from orbit_api.services.habits.schedule import (
    HabitSchedule,
    InvalidScheduleError,
    Pause,
    ScheduleVersion,
    Timeline,
    is_due,
    month_dates,
    schedule_from_json,
    schedule_to_json,
)

MON = date(2030, 1, 7)
DAILY = HabitSchedule("daily")
MWF = HabitSchedule("weekdays", weekdays=frozenset({"mon", "wed", "fri"}))
FOUR_A_WEEK = HabitSchedule("weekly_target", times_per_week=4)


def day(offset: int) -> date:
    return MON + timedelta(days=offset)


def timeline(
    *versions: tuple[int, HabitSchedule], pauses: tuple[Pause, ...] = (), end: date | None = None
) -> Timeline:
    return Timeline(
        start_date=day(versions[0][0]),
        end_date=end,
        versions=[ScheduleVersion(day(offset), schedule) for offset, schedule in versions],
        pauses=pauses,
    )


def done(*offsets: int, value: float = 1, target: float = 1) -> dict[date, LogEntry]:
    return {day(o): LogEntry(day(o), value, target, False) for o in offsets}


def skipped(*offsets: int) -> dict[date, LogEntry]:
    return {day(o): LogEntry(day(o), 0, 1, True) for o in offsets}


class TestSchedules:
    def test_rejects_inconsistent_schedules(self) -> None:
        for bad in (
            lambda: HabitSchedule("weekdays"),
            lambda: HabitSchedule("daily", weekdays=frozenset({"mon"})),
            lambda: HabitSchedule("monthly", month_days=frozenset({32})),
            lambda: HabitSchedule("weekly_target", times_per_week=8),
            lambda: HabitSchedule("weekdays", every=2, weekdays=frozenset({"mon"})),
        ):
            with pytest.raises(InvalidScheduleError):
                bad()

    def test_every_n_days_counts_from_the_versions_first_day(self) -> None:
        version = ScheduleVersion(day(0), HabitSchedule("daily", every=3))
        assert [o for o in range(10) if is_due(version, day(o))] == [0, 3, 6, 9]

    def test_month_end_and_leap_years(self) -> None:
        # The 30th and 31st both land on Feb 28 once, not twice; leap years have the 29th.
        assert month_dates(2030, 2, frozenset({30, 31})) == {28}
        assert month_dates(2032, 2, frozenset({31})) == {29}
        version = ScheduleVersion(
            date(2030, 1, 1), HabitSchedule("monthly", month_days=frozenset({31}))
        )
        assert is_due(version, date(2030, 4, 30)) and not is_due(version, date(2030, 4, 29))

    def test_round_trips_through_json(self) -> None:
        for schedule in (
            DAILY,
            MWF,
            FOUR_A_WEEK,
            HabitSchedule("monthly", month_days=frozenset({1, 15})),
        ):
            assert schedule_from_json(schedule_to_json(schedule)) == schedule
        with pytest.raises(InvalidScheduleError):
            schedule_from_json({"version": 99, "type": "daily"})


class TestDailyStreaks:
    def test_counts_consecutive_completed_days_and_today_is_pending(self) -> None:
        line = timeline((0, DAILY))
        log = done(0, 1, 2, 4, 5)
        history = periods(line, log, day(0), day(6), day(6))
        assert [p.state for p in history][-1] == "pending"
        result = streaks(line, history)
        assert (result.current, result.longest, result.unit) == (2, 3, "day")
        assert day_state(line, log, day(3), day(6)) == "missed"
        assert day_state(line, log, day(6), day(6)) == "pending"

    def test_skipped_days_neither_break_nor_extend(self) -> None:
        line = timeline((0, DAILY))
        log = done(0, 1, 3) | skipped(2)
        assert streaks(line, periods(line, log, day(0), day(3), day(3))).current == 3

    def test_partial_progress_is_shown_but_does_not_count(self) -> None:
        line = timeline((0, DAILY))
        log = done(0) | done(1, value=1.5, target=3)
        assert day_state(line, log, day(1), day(1)) == "partial"
        assert day_state(line, log, day(1), day(2)) == "partial"
        history = periods(line, log, day(0), day(2), day(2))
        assert [p.state for p in history] == ["met", "missed", "pending"]

    def test_pauses_neither_break_nor_count(self) -> None:
        line = timeline((0, DAILY), pauses=(Pause(day(2), day(5)),))
        log = done(0, 1, 5)
        history = periods(line, log, day(0), day(5), day(5))
        assert [p.start for p in history] == [day(0), day(1), day(5)]
        assert streaks(line, history).current == 3
        assert day_state(line, log, day(3), day(5)) == "paused"


class TestWeekdayStreaks:
    def test_only_due_days_count(self) -> None:
        line = timeline((0, MWF))
        # Mon, Wed, Fri, then next Mon; Tue was an extra day.
        log = done(0, 1, 2, 4, 7)
        assert streaks(line, periods(line, log, day(0), day(7), day(7))).current == 4
        assert day_state(line, log, day(1), day(7)) == "bonus"
        assert day_state(line, log, day(3), day(7)) == "unscheduled"


class TestWeeklyTargets:
    def test_a_week_needs_its_target(self) -> None:
        line = timeline((0, FOUR_A_WEEK))
        log = done(0, 1, 2, 3, 7, 8)
        history = periods(line, log, day(0), day(9), day(9))
        assert [(p.state, p.done, p.required) for p in history] == [
            ("met", 4, 4),
            ("pending", 2, 4),
        ]
        result = streaks(line, history)
        assert (result.current, result.unit) == (1, "week")

    def test_short_and_skipped_weeks_ask_for_less(self) -> None:
        # Starting on Saturday leaves two days in the first week.
        line = timeline((5, FOUR_A_WEEK))
        first = period_on(line, done(5, 6), day(5), day(6))
        assert first is not None and (first.state, first.required) == ("met", 2)
        # Five skipped days leave two available.
        line = timeline((0, FOUR_A_WEEK))
        log = skipped(0, 1, 2, 3, 4) | done(5, 6)
        week = periods(line, log, day(0), day(6), day(7))
        assert [(p.state, p.required) for p in week] == [("met", 2)]

    def test_missed_weeks_end_the_streak(self) -> None:
        line = timeline((0, FOUR_A_WEEK))
        log = done(0, 1, 2, 3, 7, 14, 15, 16, 17)
        history = periods(line, log, day(0), day(20), day(21))
        assert [p.state for p in history] == ["met", "missed", "met"]
        assert streaks(line, history).current == 1


class TestScheduleChanges:
    def test_history_keeps_the_old_schedule(self) -> None:
        # Daily for a week, then Mon/Wed/Fri: the old Tuesday stays due, the new one doesn't.
        line = timeline((0, DAILY), (7, MWF))
        log = done(*range(7), 7)
        assert day_state(line, log, day(1), day(9)) == "completed"
        assert day_state(line, {}, day(8), day(9)) == "unscheduled"
        # Same unit: the streak carries on across the change.
        assert streaks(line, periods(line, log, day(0), day(8), day(8))).current == 8

    def test_changing_unit_starts_a_new_run(self) -> None:
        line = timeline((0, DAILY), (7, FOUR_A_WEEK))
        log = done(*range(7), 7, 8, 9, 10)
        result = streaks(line, periods(line, log, day(0), day(13), day(14)))
        assert (result.current, result.longest, result.unit) == (1, 1, "week")

    def test_rates_ignore_days_that_were_not_due(self) -> None:
        line = timeline((0, MWF))
        log = done(0, 4)
        history = periods(line, log, day(0), day(6), day(7))
        assert rate(history) == pytest.approx(2 / 3)
        assert rate(periods(line, {}, day(5), day(6), day(7))) is None


class TestReminderTargets:
    """What a habit's reminder time announces next, with a fixed clock."""

    def habit(self, **fields: Any) -> Habit:
        defaults: dict[str, Any] = {
            "id": uuid.uuid4(),
            "workspace_id": uuid.uuid4(),
            "category_id": None,
            "name": "Water",
            "description": "",
            "icon": "droplet",
            "color": "blue",
            "kind": "numeric",
            "unit": "litres",
            "target": 3.0,
            "time_of_day": None,
            "start_date": day(0),
            "end_date": None,
            "timezone": "UTC",
            "status": "active",
            "versions": (ScheduleVersion(day(0), DAILY),),
            "pauses": (),
            "created_at": datetime(2030, 1, 1, tzinfo=UTC),
            "updated_at": datetime(2030, 1, 1, tzinfo=UTC),
        }
        return Habit(**(defaults | fields))

    def log(self, habit: Habit, offset: int, value: float, skipped: bool = False) -> HabitLog:
        at = datetime(2030, 1, 7, tzinfo=UTC)
        return HabitLog(
            uuid.uuid4(),
            habit.workspace_id,
            habit.id,
            day(offset),
            value,
            3.0,
            skipped,
            "",
            at,
            at,
            at,
        )

    def target(
        self, habit: Habit, logs: list[HabitLog], weekdays: frozenset[Any] = frozenset()
    ) -> str | None:
        reminder = HabitReminder(
            uuid.uuid4(), habit.workspace_id, habit.id, None, time(20, 0), weekdays
        )
        result = habit_reminder_target(
            habit, reminder, logs, datetime(2030, 1, 7, 9, 0, tzinfo=UTC)
        )
        return None if result is None else result.schedule.start_date.isoformat()

    def test_partial_progress_still_reminds_but_done_days_do_not(self) -> None:
        habit = self.habit()
        assert self.target(habit, [self.log(habit, 0, 1.5)]) == "2030-01-07"
        assert self.target(habit, [self.log(habit, 0, 3)]) == "2030-01-08"
        assert self.target(habit, [self.log(habit, 0, 0, skipped=True)]) == "2030-01-08"

    def test_weekday_limits_and_paused_habits(self) -> None:
        habit = self.habit()
        assert self.target(habit, [], frozenset({"wed"})) == "2030-01-09"
        assert self.target(self.habit(status="paused"), []) is None
