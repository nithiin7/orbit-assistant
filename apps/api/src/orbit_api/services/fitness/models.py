"""Health and fitness domain types and errors.

Values use integer canonical units: grams (`_g`), millimetres (`_mm`), metres (`_m`), seconds
(`_s`), millilitres (`_ml`), milligrams for nutrients (`_mg`), small calories for energy (`_cal`,
1 kcal = 1,000 cal), and thousandths for serving quantities (`_milli`). Clients convert to the
person's units for display and back on input.
"""

import uuid
from dataclasses import dataclass, field, fields
from datetime import date, datetime
from typing import Literal

from orbit_api.utils.changes import UNSET, Change

UnitSystem = Literal["metric", "imperial"]
WeightUnit = Literal["kg", "lb"]
LengthUnit = Literal["cm", "in"]
DistanceUnit = Literal["km", "mi"]
EnergyUnit = Literal["kcal", "kj"]
WaterUnit = Literal["ml", "l", "fl_oz"]
DashboardSection = Literal[
    "workout", "recent_workouts", "weight", "goals", "nutrition", "water", "activity", "records"
]

ExerciseCategory = Literal["strength", "cardio", "mobility", "flexibility", "bodyweight", "other"]
# Which values a set records, and so which records make sense.
ExerciseType = Literal["weight_reps", "reps", "duration", "distance_duration"]
Equipment = Literal[
    "barbell", "dumbbell", "cable", "machine", "kettlebell", "band", "bodyweight", "none", "other"
]
Muscle = Literal[
    "chest",
    "upper_back",
    "lats",
    "lower_back",
    "traps",
    "shoulders",
    "biceps",
    "triceps",
    "forearms",
    "abs",
    "obliques",
    "glutes",
    "quadriceps",
    "hamstrings",
    "calves",
    "hip_flexors",
    "adductors",
    "full_body",
]
TemplateCategory = Literal[
    "push", "pull", "legs", "upper", "lower", "full_body", "cardio", "mobility", "other"
]
SessionStatus = Literal["active", "paused", "completed", "abandoned"]
SetType = Literal["warmup", "working", "drop", "failure"]
MealType = Literal["breakfast", "lunch", "dinner", "snack", "other"]
ActivityKind = Literal["steps", "walk", "run", "cycle", "swim", "cardio", "sleep", "rest_day"]
GoalCategory = Literal[
    "body_weight",
    "strength",
    "workout_frequency",
    "running_distance",
    "running_duration",
    "nutrition",
    "water",
    "custom",
]
GoalStatus = Literal["active", "paused", "completed"]
HabitSource = Literal["workout", "water", "activity"]
LinkOwnerKind = Literal["session", "goal"]
LinkTargetKind = Literal["note", "document"]

MAX_TEMPLATE_EXERCISES = 30
MAX_SESSION_EXERCISES = 40
MAX_SETS_PER_EXERCISE = 30
MAX_MEAL_ITEMS = 30
MAX_QUICK_AMOUNTS = 6
DEFAULT_QUICK_AMOUNTS_ML = (250, 500, 750)
# Built-in goal units are canonical; custom goals name their own.
GOAL_UNITS: dict[GoalCategory, str] = {
    "body_weight": "g",
    "strength": "g",
    "workout_frequency": "workouts/week",
    "running_distance": "m",
    "running_duration": "s",
    "nutrition": "cal",
    "water": "ml",
    "custom": "",
}


@dataclass(frozen=True, slots=True)
class Owner:
    """Whose health data this is: one person in one workspace. Every query filters by both."""

    workspace_id: uuid.UUID
    user_id: uuid.UUID


# Profile


@dataclass(frozen=True, slots=True)
class Targets:
    energy_cal: int | None = None
    protein_mg: int | None = None
    carbs_mg: int | None = None
    fat_mg: int | None = None
    fiber_mg: int | None = None
    water_ml: int | None = None


