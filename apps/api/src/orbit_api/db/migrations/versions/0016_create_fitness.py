"""Health and fitness.

- `fitness_profiles`: units, optional height and date of birth, daily targets, hidden sections.
- `fitness_exercises`: the exercise library (built-ins are created on first use).
- `fitness_templates`, `fitness_template_exercises`: reusable workouts with ordered exercises.
- `fitness_sessions` (a partial unique index allows one unfinished workout per person),
  `fitness_session_exercises` (snapshots of the library entry), `fitness_sets`.
- `fitness_measurements`, `fitness_photos` (images in the attachment store).
- `fitness_foods`, `fitness_meals`, `fitness_meal_items`, `fitness_food_entries`,
  `fitness_water_entries`.
- `fitness_activities`: steps, walks, runs, rides, swims, cardio, sleep, and rest days.
- `fitness_goals`, `fitness_goal_progress`.
- `fitness_habit_links`, `fitness_workout_events` (calendar events that schedule workouts),
  `fitness_links` (notes and documents related to workouts and goals).

Every row has an owning `user_id` besides its `workspace_id`. On PostgreSQL every new table has
Row Level Security enabled with no policies, like the others; the API enforces access itself.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "fitness_activities",
    "fitness_exercises",
    "fitness_foods",
    "fitness_meals",
    "fitness_measurements",
    "fitness_photos",
    "fitness_profiles",
    "fitness_templates",
    "fitness_water_entries",
    "fitness_food_entries",
    "fitness_meal_items",
    "fitness_template_exercises",
    "fitness_goals",
    "fitness_habit_links",
    "fitness_sessions",
    "fitness_workout_events",
    "fitness_goal_progress",
    "fitness_links",
    "fitness_session_exercises",
    "fitness_sets",
)

FITNESS_ACTIVITIES_VALUES_MATCH_KIND = (
    "(kind = 'steps' AND steps IS NOT NULL) OR (kind = 'rest_day' AND steps IS NULL AND "
    "distance_m IS NULL AND duration_s IS NULL) OR (kind = 'sleep' AND duration_s IS NOT NULL "
    "AND steps IS NULL AND distance_m IS NULL) OR (kind IN ('walk', 'run', 'cycle', 'swim', "
    "'cardio') AND (distance_m IS NOT NULL OR duration_s IS NOT NULL))"
)
FITNESS_ACTIVITIES_KIND = (
    "kind IN ('steps', 'walk', 'run', 'cycle', 'swim', 'cardio', 'sleep', 'rest_day')"
)
FITNESS_EXERCISES_CATEGORY = (
    "category IN ('strength', 'cardio', 'mobility', 'flexibility', 'bodyweight', 'other')"
)
FITNESS_EXERCISES_EQUIPMENT = (
    "equipment IN ('barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'band', "
    "'bodyweight', 'none', 'other')"
)
FITNESS_FOODS_NUTRIENTS = (
    "protein_mg >= 0 AND carbs_mg >= 0 AND fat_mg >= 0 AND (fiber_mg IS NULL OR fiber_mg >= 0)"
)
FITNESS_MEASUREMENTS_ANY_VALUE = (
    "weight_g IS NOT NULL OR body_fat_pct IS NOT NULL OR height_mm IS NOT NULL OR waist_mm IS "
    "NOT NULL OR chest_mm IS NOT NULL OR hips_mm IS NOT NULL OR arm_mm IS NOT NULL OR thigh_mm "
    "IS NOT NULL OR neck_mm IS NOT NULL"
)
FITNESS_TEMPLATES_CATEGORY = (
    "category IN ('push', 'pull', 'legs', 'upper', 'lower', 'full_body', 'cardio', 'mobility', "
    "'other')"
)
FITNESS_TEMPLATE_EXERCISES_REPS_MAX = (
    "target_reps_max IS NULL OR (target_reps_max BETWEEN 1 AND 1000 AND (target_reps_min IS "
    "NULL OR target_reps_max >= target_reps_min))"
)
FITNESS_GOALS_CATEGORY = (
    "category IN ('body_weight', 'strength', 'workout_frequency', 'running_distance', "
    "'running_duration', 'nutrition', 'water', 'custom')"
)
FITNESS_HABIT_LINKS_ACTIVITY_KIND_VALUE = (
    "activity_kind IS NULL OR activity_kind IN ('steps', 'walk', 'run', 'cycle', 'swim', "
    "'cardio', 'sleep', 'rest_day')"
)
FITNESS_SESSIONS_ENDED_MATCHES_STATUS = (
    "(status IN ('active', 'paused') AND ended_at IS NULL) OR (status IN ('completed', "
    "'abandoned') AND ended_at IS NOT NULL)"
)
FITNESS_SESSION_EXERCISES_EXERCISE_CATEGORY = (
    "exercise_category IN ('strength', 'cardio', 'mobility', 'flexibility', 'bodyweight', 'other')"
)


def upgrade() -> None:
    op.create_table(
        "fitness_activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=True),
        sa.Column("distance_m", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            FITNESS_ACTIVITIES_VALUES_MATCH_KIND,
            name=op.f("ck_fitness_activities_values_match_kind"),
        ),
        sa.CheckConstraint(
            FITNESS_ACTIVITIES_KIND,
            name=op.f("ck_fitness_activities_kind"),
        ),
        sa.CheckConstraint("source IN ('manual')", name=op.f("ck_fitness_activities_source")),
        sa.CheckConstraint(
            "distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000",
            name=op.f("ck_fitness_activities_distance"),
        ),
        sa.CheckConstraint(
            "duration_s IS NULL OR duration_s BETWEEN 1 AND 86400",
            name=op.f("ck_fitness_activities_duration"),
        ),
        sa.CheckConstraint("length(note) <= 1000", name=op.f("ck_fitness_activities_note_length")),
        sa.CheckConstraint(
            "steps IS NULL OR steps BETWEEN 1 AND 200000", name=op.f("ck_fitness_activities_steps")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_activities_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_activities_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_activities")),
    )
    with op.batch_alter_table("fitness_activities", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_activities_owner_day", ["workspace_id", "user_id", "day"], unique=False
        )

    op.create_table(
        "fitness_exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("builtin_key", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("normalized_name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("exercise_type", sa.String(length=24), nullable=False),
        sa.Column("equipment", sa.String(length=16), nullable=False),
        sa.Column("primary_muscles", sa.JSON(), nullable=False),
        sa.Column("secondary_muscles", sa.JSON(), nullable=False),
        sa.Column("is_custom", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            FITNESS_EXERCISES_CATEGORY,
            name=op.f("ck_fitness_exercises_category"),
        ),
        sa.CheckConstraint(
            FITNESS_EXERCISES_EQUIPMENT,
            name=op.f("ck_fitness_exercises_equipment"),
        ),
        sa.CheckConstraint(
            "exercise_type IN ('weight_reps', 'reps', 'duration', 'distance_duration')",
            name=op.f("ck_fitness_exercises_exercise_type"),
        ),
        sa.CheckConstraint(
            "is_custom = (builtin_key IS NULL)", name=op.f("ck_fitness_exercises_custom_or_builtin")
        ),
        sa.CheckConstraint(
            "length(description) <= 2000", name=op.f("ck_fitness_exercises_description_length")
        ),
        sa.CheckConstraint(
            "length(instructions) <= 5000", name=op.f("ck_fitness_exercises_instructions_length")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_exercises_name_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_exercises_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_exercises_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_exercises")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_fitness_exercises_id")),
        sa.UniqueConstraint(
            "workspace_id", "user_id", "builtin_key", name="uq_fitness_exercises_builtin"
        ),
    )
    with op.batch_alter_table("fitness_exercises", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_exercises_owner_name",
            ["workspace_id", "user_id", "normalized_name"],
            unique=False,
        )

    op.create_table(
        "fitness_foods",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("normalized_name", sa.String(length=100), nullable=False),
        sa.Column("serving_quantity_milli", sa.Integer(), nullable=False),
        sa.Column("serving_unit", sa.String(length=20), nullable=False),
        sa.Column("energy_cal", sa.Integer(), nullable=False),
        sa.Column("protein_mg", sa.Integer(), nullable=False),
        sa.Column("carbs_mg", sa.Integer(), nullable=False),
        sa.Column("fat_mg", sa.Integer(), nullable=False),
        sa.Column("fiber_mg", sa.Integer(), nullable=True),
        sa.Column("use_count", sa.Integer(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "energy_cal BETWEEN 0 AND 100000000", name=op.f("ck_fitness_foods_energy")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_foods_name_length")
        ),
        sa.CheckConstraint(
            "length(serving_unit) BETWEEN 1 AND 20",
            name=op.f("ck_fitness_foods_serving_unit_length"),
        ),
        sa.CheckConstraint(
            FITNESS_FOODS_NUTRIENTS,
            name=op.f("ck_fitness_foods_nutrients"),
        ),
        sa.CheckConstraint(
            "serving_quantity_milli > 0", name=op.f("ck_fitness_foods_serving_quantity")
        ),
        sa.CheckConstraint("use_count >= 0", name=op.f("ck_fitness_foods_use_count")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_foods_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_foods_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_foods")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_fitness_foods_id")),
    )
    with op.batch_alter_table("fitness_foods", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_foods_owner_name",
            ["workspace_id", "user_id", "normalized_name"],
            unique=False,
        )

    op.create_table(
        "fitness_meals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_meals_name_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_meals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_meals_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_meals")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_fitness_meals_id")),
    )
    with op.batch_alter_table("fitness_meals", schema=None) as batch_op:
        batch_op.create_index("ix_fitness_meals_owner", ["workspace_id", "user_id"], unique=False)

    op.create_table(
        "fitness_measurements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("weight_g", sa.Integer(), nullable=True),
        sa.Column("body_fat_pct", sa.Float(), nullable=True),
        sa.Column("height_mm", sa.Integer(), nullable=True),
        sa.Column("waist_mm", sa.Integer(), nullable=True),
        sa.Column("chest_mm", sa.Integer(), nullable=True),
        sa.Column("hips_mm", sa.Integer(), nullable=True),
        sa.Column("arm_mm", sa.Integer(), nullable=True),
        sa.Column("thigh_mm", sa.Integer(), nullable=True),
        sa.Column("neck_mm", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "arm_mm IS NULL OR arm_mm BETWEEN 10 AND 3000",
            name=op.f("ck_fitness_measurements_arm_mm"),
        ),
        sa.CheckConstraint(
            "body_fat_pct IS NULL OR (body_fat_pct > 0 AND body_fat_pct < 100)",
            name=op.f("ck_fitness_measurements_body_fat"),
        ),
        sa.CheckConstraint(
            "chest_mm IS NULL OR chest_mm BETWEEN 10 AND 3000",
            name=op.f("ck_fitness_measurements_chest_mm"),
        ),
        sa.CheckConstraint(
            "height_mm IS NULL OR height_mm BETWEEN 500 AND 2720",
            name=op.f("ck_fitness_measurements_height"),
        ),
        sa.CheckConstraint(
            "hips_mm IS NULL OR hips_mm BETWEEN 10 AND 3000",
            name=op.f("ck_fitness_measurements_hips_mm"),
        ),
        sa.CheckConstraint(
            "length(note) <= 1000", name=op.f("ck_fitness_measurements_note_length")
        ),
        sa.CheckConstraint(
            "neck_mm IS NULL OR neck_mm BETWEEN 10 AND 3000",
            name=op.f("ck_fitness_measurements_neck_mm"),
        ),
        sa.CheckConstraint(
            "thigh_mm IS NULL OR thigh_mm BETWEEN 10 AND 3000",
            name=op.f("ck_fitness_measurements_thigh_mm"),
        ),
        sa.CheckConstraint(
            "waist_mm IS NULL OR waist_mm BETWEEN 10 AND 3000",
            name=op.f("ck_fitness_measurements_waist_mm"),
        ),
        sa.CheckConstraint(
            FITNESS_MEASUREMENTS_ANY_VALUE,
            name=op.f("ck_fitness_measurements_any_value"),
        ),
        sa.CheckConstraint(
            "weight_g IS NULL OR weight_g BETWEEN 1000 AND 650000",
            name=op.f("ck_fitness_measurements_weight"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_measurements_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_measurements_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_measurements")),
    )
    with op.batch_alter_table("fitness_measurements", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_measurements_owner_day", ["workspace_id", "user_id", "day"], unique=False
        )

    op.create_table(
        "fitness_photos",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("blob_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(note) <= 1000", name=op.f("ck_fitness_photos_note_length")),
        sa.CheckConstraint("size_bytes > 0", name=op.f("ck_fitness_photos_size")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_photos_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_photos_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_photos")),
        sa.UniqueConstraint("blob_id", name=op.f("uq_fitness_photos_blob_id")),
    )
    with op.batch_alter_table("fitness_photos", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_photos_owner_day", ["workspace_id", "user_id", "day"], unique=False
        )

    op.create_table(
        "fitness_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("unit_system", sa.String(length=16), nullable=False),
        sa.Column("weight_unit", sa.String(length=8), nullable=False),
        sa.Column("length_unit", sa.String(length=8), nullable=False),
        sa.Column("distance_unit", sa.String(length=8), nullable=False),
        sa.Column("energy_unit", sa.String(length=8), nullable=False),
        sa.Column("water_unit", sa.String(length=8), nullable=False),
        sa.Column("height_mm", sa.Integer(), nullable=True),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("energy_target_cal", sa.Integer(), nullable=True),
        sa.Column("protein_target_mg", sa.Integer(), nullable=True),
        sa.Column("carbs_target_mg", sa.Integer(), nullable=True),
        sa.Column("fat_target_mg", sa.Integer(), nullable=True),
        sa.Column("fiber_target_mg", sa.Integer(), nullable=True),
        sa.Column("water_target_ml", sa.Integer(), nullable=True),
        sa.Column("water_quick_amounts_ml", sa.JSON(), nullable=False),
        sa.Column("hidden_sections", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "distance_unit IN ('km', 'mi')", name=op.f("ck_fitness_profiles_distance_unit")
        ),
        sa.CheckConstraint(
            "energy_unit IN ('kcal', 'kj')", name=op.f("ck_fitness_profiles_energy_unit")
        ),
        sa.CheckConstraint(
            "length_unit IN ('cm', 'in')", name=op.f("ck_fitness_profiles_length_unit")
        ),
        sa.CheckConstraint(
            "unit_system IN ('metric', 'imperial')", name=op.f("ck_fitness_profiles_unit_system")
        ),
        sa.CheckConstraint(
            "water_unit IN ('ml', 'l', 'fl_oz')", name=op.f("ck_fitness_profiles_water_unit")
        ),
        sa.CheckConstraint(
            "weight_unit IN ('kg', 'lb')", name=op.f("ck_fitness_profiles_weight_unit")
        ),
        sa.CheckConstraint(
            "energy_target_cal IS NULL OR energy_target_cal BETWEEN 1 AND 20000000",
            name=op.f("ck_fitness_profiles_energy_target"),
        ),
        sa.CheckConstraint(
            "height_mm IS NULL OR height_mm BETWEEN 500 AND 2720",
            name=op.f("ck_fitness_profiles_height"),
        ),
        sa.CheckConstraint(
            "water_target_ml IS NULL OR water_target_ml BETWEEN 1 AND 20000",
            name=op.f("ck_fitness_profiles_water_target"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_profiles_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_profiles_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_profiles")),
        sa.UniqueConstraint(
            "workspace_id", "user_id", name=op.f("uq_fitness_profiles_workspace_id")
        ),
    )
    op.create_table(
        "fitness_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            FITNESS_TEMPLATES_CATEGORY,
            name=op.f("ck_fitness_templates_category"),
        ),
        sa.CheckConstraint(
            "length(description) <= 2000", name=op.f("ck_fitness_templates_description_length")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_templates_name_length")
        ),
        sa.CheckConstraint("length(notes) <= 5000", name=op.f("ck_fitness_templates_notes_length")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_templates_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_templates_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_templates")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_fitness_templates_id")),
    )
    with op.batch_alter_table("fitness_templates", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_templates_owner", ["workspace_id", "user_id"], unique=False
        )

    op.create_table(
        "fitness_water_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("amount_ml", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "amount_ml BETWEEN 1 AND 10000", name=op.f("ck_fitness_water_entries_amount")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_water_entries_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_water_entries_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_water_entries")),
    )
    with op.batch_alter_table("fitness_water_entries", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_water_entries_owner_day", ["workspace_id", "user_id", "day"], unique=False
        )

    op.create_table(
        "fitness_food_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("meal", sa.String(length=16), nullable=False),
        sa.Column("food_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("quantity_milli", sa.Integer(), nullable=False),
        sa.Column("serving_unit", sa.String(length=20), nullable=False),
        sa.Column("energy_cal", sa.Integer(), nullable=False),
        sa.Column("protein_mg", sa.Integer(), nullable=False),
        sa.Column("carbs_mg", sa.Integer(), nullable=False),
        sa.Column("fat_mg", sa.Integer(), nullable=False),
        sa.Column("fiber_mg", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "meal IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')",
            name=op.f("ck_fitness_food_entries_meal"),
        ),
        sa.CheckConstraint(
            "energy_cal BETWEEN 0 AND 100000000", name=op.f("ck_fitness_food_entries_energy")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_food_entries_name_length")
        ),
        sa.CheckConstraint(
            "length(note) <= 1000", name=op.f("ck_fitness_food_entries_note_length")
        ),
        sa.CheckConstraint(
            "length(serving_unit) BETWEEN 1 AND 20",
            name=op.f("ck_fitness_food_entries_serving_unit_length"),
        ),
        sa.CheckConstraint(
            FITNESS_FOODS_NUTRIENTS,
            name=op.f("ck_fitness_food_entries_nutrients"),
        ),
        sa.CheckConstraint("quantity_milli > 0", name=op.f("ck_fitness_food_entries_quantity")),
        sa.ForeignKeyConstraint(
            ["food_id"],
            ["fitness_foods.id"],
            name=op.f("fk_fitness_food_entries_food_id_fitness_foods"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_food_entries_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_food_entries_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_food_entries")),
    )
    with op.batch_alter_table("fitness_food_entries", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_food_entries_owner_day", ["workspace_id", "user_id", "day"], unique=False
        )

    op.create_table(
        "fitness_meal_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("meal_id", sa.Uuid(), nullable=False),
        sa.Column("food_id", sa.Uuid(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("quantity_milli", sa.Integer(), nullable=False),
        sa.Column("serving_unit", sa.String(length=20), nullable=False),
        sa.Column("energy_cal", sa.Integer(), nullable=False),
        sa.Column("protein_mg", sa.Integer(), nullable=False),
        sa.Column("carbs_mg", sa.Integer(), nullable=False),
        sa.Column("fat_mg", sa.Integer(), nullable=False),
        sa.Column("fiber_mg", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "energy_cal BETWEEN 0 AND 100000000", name=op.f("ck_fitness_meal_items_energy")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_meal_items_name_length")
        ),
        sa.CheckConstraint(
            "length(serving_unit) BETWEEN 1 AND 20",
            name=op.f("ck_fitness_meal_items_serving_unit_length"),
        ),
        sa.CheckConstraint(
            FITNESS_FOODS_NUTRIENTS,
            name=op.f("ck_fitness_meal_items_nutrients"),
        ),
        sa.CheckConstraint("quantity_milli > 0", name=op.f("ck_fitness_meal_items_quantity")),
        sa.ForeignKeyConstraint(
            ["food_id"],
            ["fitness_foods.id"],
            name=op.f("fk_fitness_meal_items_food_id_fitness_foods"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["meal_id", "workspace_id"],
            ["fitness_meals.id", "fitness_meals.workspace_id"],
            name="fk_fitness_meal_items_meal",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_meal_items_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_meal_items")),
    )
    with op.batch_alter_table("fitness_meal_items", schema=None) as batch_op:
        batch_op.create_index("ix_fitness_meal_items_meal", ["meal_id", "position"], unique=False)

    op.create_table(
        "fitness_template_exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("sets", sa.Integer(), nullable=False),
        sa.Column("target_reps_min", sa.Integer(), nullable=True),
        sa.Column("target_reps_max", sa.Integer(), nullable=True),
        sa.Column("target_weight_g", sa.Integer(), nullable=True),
        sa.Column("target_duration_s", sa.Integer(), nullable=True),
        sa.Column("target_distance_m", sa.Integer(), nullable=True),
        sa.Column("rest_seconds", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "length(notes) <= 1000", name=op.f("ck_fitness_template_exercises_notes_length")
        ),
        sa.CheckConstraint(
            "rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600",
            name=op.f("ck_fitness_template_exercises_rest"),
        ),
        sa.CheckConstraint(
            "sets BETWEEN 1 AND 20", name=op.f("ck_fitness_template_exercises_sets")
        ),
        sa.CheckConstraint(
            "target_distance_m IS NULL OR target_distance_m > 0",
            name=op.f("ck_fitness_template_exercises_distance"),
        ),
        sa.CheckConstraint(
            "target_duration_s IS NULL OR target_duration_s > 0",
            name=op.f("ck_fitness_template_exercises_duration"),
        ),
        sa.CheckConstraint(
            FITNESS_TEMPLATE_EXERCISES_REPS_MAX,
            name=op.f("ck_fitness_template_exercises_reps_max"),
        ),
        sa.CheckConstraint(
            "target_reps_min IS NULL OR target_reps_min BETWEEN 1 AND 1000",
            name=op.f("ck_fitness_template_exercises_reps_min"),
        ),
        sa.CheckConstraint(
            "target_weight_g IS NULL OR target_weight_g >= 0",
            name=op.f("ck_fitness_template_exercises_weight"),
        ),
        sa.ForeignKeyConstraint(
            ["exercise_id", "workspace_id"],
            ["fitness_exercises.id", "fitness_exercises.workspace_id"],
            name="fk_fitness_template_exercises_exercise",
        ),
        sa.ForeignKeyConstraint(
            ["template_id", "workspace_id"],
            ["fitness_templates.id", "fitness_templates.workspace_id"],
            name="fk_fitness_template_exercises_template",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_template_exercises_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_template_exercises")),
    )
    with op.batch_alter_table("fitness_template_exercises", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_template_exercises_exercise", ["exercise_id"], unique=False
        )
        batch_op.create_index(
            "ix_fitness_template_exercises_template", ["template_id", "position"], unique=False
        )

    op.create_table(
        "fitness_goals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("start_value", sa.Float(), nullable=False),
        sa.Column("target_value", sa.Float(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_track", sa.Boolean(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=True),
        sa.Column("habit_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(status = 'completed') = (completed_at IS NOT NULL)",
            name=op.f("ck_fitness_goals_completed_at"),
        ),
        sa.CheckConstraint(
            FITNESS_GOALS_CATEGORY,
            name=op.f("ck_fitness_goals_category"),
        ),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'completed')", name=op.f("ck_fitness_goals_status")
        ),
        sa.CheckConstraint(
            "length(description) <= 2000", name=op.f("ck_fitness_goals_description_length")
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_goals_name_length")
        ),
        sa.CheckConstraint(
            "length(unit) BETWEEN 1 AND 20", name=op.f("ck_fitness_goals_unit_length")
        ),
        sa.CheckConstraint(
            "target_date IS NULL OR target_date > start_date", name=op.f("ck_fitness_goals_dates")
        ),
        sa.CheckConstraint(
            "target_value <> start_value", name=op.f("ck_fitness_goals_target_differs")
        ),
        sa.ForeignKeyConstraint(
            ["exercise_id"],
            ["fitness_exercises.id"],
            name=op.f("fk_fitness_goals_exercise_id_fitness_exercises"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["habit_id"],
            ["habits.id"],
            name=op.f("fk_fitness_goals_habit_id_habits"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_goals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_goals_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_goals")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_fitness_goals_id")),
    )
    with op.batch_alter_table("fitness_goals", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_goals_owner_status", ["workspace_id", "user_id", "status"], unique=False
        )

    op.create_table(
        "fitness_habit_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("habit_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("activity_kind", sa.String(length=16), nullable=True),
        sa.Column("contributes", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(source = 'activity') = (activity_kind IS NOT NULL)",
            name=op.f("ck_fitness_habit_links_activity_kind"),
        ),
        sa.CheckConstraint(
            FITNESS_HABIT_LINKS_ACTIVITY_KIND_VALUE,
            name=op.f("ck_fitness_habit_links_activity_kind_value"),
        ),
        sa.CheckConstraint(
            "source IN ('workout', 'water', 'activity')", name=op.f("ck_fitness_habit_links_source")
        ),
        sa.ForeignKeyConstraint(
            ["habit_id", "workspace_id"],
            ["habits.id", "habits.workspace_id"],
            name="fk_fitness_habit_links_habit",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_habit_links_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_habit_links_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_habit_links")),
        sa.UniqueConstraint("habit_id", name=op.f("uq_fitness_habit_links_habit_id")),
    )
    with op.batch_alter_table("fitness_habit_links", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_habit_links_owner", ["workspace_id", "user_id"], unique=False
        )

    op.create_table(
        "fitness_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=True),
        sa.Column("calendar_event_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused_seconds", sa.Integer(), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(status = 'paused') = (paused_at IS NOT NULL)",
            name=op.f("ck_fitness_sessions_paused_at"),
        ),
        sa.CheckConstraint(
            FITNESS_SESSIONS_ENDED_MATCHES_STATUS,
            name=op.f("ck_fitness_sessions_ended_matches_status"),
        ),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'completed', 'abandoned')",
            name=op.f("ck_fitness_sessions_status"),
        ),
        sa.CheckConstraint(
            "duration_s IS NULL OR duration_s >= 0", name=op.f("ck_fitness_sessions_duration")
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at",
            name=op.f("ck_fitness_sessions_ended_after_start"),
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_fitness_sessions_name_length")
        ),
        sa.CheckConstraint("length(notes) <= 5000", name=op.f("ck_fitness_sessions_notes_length")),
        sa.CheckConstraint(
            "length(timezone) BETWEEN 1 AND 64", name=op.f("ck_fitness_sessions_timezone_length")
        ),
        sa.CheckConstraint("paused_seconds >= 0", name=op.f("ck_fitness_sessions_paused_seconds")),
        sa.ForeignKeyConstraint(
            ["calendar_event_id"],
            ["calendar_events.id"],
            name=op.f("fk_fitness_sessions_calendar_event_id_calendar_events"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["fitness_templates.id"],
            name=op.f("fk_fitness_sessions_template_id_fitness_templates"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_sessions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_sessions")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_fitness_sessions_id")),
    )
    with op.batch_alter_table("fitness_sessions", schema=None) as batch_op:
        batch_op.create_index("ix_fitness_sessions_event", ["calendar_event_id"], unique=False)
        batch_op.create_index(
            "ix_fitness_sessions_owner_day", ["workspace_id", "user_id", "day"], unique=False
        )
        batch_op.create_index(
            "uq_fitness_sessions_unfinished",
            ["workspace_id", "user_id"],
            unique=True,
            sqlite_where=sa.text("status IN ('active', 'paused')"),
            postgresql_where=sa.text("status IN ('active', 'paused')"),
        )

    op.create_table(
        "fitness_workout_events",
        sa.Column("calendar_event_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["calendar_event_id", "workspace_id"],
            ["calendar_events.id", "calendar_events.workspace_id"],
            name="fk_fitness_workout_events_event",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["fitness_templates.id"],
            name=op.f("fk_fitness_workout_events_template_id_fitness_templates"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_workout_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_workout_events_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("calendar_event_id", name=op.f("pk_fitness_workout_events")),
    )
    with op.batch_alter_table("fitness_workout_events", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_workout_events_owner", ["workspace_id", "user_id"], unique=False
        )

    op.create_table(
        "fitness_goal_progress",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("goal_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(note) <= 1000", name=op.f("ck_fitness_goal_progress_note_length")
        ),
        sa.ForeignKeyConstraint(
            ["goal_id", "workspace_id"],
            ["fitness_goals.id", "fitness_goals.workspace_id"],
            name="fk_fitness_goal_progress_goal",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_goal_progress_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_goal_progress")),
    )
    with op.batch_alter_table("fitness_goal_progress", schema=None) as batch_op:
        batch_op.create_index("ix_fitness_goal_progress_goal_day", ["goal_id", "day"], unique=False)

    op.create_table(
        "fitness_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("goal_id", sa.Uuid(), nullable=True),
        sa.Column("note_id", sa.Uuid(), nullable=True),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(note_id IS NULL) <> (document_id IS NULL)", name=op.f("ck_fitness_links_one_target")
        ),
        sa.CheckConstraint(
            "(session_id IS NULL) <> (goal_id IS NULL)", name=op.f("ck_fitness_links_one_owner")
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "workspace_id"],
            ["documents.id", "documents.workspace_id"],
            name="fk_fitness_links_document",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["goal_id", "workspace_id"],
            ["fitness_goals.id", "fitness_goals.workspace_id"],
            name="fk_fitness_links_goal",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_fitness_links_note",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["session_id", "workspace_id"],
            ["fitness_sessions.id", "fitness_sessions.workspace_id"],
            name="fk_fitness_links_session",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_fitness_links_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_links_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_links")),
        sa.UniqueConstraint("goal_id", "document_id", name="uq_fitness_links_goal_document"),
        sa.UniqueConstraint("goal_id", "note_id", name="uq_fitness_links_goal_note"),
        sa.UniqueConstraint("session_id", "document_id", name="uq_fitness_links_session_document"),
        sa.UniqueConstraint("session_id", "note_id", name="uq_fitness_links_session_note"),
    )
    with op.batch_alter_table("fitness_links", schema=None) as batch_op:
        batch_op.create_index("ix_fitness_links_document", ["document_id"], unique=False)
        batch_op.create_index("ix_fitness_links_note", ["note_id"], unique=False)

    op.create_table(
        "fitness_session_exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("exercise_name", sa.String(length=100), nullable=False),
        sa.Column("exercise_type", sa.String(length=24), nullable=False),
        sa.Column("exercise_category", sa.String(length=16), nullable=False),
        sa.Column("primary_muscles", sa.JSON(), nullable=False),
        sa.Column("rest_seconds", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.CheckConstraint(
            FITNESS_SESSION_EXERCISES_EXERCISE_CATEGORY,
            name=op.f("ck_fitness_session_exercises_exercise_category"),
        ),
        sa.CheckConstraint(
            "exercise_type IN ('weight_reps', 'reps', 'duration', 'distance_duration')",
            name=op.f("ck_fitness_session_exercises_exercise_type"),
        ),
        sa.CheckConstraint(
            "length(exercise_name) BETWEEN 1 AND 100",
            name=op.f("ck_fitness_session_exercises_name_length"),
        ),
        sa.CheckConstraint(
            "length(notes) <= 1000", name=op.f("ck_fitness_session_exercises_notes_length")
        ),
        sa.CheckConstraint(
            "rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600",
            name=op.f("ck_fitness_session_exercises_rest"),
        ),
        sa.ForeignKeyConstraint(
            ["exercise_id"],
            ["fitness_exercises.id"],
            name=op.f("fk_fitness_session_exercises_exercise_id_fitness_exercises"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["session_id", "workspace_id"],
            ["fitness_sessions.id", "fitness_sessions.workspace_id"],
            name="fk_fitness_session_exercises_session",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_session_exercises_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_session_exercises")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_fitness_session_exercises_id")),
    )
    with op.batch_alter_table("fitness_session_exercises", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_session_exercises_exercise", ["exercise_id"], unique=False
        )
        batch_op.create_index(
            "ix_fitness_session_exercises_session", ["session_id", "position"], unique=False
        )

    op.create_table(
        "fitness_sets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("session_exercise_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("set_type", sa.String(length=16), nullable=False),
        sa.Column("reps", sa.Integer(), nullable=True),
        sa.Column("weight_g", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column("distance_m", sa.Integer(), nullable=True),
        sa.Column("rpe", sa.Float(), nullable=True),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "set_type IN ('warmup', 'working', 'drop', 'failure')",
            name=op.f("ck_fitness_sets_set_type"),
        ),
        sa.CheckConstraint(
            "completed = (completed_at IS NOT NULL)", name=op.f("ck_fitness_sets_completed_at")
        ),
        sa.CheckConstraint(
            "distance_m IS NULL OR distance_m BETWEEN 0 AND 1000000",
            name=op.f("ck_fitness_sets_distance"),
        ),
        sa.CheckConstraint(
            "duration_s IS NULL OR duration_s BETWEEN 0 AND 172800",
            name=op.f("ck_fitness_sets_duration"),
        ),
        sa.CheckConstraint(
            "reps IS NULL OR reps BETWEEN 0 AND 10000", name=op.f("ck_fitness_sets_reps")
        ),
        sa.CheckConstraint("rpe IS NULL OR rpe BETWEEN 1 AND 10", name=op.f("ck_fitness_sets_rpe")),
        sa.CheckConstraint(
            "weight_g IS NULL OR weight_g BETWEEN 0 AND 2000000",
            name=op.f("ck_fitness_sets_weight"),
        ),
        sa.ForeignKeyConstraint(
            ["session_exercise_id", "workspace_id"],
            ["fitness_session_exercises.id", "fitness_session_exercises.workspace_id"],
            name="fk_fitness_sets_session_exercise",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_fitness_sets_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fitness_sets")),
    )
    with op.batch_alter_table("fitness_sets", schema=None) as batch_op:
        batch_op.create_index(
            "ix_fitness_sets_session_exercise", ["session_exercise_id", "position"], unique=False
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("fitness_sets", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_sets_session_exercise")

    op.drop_table("fitness_sets")
    with op.batch_alter_table("fitness_session_exercises", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_session_exercises_session")
        batch_op.drop_index("ix_fitness_session_exercises_exercise")

    op.drop_table("fitness_session_exercises")
    with op.batch_alter_table("fitness_links", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_links_note")
        batch_op.drop_index("ix_fitness_links_document")

    op.drop_table("fitness_links")
    with op.batch_alter_table("fitness_goal_progress", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_goal_progress_goal_day")

    op.drop_table("fitness_goal_progress")
    with op.batch_alter_table("fitness_workout_events", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_workout_events_owner")

    op.drop_table("fitness_workout_events")
    with op.batch_alter_table("fitness_sessions", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_fitness_sessions_unfinished",
            sqlite_where=sa.text("status IN ('active', 'paused')"),
            postgresql_where=sa.text("status IN ('active', 'paused')"),
        )
        batch_op.drop_index("ix_fitness_sessions_owner_day")
        batch_op.drop_index("ix_fitness_sessions_event")

    op.drop_table("fitness_sessions")
    with op.batch_alter_table("fitness_habit_links", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_habit_links_owner")

    op.drop_table("fitness_habit_links")
    with op.batch_alter_table("fitness_goals", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_goals_owner_status")

    op.drop_table("fitness_goals")
    with op.batch_alter_table("fitness_template_exercises", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_template_exercises_template")
        batch_op.drop_index("ix_fitness_template_exercises_exercise")

    op.drop_table("fitness_template_exercises")
    with op.batch_alter_table("fitness_meal_items", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_meal_items_meal")

    op.drop_table("fitness_meal_items")
    with op.batch_alter_table("fitness_food_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_food_entries_owner_day")

    op.drop_table("fitness_food_entries")
    with op.batch_alter_table("fitness_water_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_water_entries_owner_day")

    op.drop_table("fitness_water_entries")
    with op.batch_alter_table("fitness_templates", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_templates_owner")

    op.drop_table("fitness_templates")
    op.drop_table("fitness_profiles")
    with op.batch_alter_table("fitness_photos", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_photos_owner_day")

    op.drop_table("fitness_photos")
    with op.batch_alter_table("fitness_measurements", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_measurements_owner_day")

    op.drop_table("fitness_measurements")
    with op.batch_alter_table("fitness_meals", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_meals_owner")

    op.drop_table("fitness_meals")
    with op.batch_alter_table("fitness_foods", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_foods_owner_name")

    op.drop_table("fitness_foods")
    with op.batch_alter_table("fitness_exercises", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_exercises_owner_name")

    op.drop_table("fitness_exercises")
    with op.batch_alter_table("fitness_activities", schema=None) as batch_op:
        batch_op.drop_index("ix_fitness_activities_owner_day")

    op.drop_table("fitness_activities")
