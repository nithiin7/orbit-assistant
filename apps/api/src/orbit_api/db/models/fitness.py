"""Health and fitness: a profile with unit preferences and targets, an exercise library, workout
templates, workout sessions with copies of their exercises and sets, body measurements, progress
photos, foods, saved meals, food and water entries, activity entries, fitness goals with their
progress, and links to habits, calendar events, notes, and documents.

Health data is personal: every top-level row carries the owning `user_id` as well as its
`workspace_id`, and the repository filters by both, so a record is never visible to anyone but
its owner even in a workspace that someone else can open.

Measurements use integer canonical units, never floats: grams (`_g`), millimetres (`_mm`),
metres (`_m`), seconds (`_s`), millilitres (`_ml`), milligrams for nutrients (`_mg`), small
calories for energy (`_cal`, 1 kcal = 1,000 cal), and thousandths for serving quantities
(`_milli`). Conversion to the person's units happens at the edges.

Relationships inside the module are composite foreign keys on `(id, workspace_id)`. Snapshots
(a session's exercise names and types, food entries' nutrients) are copied, so editing or
deleting a library item never changes history; their links back are plain foreign keys that
clear when the item is deleted.
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

EXERCISE_CATEGORIES = "('strength', 'cardio', 'mobility', 'flexibility', 'bodyweight', 'other')"
EXERCISE_TYPES = "('weight_reps', 'reps', 'duration', 'distance_duration')"
EQUIPMENT = (
    "('barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'band', 'bodyweight', 'none',"
    " 'other')"
)
TEMPLATE_CATEGORIES = (
    "('push', 'pull', 'legs', 'upper', 'lower', 'full_body', 'cardio', 'mobility', 'other')"
)
SESSION_STATUSES = "('active', 'paused', 'completed', 'abandoned')"
SET_TYPES = "('warmup', 'working', 'drop', 'failure')"
MEALS = "('breakfast', 'lunch', 'dinner', 'snack', 'other')"
ACTIVITY_KINDS = "('steps', 'walk', 'run', 'cycle', 'swim', 'cardio', 'sleep', 'rest_day')"
GOAL_CATEGORIES = (
    "('body_weight', 'strength', 'workout_frequency', 'running_distance', 'running_duration',"
    " 'nutrition', 'water', 'custom')"
)
GOAL_STATUSES = "('active', 'paused', 'completed')"
UNFINISHED_SESSION = "status IN ('active', 'paused')"
MEASUREMENT_FIELDS = (
    "weight_g",
    "body_fat_pct",
    "height_mm",
    "waist_mm",
    "chest_mm",
    "hips_mm",
    "arm_mm",
    "thigh_mm",
    "neck_mm",
)


def _owner_fk() -> Any:
    return ForeignKey("users.id", ondelete="CASCADE")


def _workspace_fk() -> Any:
    return ForeignKey("workspaces.id", ondelete="CASCADE")


def _composite(column: str, table: str, name: str, *, cascade: bool = True) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        [column, "workspace_id"],
        [f"{table}.id", f"{table}.workspace_id"],
        ondelete="CASCADE" if cascade else None,
        name=name,
    )


class FitnessProfileModel(Base):
    """A person's units, optional height and date of birth, daily targets, and dashboard
    preferences, one per person and workspace."""

    __tablename__ = "fitness_profiles"
    __table_args__ = (
        CheckConstraint("unit_system IN ('metric', 'imperial')", name="unit_system"),
        CheckConstraint("weight_unit IN ('kg', 'lb')", name="weight_unit"),
        CheckConstraint("length_unit IN ('cm', 'in')", name="length_unit"),
        CheckConstraint("distance_unit IN ('km', 'mi')", name="distance_unit"),
        CheckConstraint("energy_unit IN ('kcal', 'kj')", name="energy_unit"),
        CheckConstraint("water_unit IN ('ml', 'l', 'fl_oz')", name="water_unit"),
        CheckConstraint("height_mm IS NULL OR height_mm BETWEEN 500 AND 2720", name="height"),
        CheckConstraint(
            "energy_target_cal IS NULL OR energy_target_cal BETWEEN 1 AND 20000000",
            name="energy_target",
        ),
        CheckConstraint(
            "water_target_ml IS NULL OR water_target_ml BETWEEN 1 AND 20000", name="water_target"
        ),
        UniqueConstraint("workspace_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    unit_system: Mapped[str] = mapped_column(String(16))
    weight_unit: Mapped[str] = mapped_column(String(8))
    length_unit: Mapped[str] = mapped_column(String(8))
    distance_unit: Mapped[str] = mapped_column(String(8))
    energy_unit: Mapped[str] = mapped_column(String(8))
    water_unit: Mapped[str] = mapped_column(String(8))
    height_mm: Mapped[int | None] = mapped_column(Integer)
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    energy_target_cal: Mapped[int | None] = mapped_column(Integer)
    protein_target_mg: Mapped[int | None] = mapped_column(Integer)
    carbs_target_mg: Mapped[int | None] = mapped_column(Integer)
    fat_target_mg: Mapped[int | None] = mapped_column(Integer)
    fiber_target_mg: Mapped[int | None] = mapped_column(Integer)
    water_target_ml: Mapped[int | None] = mapped_column(Integer)
    water_quick_amounts_ml: Mapped[list[int]] = mapped_column(JSON)
    hidden_sections: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessExerciseModel(Base):
    """An exercise in a person's library: a built-in one (`builtin_key`, created on first use)
    or their own."""

    __tablename__ = "fitness_exercises"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
        CheckConstraint("length(instructions) <= 5000", name="instructions_length"),
        CheckConstraint(f"category IN {EXERCISE_CATEGORIES}", name="category"),
        CheckConstraint(f"exercise_type IN {EXERCISE_TYPES}", name="exercise_type"),
        CheckConstraint(f"equipment IN {EQUIPMENT}", name="equipment"),
        CheckConstraint("is_custom = (builtin_key IS NULL)", name="custom_or_builtin"),
        UniqueConstraint("id", "workspace_id"),
        # NULLs are distinct, so this only constrains built-ins: each is created once.
        UniqueConstraint(
            "workspace_id", "user_id", "builtin_key", name="uq_fitness_exercises_builtin"
        ),
        Index("ix_fitness_exercises_owner_name", "workspace_id", "user_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    builtin_key: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(100))
    normalized_name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    instructions: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(16))
    exercise_type: Mapped[str] = mapped_column(String(24))
    equipment: Mapped[str] = mapped_column(String(16))
    primary_muscles: Mapped[list[str]] = mapped_column(JSON)
    secondary_muscles: Mapped[list[str]] = mapped_column(JSON)
    is_custom: Mapped[bool]
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessTemplateModel(Base):
    __tablename__ = "fitness_templates"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
        CheckConstraint("length(notes) <= 5000", name="notes_length"),
        CheckConstraint(f"category IN {TEMPLATE_CATEGORIES}", name="category"),
        UniqueConstraint("id", "workspace_id"),
        Index("ix_fitness_templates_owner", "workspace_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessTemplateExerciseModel(Base):
    """An exercise in a template, in order, with its defaults."""

    __tablename__ = "fitness_template_exercises"
    __table_args__ = (
        CheckConstraint("sets BETWEEN 1 AND 20", name="sets"),
        CheckConstraint(
            "target_reps_min IS NULL OR target_reps_min BETWEEN 1 AND 1000", name="reps_min"
        ),
        CheckConstraint(
            "target_reps_max IS NULL OR (target_reps_max BETWEEN 1 AND 1000"
            " AND (target_reps_min IS NULL OR target_reps_max >= target_reps_min))",
            name="reps_max",
        ),
        CheckConstraint("target_weight_g IS NULL OR target_weight_g >= 0", name="weight"),
        CheckConstraint("target_duration_s IS NULL OR target_duration_s > 0", name="duration"),
        CheckConstraint("target_distance_m IS NULL OR target_distance_m > 0", name="distance"),
        CheckConstraint("rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600", name="rest"),
        CheckConstraint("length(notes) <= 1000", name="notes_length"),
        _composite("template_id", "fitness_templates", "fk_fitness_template_exercises_template"),
        # No ON DELETE action: an exercise used by a template can't be deleted (archive it).
        _composite(
            "exercise_id",
            "fitness_exercises",
            "fk_fitness_template_exercises_exercise",
            cascade=False,
        ),
        Index("ix_fitness_template_exercises_template", "template_id", "position"),
        Index("ix_fitness_template_exercises_exercise", "exercise_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    template_id: Mapped[uuid.UUID]
    exercise_id: Mapped[uuid.UUID]
    position: Mapped[int] = mapped_column(Integer)
    sets: Mapped[int] = mapped_column(Integer)
    target_reps_min: Mapped[int | None] = mapped_column(Integer)
    target_reps_max: Mapped[int | None] = mapped_column(Integer)
    target_weight_g: Mapped[int | None] = mapped_column(Integer)
    target_duration_s: Mapped[int | None] = mapped_column(Integer)
    target_distance_m: Mapped[int | None] = mapped_column(Integer)
    rest_seconds: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text)


class FitnessSessionModel(Base):
    """One workout. At most one is unfinished (active or paused) per person and workspace."""

    __tablename__ = "fitness_sessions"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(notes) <= 5000", name="notes_length"),
        CheckConstraint("length(timezone) BETWEEN 1 AND 64", name="timezone_length"),
        CheckConstraint(f"status IN {SESSION_STATUSES}", name="status"),
        CheckConstraint(
            "(status IN ('active', 'paused') AND ended_at IS NULL)"
            " OR (status IN ('completed', 'abandoned') AND ended_at IS NOT NULL)",
            name="ended_matches_status",
        ),
        CheckConstraint("(status = 'paused') = (paused_at IS NOT NULL)", name="paused_at"),
        CheckConstraint("paused_seconds >= 0", name="paused_seconds"),
        CheckConstraint("ended_at IS NULL OR ended_at >= started_at", name="ended_after_start"),
        CheckConstraint("duration_s IS NULL OR duration_s >= 0", name="duration"),
        UniqueConstraint("id", "workspace_id"),
        Index("ix_fitness_sessions_owner_day", "workspace_id", "user_id", "day"),
        Index("ix_fitness_sessions_event", "calendar_event_id"),
        Index(
            "uq_fitness_sessions_unfinished",
            "workspace_id",
            "user_id",
            unique=True,
            sqlite_where=text(UNFINISHED_SESSION),
            postgresql_where=text(UNFINISHED_SESSION),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fitness_templates.id", ondelete="SET NULL")
    )
    calendar_event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("calendar_events.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(100))
    day: Mapped[date] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    paused_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    paused_seconds: Mapped[int] = mapped_column(Integer)
    duration_s: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessSessionExerciseModel(Base):
    """An exercise in a workout, with a snapshot of the library entry when it was added."""

    __tablename__ = "fitness_session_exercises"
    __table_args__ = (
        CheckConstraint("length(exercise_name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint(f"exercise_type IN {EXERCISE_TYPES}", name="exercise_type"),
        CheckConstraint(f"exercise_category IN {EXERCISE_CATEGORIES}", name="exercise_category"),
        CheckConstraint("rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600", name="rest"),
        CheckConstraint("length(notes) <= 1000", name="notes_length"),
        UniqueConstraint("id", "workspace_id"),
        _composite("session_id", "fitness_sessions", "fk_fitness_session_exercises_session"),
        Index("ix_fitness_session_exercises_session", "session_id", "position"),
        Index("ix_fitness_session_exercises_exercise", "exercise_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    session_id: Mapped[uuid.UUID]
    exercise_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fitness_exercises.id", ondelete="SET NULL")
    )
    position: Mapped[int] = mapped_column(Integer)
    exercise_name: Mapped[str] = mapped_column(String(100))
    exercise_type: Mapped[str] = mapped_column(String(24))
    exercise_category: Mapped[str] = mapped_column(String(16))
    primary_muscles: Mapped[list[str]] = mapped_column(JSON)
    rest_seconds: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text)


class FitnessSetModel(Base):
    __tablename__ = "fitness_sets"
    __table_args__ = (
        CheckConstraint(f"set_type IN {SET_TYPES}", name="set_type"),
        CheckConstraint("reps IS NULL OR reps BETWEEN 0 AND 10000", name="reps"),
        CheckConstraint("weight_g IS NULL OR weight_g BETWEEN 0 AND 2000000", name="weight"),
        CheckConstraint("duration_s IS NULL OR duration_s BETWEEN 0 AND 172800", name="duration"),
        CheckConstraint("distance_m IS NULL OR distance_m BETWEEN 0 AND 1000000", name="distance"),
        CheckConstraint("rpe IS NULL OR rpe BETWEEN 1 AND 10", name="rpe"),
        CheckConstraint("completed = (completed_at IS NOT NULL)", name="completed_at"),
        _composite(
            "session_exercise_id",
            "fitness_session_exercises",
            "fk_fitness_sets_session_exercise",
        ),
        Index("ix_fitness_sets_session_exercise", "session_exercise_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    session_exercise_id: Mapped[uuid.UUID]
    position: Mapped[int] = mapped_column(Integer)
    set_type: Mapped[str] = mapped_column(String(16))
    reps: Mapped[int | None] = mapped_column(Integer)
    weight_g: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[int | None] = mapped_column(Integer)
    distance_m: Mapped[int | None] = mapped_column(Integer)
    rpe: Mapped[float | None] = mapped_column(Float)
    completed: Mapped[bool]
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class FitnessMeasurementModel(Base):
    """Body measurements taken on one date. Any subset of the values; at least one."""

    __tablename__ = "fitness_measurements"
    __table_args__ = (
        CheckConstraint(
            " OR ".join(f"{field} IS NOT NULL" for field in MEASUREMENT_FIELDS), name="any_value"
        ),
        CheckConstraint("weight_g IS NULL OR weight_g BETWEEN 1000 AND 650000", name="weight"),
        CheckConstraint(
            "body_fat_pct IS NULL OR (body_fat_pct > 0 AND body_fat_pct < 100)", name="body_fat"
        ),
        CheckConstraint("height_mm IS NULL OR height_mm BETWEEN 500 AND 2720", name="height"),
        *(
            CheckConstraint(f"{field} IS NULL OR {field} BETWEEN 10 AND 3000", name=field)
            for field in ("waist_mm", "chest_mm", "hips_mm", "arm_mm", "thigh_mm", "neck_mm")
        ),
        CheckConstraint("length(note) <= 1000", name="note_length"),
        Index("ix_fitness_measurements_owner_day", "workspace_id", "user_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    day: Mapped[date] = mapped_column(Date)
    weight_g: Mapped[int | None] = mapped_column(Integer)
    body_fat_pct: Mapped[float | None] = mapped_column(Float)
    height_mm: Mapped[int | None] = mapped_column(Integer)
    waist_mm: Mapped[int | None] = mapped_column(Integer)
    chest_mm: Mapped[int | None] = mapped_column(Integer)
    hips_mm: Mapped[int | None] = mapped_column(Integer)
    arm_mm: Mapped[int | None] = mapped_column(Integer)
    thigh_mm: Mapped[int | None] = mapped_column(Integer)
    neck_mm: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessPhotoModel(Base):
    """A progress photo. The image lives in the attachment store under `blob_id`."""

    __tablename__ = "fitness_photos"
    __table_args__ = (
        CheckConstraint("length(note) <= 1000", name="note_length"),
        CheckConstraint("size_bytes > 0", name="size"),
        UniqueConstraint("blob_id"),
        Index("ix_fitness_photos_owner_day", "workspace_id", "user_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    day: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(Text)
    blob_id: Mapped[uuid.UUID]
    content_type: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


def _nutrient_checks(prefix: str) -> tuple[CheckConstraint, ...]:
    return (
        CheckConstraint("energy_cal BETWEEN 0 AND 100000000", name=f"{prefix}energy"),
        CheckConstraint(
            "protein_mg >= 0 AND carbs_mg >= 0 AND fat_mg >= 0"
            " AND (fiber_mg IS NULL OR fiber_mg >= 0)",
            name=f"{prefix}nutrients",
        ),
    )


class FitnessFoodModel(Base):
    """A saved food: its nutrients for one serving of `serving_quantity_milli` units."""

    __tablename__ = "fitness_foods"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(serving_unit) BETWEEN 1 AND 20", name="serving_unit_length"),
        CheckConstraint("serving_quantity_milli > 0", name="serving_quantity"),
        CheckConstraint("use_count >= 0", name="use_count"),
        *_nutrient_checks(""),
        UniqueConstraint("id", "workspace_id"),
        Index("ix_fitness_foods_owner_name", "workspace_id", "user_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    name: Mapped[str] = mapped_column(String(100))
    normalized_name: Mapped[str] = mapped_column(String(100))
    serving_quantity_milli: Mapped[int] = mapped_column(Integer)
    serving_unit: Mapped[str] = mapped_column(String(20))
    energy_cal: Mapped[int] = mapped_column(Integer)
    protein_mg: Mapped[int] = mapped_column(Integer)
    carbs_mg: Mapped[int] = mapped_column(Integer)
    fat_mg: Mapped[int] = mapped_column(Integer)
    fiber_mg: Mapped[int | None] = mapped_column(Integer)
    use_count: Mapped[int] = mapped_column(Integer)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessMealModel(Base):
    """A saved meal: a named list of items to log together."""

    __tablename__ = "fitness_meals"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        UniqueConstraint("id", "workspace_id"),
        Index("ix_fitness_meals_owner", "workspace_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessMealItemModel(Base):
    __tablename__ = "fitness_meal_items"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(serving_unit) BETWEEN 1 AND 20", name="serving_unit_length"),
        CheckConstraint("quantity_milli > 0", name="quantity"),
        *_nutrient_checks(""),
        _composite("meal_id", "fitness_meals", "fk_fitness_meal_items_meal"),
        Index("ix_fitness_meal_items_meal", "meal_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    meal_id: Mapped[uuid.UUID]
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fitness_foods.id", ondelete="SET NULL")
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(100))
    quantity_milli: Mapped[int] = mapped_column(Integer)
    serving_unit: Mapped[str] = mapped_column(String(20))
    energy_cal: Mapped[int] = mapped_column(Integer)
    protein_mg: Mapped[int] = mapped_column(Integer)
    carbs_mg: Mapped[int] = mapped_column(Integer)
    fat_mg: Mapped[int] = mapped_column(Integer)
    fiber_mg: Mapped[int | None] = mapped_column(Integer)


class FitnessFoodEntryModel(Base):
    """Something eaten on a date, with its nutrients copied at the time."""

    __tablename__ = "fitness_food_entries"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(serving_unit) BETWEEN 1 AND 20", name="serving_unit_length"),
        CheckConstraint("length(note) <= 1000", name="note_length"),
        CheckConstraint("quantity_milli > 0", name="quantity"),
        CheckConstraint(f"meal IN {MEALS}", name="meal"),
        *_nutrient_checks(""),
        Index("ix_fitness_food_entries_owner_day", "workspace_id", "user_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    day: Mapped[date] = mapped_column(Date)
    meal: Mapped[str] = mapped_column(String(16))
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fitness_foods.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(100))
    quantity_milli: Mapped[int] = mapped_column(Integer)
    serving_unit: Mapped[str] = mapped_column(String(20))
    energy_cal: Mapped[int] = mapped_column(Integer)
    protein_mg: Mapped[int] = mapped_column(Integer)
    carbs_mg: Mapped[int] = mapped_column(Integer)
    fat_mg: Mapped[int] = mapped_column(Integer)
    fiber_mg: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessWaterEntryModel(Base):
    __tablename__ = "fitness_water_entries"
    __table_args__ = (
        CheckConstraint("amount_ml BETWEEN 1 AND 10000", name="amount"),
        Index("ix_fitness_water_entries_owner_day", "workspace_id", "user_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    day: Mapped[date] = mapped_column(Date)
    amount_ml: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessActivityModel(Base):
    """A day's activity, recorded by hand (`source = 'manual'`; imports would say otherwise)."""

    __tablename__ = "fitness_activities"
    __table_args__ = (
        CheckConstraint(f"kind IN {ACTIVITY_KINDS}", name="kind"),
        CheckConstraint("source IN ('manual')", name="source"),
        CheckConstraint("steps IS NULL OR steps BETWEEN 1 AND 200000", name="steps"),
        CheckConstraint("distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000", name="distance"),
        CheckConstraint("duration_s IS NULL OR duration_s BETWEEN 1 AND 86400", name="duration"),
        CheckConstraint("length(note) <= 1000", name="note_length"),
        CheckConstraint(
            "(kind = 'steps' AND steps IS NOT NULL)"
            " OR (kind = 'rest_day' AND steps IS NULL AND distance_m IS NULL"
            " AND duration_s IS NULL)"
            " OR (kind = 'sleep' AND duration_s IS NOT NULL AND steps IS NULL"
            " AND distance_m IS NULL)"
            " OR (kind IN ('walk', 'run', 'cycle', 'swim', 'cardio')"
            " AND (distance_m IS NOT NULL OR duration_s IS NOT NULL))",
            name="values_match_kind",
        ),
        Index("ix_fitness_activities_owner_day", "workspace_id", "user_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    day: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16))
    steps: Mapped[int | None] = mapped_column(Integer)
    distance_m: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessGoalModel(Base):
    """A measurable goal. Values are in the goal's unit (canonical units for built-in kinds)."""

    __tablename__ = "fitness_goals"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
        CheckConstraint("length(unit) BETWEEN 1 AND 20", name="unit_length"),
        CheckConstraint(f"category IN {GOAL_CATEGORIES}", name="category"),
        CheckConstraint(f"status IN {GOAL_STATUSES}", name="status"),
        CheckConstraint("target_value <> start_value", name="target_differs"),
        CheckConstraint("target_date IS NULL OR target_date > start_date", name="dates"),
        CheckConstraint("(status = 'completed') = (completed_at IS NOT NULL)", name="completed_at"),
        UniqueConstraint("id", "workspace_id"),
        Index("ix_fitness_goals_owner_status", "workspace_id", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(24))
    unit: Mapped[str] = mapped_column(String(20))
    start_value: Mapped[float] = mapped_column(Float)
    target_value: Mapped[float] = mapped_column(Float)
    start_date: Mapped[date] = mapped_column(Date)
    target_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16))
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    auto_track: Mapped[bool]
    exercise_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fitness_exercises.id", ondelete="SET NULL")
    )
    habit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("habits.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessGoalProgressModel(Base):
    """A progress check-in on a goal: the value on a date."""

    __tablename__ = "fitness_goal_progress"
    __table_args__ = (
        CheckConstraint("length(note) <= 1000", name="note_length"),
        _composite("goal_id", "fitness_goals", "fk_fitness_goal_progress_goal"),
        Index("ix_fitness_goal_progress_goal_day", "goal_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    goal_id: Mapped[uuid.UUID]
    day: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessHabitLinkModel(Base):
    """A habit related to a kind of health record. With `contributes`, recording that kind
    of record also records progress on the habit. One link per habit, so a day is never
    counted twice."""

    __tablename__ = "fitness_habit_links"
    __table_args__ = (
        CheckConstraint("source IN ('workout', 'water', 'activity')", name="source"),
        CheckConstraint(
            "(source = 'activity') = (activity_kind IS NOT NULL)", name="activity_kind"
        ),
        CheckConstraint(
            f"activity_kind IS NULL OR activity_kind IN {ACTIVITY_KINDS}",
            name="activity_kind_value",
        ),
        UniqueConstraint("habit_id"),
        _composite("habit_id", "habits", "fk_fitness_habit_links_habit"),
        Index("ix_fitness_habit_links_owner", "workspace_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    habit_id: Mapped[uuid.UUID]
    source: Mapped[str] = mapped_column(String(16))
    activity_kind: Mapped[str | None] = mapped_column(String(16))
    contributes: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessWorkoutEventModel(Base):
    """A calendar event that schedules a workout, optionally from a template. The event is an
    ordinary calendar event (its alerts are the reminders); deleting it removes the link."""

    __tablename__ = "fitness_workout_events"
    __table_args__ = (
        _composite("calendar_event_id", "calendar_events", "fk_fitness_workout_events_event"),
        Index("ix_fitness_workout_events_owner", "workspace_id", "user_id"),
    )

    calendar_event_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fitness_templates.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FitnessLinkModel(Base):
    """A note or document related to a workout or a goal. Deleting either side removes it."""

    __tablename__ = "fitness_links"
    __table_args__ = (
        CheckConstraint("(session_id IS NULL) <> (goal_id IS NULL)", name="one_owner"),
        CheckConstraint("(note_id IS NULL) <> (document_id IS NULL)", name="one_target"),
        _composite("session_id", "fitness_sessions", "fk_fitness_links_session"),
        _composite("goal_id", "fitness_goals", "fk_fitness_links_goal"),
        _composite("note_id", "notes", "fk_fitness_links_note"),
        _composite("document_id", "documents", "fk_fitness_links_document"),
        UniqueConstraint("session_id", "note_id", name="uq_fitness_links_session_note"),
        UniqueConstraint("session_id", "document_id", name="uq_fitness_links_session_document"),
        UniqueConstraint("goal_id", "note_id", name="uq_fitness_links_goal_note"),
        UniqueConstraint("goal_id", "document_id", name="uq_fitness_links_goal_document"),
        Index("ix_fitness_links_note", "note_id"),
        Index("ix_fitness_links_document", "document_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(_workspace_fk())
    user_id: Mapped[uuid.UUID] = mapped_column(_owner_fk())
    session_id: Mapped[uuid.UUID | None]
    goal_id: Mapped[uuid.UUID | None]
    note_id: Mapped[uuid.UUID | None]
    document_id: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