@dataclass(frozen=True, slots=True)
class ProfileDraft:
    unit_system: UnitSystem = "metric"
    weight_unit: WeightUnit = "kg"
    length_unit: LengthUnit = "cm"
    distance_unit: DistanceUnit = "km"
    energy_unit: EnergyUnit = "kcal"
    water_unit: WaterUnit = "ml"
    height_mm: int | None = None
    date_of_birth: date | None = None
    targets: Targets = field(default_factory=Targets)
    water_quick_amounts_ml: tuple[int, ...] = DEFAULT_QUICK_AMOUNTS_ML
    hidden_sections: tuple[DashboardSection, ...] = ()


@dataclass(frozen=True, slots=True)
class Profile:
    id: uuid.UUID
    owner: Owner
    settings: ProfileDraft
    created_at: datetime
    updated_at: datetime


# Exercises


@dataclass(frozen=True, slots=True)
class ExerciseDraft:
    name: str
    category: ExerciseCategory
    exercise_type: ExerciseType
    equipment: Equipment
    description: str = ""
    instructions: str = ""
    primary_muscles: tuple[Muscle, ...] = ()
    secondary_muscles: tuple[Muscle, ...] = ()


@dataclass(frozen=True, slots=True)
class Exercise:
    id: uuid.UUID
    owner: Owner
    builtin_key: str | None
    details: ExerciseDraft
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @property
    def is_custom(self) -> bool:
        return self.builtin_key is None


# Templates


@dataclass(frozen=True, slots=True)
class TemplateExerciseDraft:
    exercise_id: uuid.UUID
    sets: int = 3
    target_reps_min: int | None = None
    target_reps_max: int | None = None
    target_weight_g: int | None = None
    target_duration_s: int | None = None
    target_distance_m: int | None = None
    rest_seconds: int | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class TemplateDraft:
    name: str
    category: TemplateCategory = "other"
    description: str = ""
    notes: str = ""
    exercises: tuple[TemplateExerciseDraft, ...] = ()


@dataclass(frozen=True, slots=True)
class TemplateExercise:
    id: uuid.UUID
    position: int
    exercise: Exercise
    plan: TemplateExerciseDraft


@dataclass(frozen=True, slots=True)
class Template:
    id: uuid.UUID
    owner: Owner
    name: str
    category: TemplateCategory
    description: str
    notes: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    exercises: tuple[TemplateExercise, ...] = ()


# Workouts


@dataclass(frozen=True, slots=True)
class SetValues:
    set_type: SetType = "working"
    reps: int | None = None
    weight_g: int | None = None
    duration_s: int | None = None
    distance_m: int | None = None
    rpe: float | None = None
    completed: bool = False


@dataclass(frozen=True, slots=True)
class WorkoutSet:
    id: uuid.UUID
    position: int
    values: SetValues
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class ExerciseSnapshot:
    """What an exercise was when it was added to a workout. History reads this, never the
    library, so renaming or retyping an exercise later doesn't rewrite past workouts."""

    name: str
    exercise_type: ExerciseType
    category: ExerciseCategory
    primary_muscles: tuple[Muscle, ...]


@dataclass(frozen=True, slots=True)
class SessionExercise:
    id: uuid.UUID
    session_id: uuid.UUID
    exercise_id: uuid.UUID | None
    position: int
    snapshot: ExerciseSnapshot
    rest_seconds: int | None
    notes: str
    sets: tuple[WorkoutSet, ...] = ()


@dataclass(frozen=True, slots=True)
class Session:
    id: uuid.UUID
    owner: Owner
    template_id: uuid.UUID | None
    calendar_event_id: uuid.UUID | None
    name: str
    day: date
    timezone: str
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None
    paused_at: datetime | None
    paused_seconds: int
    duration_s: int | None
    notes: str
    created_at: datetime
    updated_at: datetime

    @property
    def finished(self) -> bool:
        return self.status in ("completed", "abandoned")


