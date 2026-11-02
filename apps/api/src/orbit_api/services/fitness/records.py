"""Workout calculations as pure functions: set volume, estimated one-rep max, personal records,
exercise progression, and workout analytics.

Rules (documented in `docs/architecture.md#workout-calculations`):

- Only **completed** sets count, and **warm-up sets never count** toward volume or records.
  Working, drop, and failure sets all count.
- **Volume** is reps * weight, summed, and only for weight-and-reps exercises. Bodyweight,
  timed, and distance exercises have no volume (0), because their load isn't recorded.
- **Estimated one-rep max** uses the Epley formula, weight * (1 + reps / 30), only for sets of 1
  to 10 reps (a single is the weight itself). Above 10 reps the formula is unreliable, so no
  estimate is made. It's always labelled an estimate.
- **Records** apply by the exercise type recorded with the workout: weight and reps give max
  weight, max reps, estimated 1RM, and best set volume; reps give max reps; timed exercises give
  the longest duration; distance exercises give the longest distance and duration. The first
  workout to reach a value holds the record; equalling it later doesn't take it.
- Workouts count only when completed. Weeks are ISO weeks (Monday to Sunday).
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from orbit_api.services.fitness.models import (
    ExercisePoint,
    ExerciseType,
    PeriodCount,
    PersonalRecord,
    RecordKind,
    Session,
    SessionExercise,
    SetValues,
    WorkoutAnalytics,
    WorkoutSet,
)

MAX_ESTIMATE_REPS = 10
# Which records make sense for each exercise type.
RECORD_KINDS: dict[ExerciseType, tuple[RecordKind, ...]] = {
    "weight_reps": ("max_weight", "max_reps", "estimated_1rm", "best_set_volume"),
    "reps": ("max_reps",),
    "duration": ("max_duration",),
    "distance_duration": ("max_distance", "max_duration"),
}


def counts(values: SetValues) -> bool:
    """Whether a set counts toward volume and records."""
    return values.completed and values.set_type != "warmup"


def set_volume_g(exercise_type: ExerciseType, values: SetValues) -> int:
    if exercise_type != "weight_reps" or not counts(values):
        return 0
    return (values.reps or 0) * (values.weight_g or 0)


def exercise_volume_g(exercise: SessionExercise) -> int:
    return sum(set_volume_g(exercise.snapshot.exercise_type, s.values) for s in exercise.sets)


def session_volume_g(exercises: Iterable[SessionExercise]) -> int:
    return sum(exercise_volume_g(exercise) for exercise in exercises)


def estimated_1rm_g(weight_g: int, reps: int) -> int | None:
    """Epley's estimate, rounded to the gram, or `None` outside 1 to 10 reps or without load."""
    if weight_g <= 0 or not 1 <= reps <= MAX_ESTIMATE_REPS:
        return None
    if reps == 1:
        return weight_g
    return round(weight_g * (1 + reps / 30))


@dataclass(frozen=True, slots=True)
class Performed:
    """An exercise as performed in a completed workout."""

    session: Session
    exercise: SessionExercise


def _record_values(
    exercise_type: ExerciseType, values: SetValues
) -> dict[RecordKind, tuple[int, int | None, int | None]]:
    """Each applicable record's value for one set, with its reps and weight."""
    reps, weight = values.reps, values.weight_g
    result: dict[RecordKind, tuple[int, int | None, int | None]] = {}
    if exercise_type == "weight_reps":
        if weight is not None and weight > 0 and reps:
            result["max_weight"] = (weight, reps, weight)
            estimate = estimated_1rm_g(weight, reps)
            if estimate is not None:
                result["estimated_1rm"] = (estimate, reps, weight)
            result["best_set_volume"] = (weight * reps, reps, weight)
        if reps:
            result["max_reps"] = (reps, reps, weight)
    elif exercise_type == "reps":
        if reps:
            result["max_reps"] = (reps, reps, None)
    elif exercise_type == "duration":
        if values.duration_s:
            result["max_duration"] = (values.duration_s, None, None)
    else:
        if values.distance_m:
            result["max_distance"] = (values.distance_m, None, None)
        if values.duration_s:
            result["max_duration"] = (values.duration_s, None, None)
    return result


def _beats(
    kind: RecordKind, candidate: tuple[int, int | None, int | None], best: PersonalRecord
) -> bool:
    value, reps, weight = candidate
    if value != best.value:
        return value > best.value
    # Ties: a heavier max-reps set or more reps at a max weight is better.
    if kind == "max_weight":
        return (reps or 0) > (best.reps or 0)
    if kind == "max_reps":
        return (weight or 0) > (best.weight_g or 0)
    return False


