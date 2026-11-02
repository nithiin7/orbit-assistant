"""Pure health and fitness calculations: volume, one-rep max estimates, personal records,
analytics, BMI, portion scaling, goal progress, and habit contributions."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from orbit_api.services.fitness.calculations import (
    bmi,
    goal_fraction,
    goal_pace,
    goal_reached,
    milestones,
    scale_nutrients,
    sum_nutrients,
)
from orbit_api.services.fitness.integrations import DayRecords, contribution
from orbit_api.services.fitness.models import (
    ExerciseSnapshot,
    ExerciseType,
    GoalCheckIn,
    Muscle,
    Nutrients,
    Owner,
    ProfileDraft,
    Session,
    SessionExercise,
    SessionStatus,
    SetType,
    SetValues,
    Targets,
    WorkoutSet,
)
from orbit_api.services.fitness.records import (
    Performed,
    analytics,
    estimated_1rm_g,
    exercise_point,
    personal_records,
    session_volume_g,
    set_volume_g,
    week_streak,
)

OWNER = Owner(uuid.uuid4(), uuid.uuid4())
BENCH = uuid.uuid4()
PLANK = uuid.uuid4()


def make_session(day: date, status: SessionStatus = "completed", duration_s: int = 3600) -> Session:
    start = datetime(day.year, day.month, day.day, 7, tzinfo=UTC)
    return Session(
        id=uuid.uuid4(),
        owner=OWNER,
        template_id=None,
        calendar_event_id=None,
        name="Workout",
        day=day,
        timezone="UTC",
        status=status,
        started_at=start,
        ended_at=start + timedelta(seconds=duration_s),
        paused_at=None,
        paused_seconds=0,
        duration_s=duration_s,
        notes="",
        created_at=start,
        updated_at=start,
    )


def make_exercise(
    session: Session,
    sets: list[SetValues],
    *,
    exercise_id: uuid.UUID | None = BENCH,
    exercise_type: ExerciseType = "weight_reps",
    name: str = "Bench press",
    muscles: tuple[Muscle, ...] = ("chest",),
) -> SessionExercise:
    return SessionExercise(
        id=uuid.uuid4(),
        session_id=session.id,
        exercise_id=exercise_id,
        position=0,
        snapshot=ExerciseSnapshot(
            name=name,
            exercise_type=exercise_type,
            category="strength",
            primary_muscles=muscles,
        ),
        rest_seconds=None,
        notes="",
        sets=tuple(
            WorkoutSet(id=uuid.uuid4(), position=n, values=v, completed_at=None)
            for n, v in enumerate(sets)
        ),
    )


def lift(
    weight_kg: float, reps: int, set_type: SetType = "working", done: bool = True
) -> SetValues:
    return SetValues(
        set_type=set_type,
        reps=reps,
        weight_g=round(weight_kg * 1000),
        completed=done,
    )


# Volume and estimates


def test_volume_counts_completed_non_warmup_sets_of_weighted_exercises() -> None:
    assert set_volume_g("weight_reps", lift(100, 5)) == 500_000
    assert set_volume_g("weight_reps", lift(60, 10, "warmup")) == 0
    assert set_volume_g("weight_reps", lift(100, 5, done=False)) == 0
    assert set_volume_g("weight_reps", lift(80, 8, "drop")) == 640_000
    assert set_volume_g("weight_reps", lift(80, 3, "failure")) == 240_000
    assert set_volume_g("reps", SetValues(reps=20, completed=True)) == 0
    session = make_session(date(2026, 1, 5))
    exercise = make_exercise(session, [lift(60, 10, "warmup"), lift(100, 5), lift(100, 5)])
    assert session_volume_g([exercise]) == 1_000_000


@pytest.mark.parametrize(
    ("weight_g", "reps", "expected"),
    [
        (100_000, 1, 100_000),
        (100_000, 5, 116_667),  # 100 * (1 + 5/30)
        (100_000, 10, 133_333),
        (100_000, 11, None),
        (100_000, 0, None),
        (0, 5, None),
    ],
)
def test_epley_estimate_only_for_one_to_ten_reps(
    weight_g: int, reps: int, expected: int | None
) -> None:
    assert estimated_1rm_g(weight_g, reps) == expected


# Records


def test_records_follow_exercise_type_and_ignore_warmups_and_abandoned_workouts() -> None:
    first = make_session(date(2026, 1, 5))
    second = make_session(date(2026, 1, 8))
    abandoned = make_session(date(2026, 1, 9), status="abandoned")
    performed = [
        Performed(first, make_exercise(first, [lift(140, 1, "warmup"), lift(100, 5)])),
        Performed(second, make_exercise(second, [lift(105, 3), lift(90, 12)])),
        Performed(abandoned, make_exercise(abandoned, [lift(200, 5)])),
        Performed(
            first,
            make_exercise(
                first,
                [SetValues(duration_s=90, completed=True)],
                exercise_id=PLANK,
                exercise_type="duration",
                name="Plank",
            ),
        ),
    ]
    records = {(r.exercise_id, r.kind): r for r in personal_records(performed)}

    assert set(records) == {
        (BENCH, "max_weight"),
        (BENCH, "max_reps"),
        (BENCH, "estimated_1rm"),
        (BENCH, "best_set_volume"),
        (PLANK, "max_duration"),
    }
    assert records[BENCH, "max_weight"].value == 105_000
    assert records[BENCH, "max_weight"].day == date(2026, 1, 8)
    assert records[BENCH, "max_reps"].value == 12
    # 100 kg x 5 estimates 116.7 kg; 105 x 3 estimates 115.5; 90 x 12 is beyond the formula.
    assert records[BENCH, "estimated_1rm"].value == 116_667
    assert records[BENCH, "estimated_1rm"].estimated is True
    assert records[BENCH, "max_weight"].estimated is False
    assert records[BENCH, "best_set_volume"].value == 1_080_000  # 90 kg x 12
    assert records[PLANK, "max_duration"].value == 90


def test_the_first_workout_to_reach_a_value_keeps_the_record() -> None:
    first = make_session(date(2026, 1, 5))
    second = make_session(date(2026, 1, 8))
    performed = [
        Performed(first, make_exercise(first, [lift(100, 5)])),
        Performed(second, make_exercise(second, [lift(100, 5)])),
    ]
    records = {r.kind: r for r in personal_records(performed)}
    assert records["max_weight"].session_id == first.id
    # More reps at the same weight does take it.
    third = make_session(date(2026, 1, 10))
    performed.append(Performed(third, make_exercise(third, [lift(100, 6)])))
    records = {r.kind: r for r in personal_records(performed)}
    assert records["max_weight"].session_id == third.id


def test_deleted_exercises_have_no_records() -> None:
    session = make_session(date(2026, 1, 5))
    item = make_exercise(session, [lift(100, 5)], exercise_id=None)
    assert personal_records([Performed(session, item)]) == []


def test_exercise_point_reports_only_metrics_that_apply() -> None:
    session = make_session(date(2026, 1, 5))
    lifted = exercise_point(Performed(session, make_exercise(session, [lift(100, 5)])))
    assert (lifted.max_weight_g, lifted.estimated_1rm_g, lifted.max_reps) == (100_000, 116_667, 5)
    assert lifted.max_duration_s is None
    run = exercise_point(
        Performed(
            session,
            make_exercise(
                session,
                [SetValues(distance_m=5000, duration_s=1500, completed=True)],
                exercise_type="distance_duration",
            ),
        )
    )
    assert (run.max_weight_g, run.estimated_1rm_g, run.max_reps) == (None, None, None)
    assert (run.max_distance_m, run.max_duration_s, run.volume_g) == (5000, 1500, 0)


# Analytics


def test_analytics_counts_weeks_months_muscles_and_consistency() -> None:
    days = [date(2026, 1, 5), date(2026, 1, 7), date(2026, 1, 20), date(2026, 2, 2)]
    sessions = [make_session(d) for d in days] + [make_session(date(2026, 1, 6), "abandoned")]
    exercises = {
        s.id: [make_exercise(s, [lift(100, 5), lift(60, 10, "warmup")], muscles=("chest",))]
        for s in sessions
    }
    result = analytics(
        sessions, exercises, date(2026, 1, 5), date(2026, 2, 8), date(2026, 2, 8), []
    )

    assert result.workouts == 4
    assert result.duration_s == 4 * 3600
    assert result.volume_g == 4 * 500_000
    assert [(w.start, w.workouts) for w in result.weekly] == [
        (date(2026, 1, 5), 2),
        (date(2026, 1, 12), 0),
        (date(2026, 1, 19), 1),
        (date(2026, 1, 26), 0),
        (date(2026, 2, 2), 1),
    ]
    assert [(m.start, m.workouts) for m in result.monthly] == [
        (date(2026, 1, 1), 3),
        (date(2026, 2, 1), 1),
    ]
    assert result.muscle_sets == {"chest": 4}
    assert (result.active_weeks, result.total_weeks) == (3, 5)
    assert result.current_week_streak == 1


def test_week_streak_does_not_break_during_the_current_week() -> None:
    days = [date(2026, 1, 5), date(2026, 1, 12), date(2026, 1, 19)]
    assert week_streak(days, date(2026, 1, 21)) == 3
    # Monday of the next week, nothing yet: the streak through last week still counts.
    assert week_streak(days, date(2026, 1, 26)) == 3
    # A whole week missed ends it.
    assert week_streak(days, date(2026, 2, 2)) == 0


# Body


@pytest.mark.parametrize(
    ("weight_g", "height_mm", "expected"),
    [
        (70_000, 1750, 22.9),
        (95_500, 1820, 28.8),
        (70_000, 400, None),
        (1_000, 1750, None),
    ],
)
def test_bmi_needs_plausible_values(weight_g: int, height_mm: int, expected: float | None) -> None:
    assert bmi(weight_g, height_mm) == expected


# Nutrition


def test_portions_scale_and_round_half_up_to_canonical_units() -> None:
    per_100g = Nutrients(
        energy_cal=52_000, protein_mg=300, carbs_mg=13_800, fat_mg=200, fiber_mg=None
    )
    portion = scale_nutrients(per_100g, quantity_milli=150_000, serving_milli=100_000)
    assert portion == Nutrients(energy_cal=78_000, protein_mg=450, carbs_mg=20_700, fat_mg=300)
    # One third of a serving: 52,000 / 3 = 17,333.3 rounds down; 13,800 / 3 = 4,600 exactly.
    third = scale_nutrients(per_100g, quantity_milli=1, serving_milli=3)
    assert (third.energy_cal, third.carbs_mg) == (17_333, 4_600)
    # Halves round up.
    assert scale_nutrients(Nutrients(energy_cal=1), 1, 2).energy_cal == 1


def test_daily_totals_are_exact_sums_and_keep_missing_fiber_missing() -> None:
    total = sum_nutrients(
        [Nutrients(energy_cal=100_000, fiber_mg=None), Nutrients(energy_cal=50_500, fiber_mg=None)]
    )
    assert total == Nutrients(energy_cal=150_500, fiber_mg=None)
    assert sum_nutrients([Nutrients(fiber_mg=2000), Nutrients()]).fiber_mg == 2000


# Goals


def test_goal_fraction_works_for_losing_and_gaining() -> None:
    assert goal_fraction(90_000, 80_000, 85_000) == 0.5
    assert goal_fraction(90_000, 80_000, 92_000) == 0
    assert goal_fraction(90_000, 80_000, 78_000) == 1
    assert goal_fraction(60, 100, 70) == 0.25
    assert goal_reached(90_000, 80_000, 80_000) is True
    assert goal_reached(60, 100, 99) is False


def test_milestones_have_expected_dates_and_the_first_day_they_were_reached() -> None:
    history = [
        GoalCheckIn(uuid.uuid4(), date(2026, 1, 10), 88_000, "", "manual"),
        GoalCheckIn(uuid.uuid4(), date(2026, 1, 20), 86_000, "", "manual"),
    ]
    result = milestones(90_000, 80_000, date(2026, 1, 1), date(2026, 5, 1), history)
    assert [m.value for m in result] == [87_500, 85_000, 82_500, 80_000]
    assert result[0].expected_by == date(2026, 1, 31)  # 120 days * 25%
    # 88 kg is 20% of the way; 86 kg (40%) reaches the first milestone but not the second.
    assert result[0].reached_on == date(2026, 1, 20)
    assert result[1].reached_on is None
    assert milestones(90_000, 80_000, date(2026, 1, 1), None, history)[0].expected_by is None


def test_pace_compares_progress_with_a_straight_line_to_the_target_date() -> None:
    start, target = date(2026, 1, 1), date(2026, 4, 11)  # 100 days
    assert goal_pace(0.5, False, start, target, date(2026, 2, 20)) == "on_track"  # day 50
    assert goal_pace(0.7, False, start, target, date(2026, 2, 20)) == "ahead"
    assert goal_pace(0.3, False, start, target, date(2026, 2, 20)) == "behind"
    assert goal_pace(0.3, False, start, None, date(2026, 2, 20)) == "no_target_date"
    assert goal_pace(1, True, start, target, date(2026, 2, 20)) == "reached"


# Habit contributions


def test_contributions_by_habit_kind_and_source() -> None:
    metric = ProfileDraft(targets=Targets(water_ml=2000))
    workout = DayRecords(count=2, seconds=5400)
    assert contribution("boolean", "workout", None, workout, metric) == (True, None)
    assert contribution("duration", "workout", None, workout, metric) == (True, 90.0)
    assert contribution("numeric", "workout", None, workout, metric) == (True, 2.0)
    assert contribution("boolean", "workout", None, DayRecords(), metric) == (False, None)

    assert contribution("boolean", "water", None, DayRecords(water_ml=1500), metric) == (
        False,
        None,
    )
    assert contribution("boolean", "water", None, DayRecords(water_ml=2000), metric) == (True, None)
    no_target = ProfileDraft()
    assert contribution("boolean", "water", None, DayRecords(water_ml=1), no_target) == (True, None)
    litres = ProfileDraft(water_unit="l")
    assert contribution("numeric", "water", None, DayRecords(water_ml=1750), litres) == (True, 1.75)
    assert contribution("duration", "water", None, DayRecords(water_ml=1750), litres) == (
        False,
        None,
    )

    steps = DayRecords(count=1, steps=8500)
    assert contribution("numeric", "activity", "steps", steps, metric) == (True, 8500.0)
    run = DayRecords(count=1, distance_m=8047, seconds=2700)
    assert contribution("numeric", "activity", "run", run, ProfileDraft(distance_unit="mi")) == (
        True,
        5.0,
    )
    assert contribution("duration", "activity", "run", run, metric) == (True, 45.0)
    sleep = DayRecords(count=1, seconds=27_000)
    assert contribution("numeric", "activity", "sleep", sleep, metric) == (True, 7.5)