@dataclass(frozen=True, slots=True)
class SessionSummary:
    """A workout in lists: totals without its sets."""

    session: Session
    exercise_count: int
    set_count: int
    volume_g: int


@dataclass(frozen=True, slots=True)
class PreviousPerformance:
    """The same exercise in the most recent other completed workout."""

    session_id: uuid.UUID
    day: date
    sets: tuple[WorkoutSet, ...]


@dataclass(frozen=True, slots=True)
class LinkedRecord:
    kind: LinkTargetKind
    id: uuid.UUID
    title: str


@dataclass(frozen=True, slots=True)
class SessionDetail:
    session: Session
    exercises: tuple[SessionExercise, ...]
    previous: dict[uuid.UUID, PreviousPerformance]
    volume_g: int
    links: tuple[LinkedRecord, ...]
    template_name: str | None


@dataclass(frozen=True, slots=True)
class SessionStart:
    """A new workout: from a template, from a scheduled calendar event, or empty."""

    day: date
    timezone: str
    name: str | None = None
    template_id: uuid.UUID | None = None
    calendar_event_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class SessionChanges:
    """A partial update of a workout. `UNSET` leaves a field as it is. Times can only change
    once a workout has ended."""

    name: Change[str] = UNSET
    notes: Change[str] = UNSET
    day: Change[date] = UNSET
    started_at: Change[datetime] = UNSET
    ended_at: Change[datetime] = UNSET


@dataclass(frozen=True, slots=True)
class LoggedExercise:
    exercise_id: uuid.UUID
    sets: tuple[SetValues, ...]
    notes: str = ""


@dataclass(frozen=True, slots=True)
class LoggedSession:
    """A finished workout recorded after the fact."""

    name: str
    day: date
    timezone: str
    started_at: datetime
    ended_at: datetime
    notes: str = ""
    template_id: uuid.UUID | None = None
    exercises: tuple[LoggedExercise, ...] = ()


# Records and analytics


RecordKind = Literal[
    "max_weight", "max_reps", "estimated_1rm", "best_set_volume", "max_duration", "max_distance"
]


@dataclass(frozen=True, slots=True)
class PersonalRecord:
    exercise_id: uuid.UUID
    exercise_name: str
    kind: RecordKind
    # In the record's unit: grams, reps, gram-reps, seconds, or metres.
    value: int
    # For weight records, the reps it was lifted for; for rep records, the weight.
    reps: int | None
    weight_g: int | None
    day: date
    session_id: uuid.UUID
    estimated: bool


@dataclass(frozen=True, slots=True)
class ExercisePoint:
    """One workout's best for an exercise, for progression charts."""

    day: date
    session_id: uuid.UUID
    max_weight_g: int | None
    estimated_1rm_g: int | None
    volume_g: int
    max_reps: int | None
    max_duration_s: int | None
    max_distance_m: int | None
    sets: tuple[WorkoutSet, ...]


@dataclass(frozen=True, slots=True)
class ExerciseHistory:
    exercise: Exercise
    points: tuple[ExercisePoint, ...]
    records: tuple[PersonalRecord, ...]


@dataclass(frozen=True, slots=True)
class PeriodCount:
    start: date
    workouts: int
    duration_s: int
    volume_g: int


@dataclass(frozen=True, slots=True)
class WorkoutAnalytics:
    start: date
    end: date
    workouts: int
    duration_s: int
    volume_g: int
    weekly: tuple[PeriodCount, ...]
    monthly: tuple[PeriodCount, ...]
    muscle_sets: dict[str, int]
    # Weeks in the range with at least one workout, over all weeks in the range.
    active_weeks: int
    total_weeks: int
    current_week_streak: int
    records: tuple[PersonalRecord, ...]


# Body