def personal_records(performed: Iterable[Performed]) -> list[PersonalRecord]:
    """Every record per exercise across completed workouts. Exercises no longer in the library
    (no `exercise_id`) are skipped, since their history can't be grouped reliably."""
    ordered = sorted(performed, key=lambda p: (p.session.day, p.session.started_at))
    best: dict[tuple[uuid.UUID, RecordKind], PersonalRecord] = {}
    for item in ordered:
        exercise = item.exercise
        if exercise.exercise_id is None or item.session.status != "completed":
            continue
        for workout_set in exercise.sets:
            if not counts(workout_set.values):
                continue
            values = _record_values(exercise.snapshot.exercise_type, workout_set.values)
            for kind, candidate in values.items():
                key = (exercise.exercise_id, kind)
                current = best.get(key)
                if current is None or _beats(kind, candidate, current):
                    value, reps, weight = candidate
                    best[key] = PersonalRecord(
                        exercise_id=exercise.exercise_id,
                        exercise_name=exercise.snapshot.name,
                        kind=kind,
                        value=value,
                        reps=reps,
                        weight_g=weight,
                        day=item.session.day,
                        session_id=item.session.id,
                        estimated=kind == "estimated_1rm",
                    )
    return sorted(best.values(), key=lambda r: (r.exercise_name.casefold(), r.kind))


def exercise_point(item: Performed) -> ExercisePoint:
    """One workout's bests for an exercise."""
    exercise_type = item.exercise.snapshot.exercise_type
    counted = [s for s in item.exercise.sets if counts(s.values)]
    weights = [s.values.weight_g for s in counted if s.values.weight_g and s.values.reps]
    estimates = [
        e
        for s in counted
        if (e := estimated_1rm_g(s.values.weight_g or 0, s.values.reps or 0)) is not None
    ]
    reps = [s.values.reps for s in counted if s.values.reps]
    durations = [s.values.duration_s for s in counted if s.values.duration_s]
    distances = [s.values.distance_m for s in counted if s.values.distance_m]
    weighted = exercise_type == "weight_reps"
    return ExercisePoint(
        day=item.session.day,
        session_id=item.session.id,
        max_weight_g=max(weights) if weighted and weights else None,
        estimated_1rm_g=max(estimates) if weighted and estimates else None,
        volume_g=exercise_volume_g(item.exercise),
        max_reps=max(reps) if exercise_type in ("weight_reps", "reps") and reps else None,
        max_duration_s=max(durations)
        if exercise_type in ("duration", "distance_duration") and durations
        else None,
        max_distance_m=max(distances)
        if exercise_type == "distance_duration" and distances
        else None,
        sets=item.exercise.sets,
    )


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def month_start(day: date) -> date:
    return day.replace(day=1)


def _next_month(day: date) -> date:
    return date(day.year + day.month // 12, day.month % 12 + 1, 1)


def analytics(
    sessions: Sequence[Session],
    exercises: Mapping[uuid.UUID, Sequence[SessionExercise]],
    start: date,
    end: date,
    today: date,
    records: Sequence[PersonalRecord],
) -> WorkoutAnalytics:
    """Totals, weekly and monthly counts, muscle groups, and consistency for completed
    workouts on local dates `[start, end]`."""
    done = [s for s in sessions if s.status == "completed" and start <= s.day <= end]
    weekly: dict[date, list[int]] = {}
    week = week_start(start)
    while week <= end:
        weekly[week] = [0, 0, 0]
        week += timedelta(days=7)
    monthly: dict[date, list[int]] = {}
    month = month_start(start)
    while month <= end:
        monthly[month] = [0, 0, 0]
        month = _next_month(month)
    muscles: dict[str, int] = defaultdict(int)
    total_volume = 0
    for session in done:
        volume = session_volume_g(exercises.get(session.id, ()))
        total_volume += volume
        for bucket in (weekly[week_start(session.day)], monthly[month_start(session.day)]):
            bucket[0] += 1
            bucket[1] += session.duration_s or 0
            bucket[2] += volume
        for exercise in exercises.get(session.id, ()):
            sets = sum(1 for s in exercise.sets if counts(s.values))
            for muscle in exercise.snapshot.primary_muscles:
                muscles[muscle] += sets
    return WorkoutAnalytics(
        start=start,
        end=end,
        workouts=len(done),
        duration_s=sum(s.duration_s or 0 for s in done),
        volume_g=total_volume,
        weekly=tuple(PeriodCount(k, *v) for k, v in weekly.items()),
        monthly=tuple(PeriodCount(k, *v) for k, v in monthly.items()),
        muscle_sets=dict(sorted(muscles.items(), key=lambda m: (-m[1], m[0]))),
        active_weeks=sum(1 for v in weekly.values() if v[0] > 0),
        total_weeks=len(weekly),
        current_week_streak=week_streak(
            [s.day for s in sessions if s.status == "completed"], today
        ),
        records=tuple(records),
    )


def week_streak(days: Iterable[date], today: date) -> int:
    """Consecutive ISO weeks with a completed workout, ending this week. This week doesn't break
    the streak while it's still going, so a streak through last week still counts."""
    weeks = {week_start(day) for day in days}
    current = week_start(today)
    if current not in weeks:
        current -= timedelta(days=7)
    streak = 0
    while current in weeks:
        streak += 1
        current -= timedelta(days=7)
    return streak


def sets_completed(sets: Iterable[WorkoutSet]) -> int:
    return sum(1 for s in sets if s.values.completed)
