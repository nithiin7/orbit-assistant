"""Built-in exercises, created in a person's library the first time they open it.

Keys are stable: a built-in is created once per person and workspace (a unique key), and later
versions of this list only add exercises. No images or external media are needed.
"""

from orbit_api.services.fitness.models import (
    Equipment,
    ExerciseCategory,
    ExerciseDraft,
    ExerciseType,
    Muscle,
)


def _exercise(
    name: str,
    category: ExerciseCategory,
    exercise_type: ExerciseType,
    equipment: Equipment,
    primary: tuple[Muscle, ...],
    secondary: tuple[Muscle, ...] = (),
    instructions: str = "",
) -> ExerciseDraft:
    return ExerciseDraft(
        name=name,
        category=category,
        exercise_type=exercise_type,
        equipment=equipment,
        primary_muscles=primary,
        secondary_muscles=secondary,
        instructions=instructions,
    )


BUILTIN_EXERCISES: dict[str, ExerciseDraft] = {
    # Strength: barbell
    "barbell_bench_press": _exercise(
        "Bench press",
        "strength",
        "weight_reps",
        "barbell",
        ("chest",),
        ("triceps", "shoulders"),
        "Lie on the bench, lower the bar to mid-chest, and press it back up over your shoulders.",
    ),
    "barbell_squat": _exercise(
        "Back squat",
        "strength",
        "weight_reps",
        "barbell",
        ("quadriceps", "glutes"),
        ("hamstrings", "lower_back"),
        "With the bar on your upper back, sit down between your heels and stand back up.",
    ),
    "barbell_deadlift": _exercise(
        "Deadlift",
        "strength",
        "weight_reps",
        "barbell",
        ("hamstrings", "glutes", "lower_back"),
        ("upper_back", "forearms"),
        "Hinge at the hips, grip the bar, and stand up with a flat back.",
    ),
    "barbell_overhead_press": _exercise(
        "Overhead press",
        "strength",
        "weight_reps",
        "barbell",
        ("shoulders",),
        ("triceps",),
        "Press the bar from your collarbones to overhead, keeping your core braced.",
    ),
    "barbell_row": _exercise(
        "Barbell row",
        "strength",
        "weight_reps",
        "barbell",
        ("upper_back", "lats"),
        ("biceps",),
        "Hinge forward and pull the bar to your lower ribs.",
    ),
    "romanian_deadlift": _exercise(
        "Romanian deadlift",
        "strength",
        "weight_reps",
        "barbell",
        ("hamstrings",),
        ("glutes", "lower_back"),
    ),
    "hip_thrust": _exercise("Hip thrust", "strength", "weight_reps", "barbell", ("glutes",)),
    "barbell_curl": _exercise("Barbell curl", "strength", "weight_reps", "barbell", ("biceps",)),
    # Strength: dumbbell
    "dumbbell_bench_press": _exercise(
        "Dumbbell bench press", "strength", "weight_reps", "dumbbell", ("chest",), ("triceps",)
    ),
    "incline_dumbbell_press": _exercise(
        "Incline dumbbell press",
        "strength",
        "weight_reps",
        "dumbbell",
        ("chest",),
        ("shoulders", "triceps"),
    ),
    "dumbbell_shoulder_press": _exercise(
        "Dumbbell shoulder press", "strength", "weight_reps", "dumbbell", ("shoulders",)
    ),
    "lateral_raise": _exercise(
        "Lateral raise", "strength", "weight_reps", "dumbbell", ("shoulders",)
    ),
    "dumbbell_row": _exercise(
        "One-arm dumbbell row", "strength", "weight_reps", "dumbbell", ("lats", "upper_back")
    ),
    "dumbbell_curl": _exercise("Dumbbell curl", "strength", "weight_reps", "dumbbell", ("biceps",)),
    "hammer_curl": _exercise(
        "Hammer curl", "strength", "weight_reps", "dumbbell", ("biceps", "forearms")
    ),
    "goblet_squat": _exercise(
        "Goblet squat", "strength", "weight_reps", "dumbbell", ("quadriceps", "glutes")
    ),
    "walking_lunge": _exercise(
        "Walking lunge", "strength", "weight_reps", "dumbbell", ("quadriceps", "glutes")
    ),
    # Strength: cable and machine
    "lat_pulldown": _exercise(
        "Lat pulldown", "strength", "weight_reps", "cable", ("lats",), ("biceps",)
    ),
    "seated_cable_row": _exercise(
        "Seated cable row", "strength", "weight_reps", "cable", ("upper_back", "lats")
    ),
    "triceps_pushdown": _exercise(
        "Triceps pushdown", "strength", "weight_reps", "cable", ("triceps",)
    ),
    "face_pull": _exercise(
        "Face pull", "strength", "weight_reps", "cable", ("shoulders", "upper_back")
    ),
    "cable_fly": _exercise("Cable fly", "strength", "weight_reps", "cable", ("chest",)),
    "leg_press": _exercise(
        "Leg press", "strength", "weight_reps", "machine", ("quadriceps", "glutes")
    ),
    "leg_extension": _exercise(
        "Leg extension", "strength", "weight_reps", "machine", ("quadriceps",)
    ),
    "leg_curl": _exercise("Leg curl", "strength", "weight_reps", "machine", ("hamstrings",)),
    "calf_raise": _exercise("Calf raise", "strength", "weight_reps", "machine", ("calves",)),
    "chest_press_machine": _exercise(
        "Chest press machine", "strength", "weight_reps", "machine", ("chest",)
    ),
    "kettlebell_swing": _exercise(
        "Kettlebell swing", "strength", "weight_reps", "kettlebell", ("glutes", "hamstrings")
    ),
    "band_pull_apart": _exercise(
        "Band pull-apart", "strength", "reps", "band", ("upper_back", "shoulders")
    ),
    # Bodyweight
    "push_up": _exercise(
        "Push-up", "bodyweight", "reps", "bodyweight", ("chest",), ("triceps", "shoulders")
    ),
    "pull_up": _exercise(
        "Pull-up", "bodyweight", "reps", "bodyweight", ("lats",), ("biceps", "upper_back")
    ),
    "chin_up": _exercise("Chin-up", "bodyweight", "reps", "bodyweight", ("lats", "biceps")),
    "dip": _exercise("Dip", "bodyweight", "reps", "bodyweight", ("triceps", "chest")),
    "bodyweight_squat": _exercise(
        "Bodyweight squat", "bodyweight", "reps", "bodyweight", ("quadriceps", "glutes")
    ),
    "crunch": _exercise("Crunch", "bodyweight", "reps", "bodyweight", ("abs",)),
    "hanging_leg_raise": _exercise(
        "Hanging leg raise", "bodyweight", "reps", "bodyweight", ("abs", "hip_flexors")
    ),
    "plank": _exercise("Plank", "bodyweight", "duration", "bodyweight", ("abs",), ("obliques",)),
    "side_plank": _exercise("Side plank", "bodyweight", "duration", "bodyweight", ("obliques",)),
    "burpee": _exercise("Burpee", "bodyweight", "reps", "bodyweight", ("full_body",)),
    # Cardio
    "running": _exercise(
        "Running", "cardio", "distance_duration", "none", ("quadriceps", "calves")
    ),
    "treadmill": _exercise(
        "Treadmill", "cardio", "distance_duration", "machine", ("quadriceps", "calves")
    ),
    "cycling": _exercise(
        "Cycling", "cardio", "distance_duration", "none", ("quadriceps", "hamstrings")
    ),
    "stationary_bike": _exercise(
        "Stationary bike", "cardio", "distance_duration", "machine", ("quadriceps",)
    ),
    "rowing_machine": _exercise(
        "Rowing machine", "cardio", "distance_duration", "machine", ("full_body",)
    ),
    "swimming": _exercise("Swimming", "cardio", "distance_duration", "none", ("full_body",)),
    "walking": _exercise("Walking", "cardio", "distance_duration", "none", ("quadriceps",)),
    "elliptical": _exercise("Elliptical", "cardio", "duration", "machine", ("full_body",)),
    "jump_rope": _exercise("Jump rope", "cardio", "duration", "other", ("calves",)),
    # Mobility and flexibility
    "hip_flexor_stretch": _exercise(
        "Hip flexor stretch", "flexibility", "duration", "none", ("hip_flexors",)
    ),
    "hamstring_stretch": _exercise(
        "Hamstring stretch", "flexibility", "duration", "none", ("hamstrings",)
    ),
    "cat_cow": _exercise("Cat-cow", "mobility", "reps", "none", ("lower_back",)),
    "worlds_greatest_stretch": _exercise(
        "World's greatest stretch", "mobility", "reps", "none", ("hip_flexors", "hamstrings")
    ),
    "foam_rolling": _exercise("Foam rolling", "mobility", "duration", "other", ("full_body",)),
    "yoga_flow": _exercise("Yoga flow", "flexibility", "duration", "none", ("full_body",)),
}