@dataclass(frozen=True, slots=True)
class MeasurementValues:
    weight_g: int | None = None
    body_fat_pct: float | None = None
    height_mm: int | None = None
    waist_mm: int | None = None
    chest_mm: int | None = None
    hips_mm: int | None = None
    arm_mm: int | None = None
    thigh_mm: int | None = None
    neck_mm: int | None = None

    def is_empty(self) -> bool:
        return all(getattr(self, item.name) is None for item in fields(self))


@dataclass(frozen=True, slots=True)
class MeasurementDraft:
    day: date
    values: MeasurementValues
    note: str = ""


@dataclass(frozen=True, slots=True)
class Measurement:
    id: uuid.UUID
    owner: Owner
    day: date
    values: MeasurementValues
    note: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Bmi:
    """Body mass index from the latest weight and height. A general measure only."""

    value: float
    weight_g: int
    height_mm: int
    weight_day: date


@dataclass(frozen=True, slots=True)
class Photo:
    id: uuid.UUID
    owner: Owner
    day: date
    note: str
    blob_id: uuid.UUID
    content_type: str
    size_bytes: int
    created_at: datetime


# Nutrition


@dataclass(frozen=True, slots=True)
class Nutrients:
    energy_cal: int = 0
    protein_mg: int = 0
    carbs_mg: int = 0
    fat_mg: int = 0
    fiber_mg: int | None = None

    def __add__(self, other: "Nutrients") -> "Nutrients":
        fiber = (
            None
            if self.fiber_mg is None and other.fiber_mg is None
            else (self.fiber_mg or 0) + (other.fiber_mg or 0)
        )
        return Nutrients(
            energy_cal=self.energy_cal + other.energy_cal,
            protein_mg=self.protein_mg + other.protein_mg,
            carbs_mg=self.carbs_mg + other.carbs_mg,
            fat_mg=self.fat_mg + other.fat_mg,
            fiber_mg=fiber,
        )


@dataclass(frozen=True, slots=True)
class FoodDraft:
    name: str
    serving_quantity_milli: int
    serving_unit: str
    nutrients: Nutrients


@dataclass(frozen=True, slots=True)
class Food:
    id: uuid.UUID
    owner: Owner
    details: FoodDraft
    use_count: int
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PortionDraft:
    """An amount of food: from a saved food (nutrients scaled to the quantity), or typed in."""

    quantity_milli: int
    food_id: uuid.UUID | None = None
    name: str | None = None
    serving_unit: str | None = None
    nutrients: Nutrients | None = None


@dataclass(frozen=True, slots=True)
class Portion:
    food_id: uuid.UUID | None
    name: str
    quantity_milli: int
    serving_unit: str
    nutrients: Nutrients


@dataclass(frozen=True, slots=True)
class MealDraft:
    name: str
    items: tuple[PortionDraft, ...]


@dataclass(frozen=True, slots=True)
class SavedMeal:
    id: uuid.UUID
    owner: Owner
    name: str
    items: tuple[Portion, ...]
    created_at: datetime
    updated_at: datetime

    @property
    def totals(self) -> Nutrients:
        total = Nutrients()
        for item in self.items:
            total = total + item.nutrients
        return total


@dataclass(frozen=True, slots=True)
class FoodEntryDraft:
    day: date
    meal: MealType
    portion: PortionDraft
    note: str = ""


@dataclass(frozen=True, slots=True)
class FoodEntry:
    id: uuid.UUID
    owner: Owner
    day: date
    meal: MealType
    portion: Portion
    note: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class NutritionDay:
    day: date
    entries: tuple[FoodEntry, ...]
    totals: Nutrients
    by_meal: dict[MealType, Nutrients]
    targets: Targets


@dataclass(frozen=True, slots=True)
class DayTotal:
    day: date
    nutrients: Nutrients
    entries: int


@dataclass(frozen=True, slots=True)
class WaterEntry:
    id: uuid.UUID
    owner: Owner
    day: date
    amount_ml: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class WaterDay:
    day: date
    entries: tuple[WaterEntry, ...]
    total_ml: int
    target_ml: int | None


# Activity


@dataclass(frozen=True, slots=True)
class ActivityDraft:
    day: date
    kind: ActivityKind
    steps: int | None = None
    distance_m: int | None = None
    duration_s: int | None = None
    note: str = ""


@dataclass(frozen=True, slots=True)
class Activity:
    id: uuid.UUID
    owner: Owner
    details: ActivityDraft
    source: Literal["manual"]
    created_at: datetime
    updated_at: datetime


# Goals


@dataclass(frozen=True, slots=True)
class GoalDraft:
    name: str
    category: GoalCategory
    start_value: float
    target_value: float
    start_date: date
    unit: str = ""
    description: str = ""
    target_date: date | None = None
    auto_track: bool = False
    exercise_id: uuid.UUID | None = None
    habit_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class Goal:
    id: uuid.UUID
    owner: Owner
    details: GoalDraft
    status: GoalStatus
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class GoalCheckIn:
    id: uuid.UUID
    day: date
    value: float
    note: str
    # `manual` check-ins can be deleted; others are read from the records they come from.
    source: Literal["manual", "measurement", "workout"]


@dataclass(frozen=True, slots=True)
class Milestone:
    fraction: float
    value: float
    # Where a straight line from start to target puts this milestone, if there's a target date.
    expected_by: date | None
    reached_on: date | None


GoalPace = Literal["ahead", "on_track", "behind", "no_target_date", "reached"]


@dataclass(frozen=True, slots=True)
class GoalProgress:
    goal: Goal
    current_value: float
    # 0 to 1, how far from the start value to the target the current value is.
    fraction: float
    reached: bool
    pace: GoalPace
    history: tuple[GoalCheckIn, ...]
    milestones: tuple[Milestone, ...]
    links: tuple[LinkedRecord, ...] = ()
    habit_name: str | None = None
    exercise_name: str | None = None


# Integrations


@dataclass(frozen=True, slots=True)
class HabitLink:
    id: uuid.UUID
    habit_id: uuid.UUID
    habit_name: str
    habit_kind: str
    source: HabitSource
    activity_kind: ActivityKind | None
    contributes: bool


@dataclass(frozen=True, slots=True)
class HabitLinkDraft:
    habit_id: uuid.UUID
    source: HabitSource
    activity_kind: ActivityKind | None = None
    contributes: bool = False


@dataclass(frozen=True, slots=True)
class ScheduledWorkout:
    """A calendar event that schedules a workout, with its next or matching occurrence."""

    calendar_event_id: uuid.UUID
    title: str
    template_id: uuid.UUID | None
    template_name: str | None
    start_at: datetime | None
    end_at: datetime | None
    session_ids: tuple[uuid.UUID, ...]


# Overview


@dataclass(frozen=True, slots=True)
class WeightPoint:
    day: date
    weight_g: int


@dataclass(frozen=True, slots=True)
class Overview:
    day: date
    active_session: Session | None
    completed_today: tuple[SessionSummary, ...]
    scheduled_today: tuple[ScheduledWorkout, ...]
    recent_sessions: tuple[SessionSummary, ...]
    week_workouts: int
    weight_trend: tuple[WeightPoint, ...]
    goals: tuple[GoalProgress, ...]
    nutrition: Nutrients
    targets: Targets
    water_ml: int
    recent_activities: tuple[Activity, ...]
    records: tuple[PersonalRecord, ...]
    hidden_sections: tuple[DashboardSection, ...]


# Errors


class FitnessNotFoundError(Exception):
    """A record doesn't exist for this person in this workspace."""

    def __init__(self, what: str) -> None:
        super().__init__(what)
        self.what = what


class InvalidFitnessError(ValueError):
    """A value or reference was refused; the message is safe to show."""


class FitnessConflictError(Exception):
    """The request conflicts with the current state; the message is safe to show."""
