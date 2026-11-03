"""Health and fitness models: profile, exercises, templates, workouts and sets, records and
analytics, measurements and photos, foods, meals, entries, water, activity, goals, links to
habits, the calendar, notes, and documents, and the dashboard.

Every value is in a canonical integer unit, named by its suffix: grams (`_g`), millimetres
(`_mm`), metres (`_m`), seconds (`_s`), millilitres (`_ml`), milligrams (`_mg`), small calories
(`_cal`; 1 kcal = 1,000 cal), and thousandths of a serving (`_milli`). Clients convert to and
from the person's units (`ProfileResponse`)."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints

from orbit_api.schemas.calendar import Alerts, CalendarDate, LocalDateTime, Title
from orbit_api.schemas.common import TimeZoneName, multi_line, single_line
from orbit_api.services.fitness.models import (
    MAX_MEAL_ITEMS,
    MAX_QUICK_AMOUNTS,
    MAX_SESSION_EXERCISES,
    MAX_SETS_PER_EXERCISE,
    MAX_TEMPLATE_EXERCISES,
    Activity,
    ActivityDraft,
    ActivityKind,
    Bmi,
    DashboardSection,
    DayTotal,
    DistanceUnit,
    EnergyUnit,
    Equipment,
    Exercise,
    ExerciseCategory,
    ExerciseDraft,
    ExerciseHistory,
    ExercisePoint,
    ExerciseType,
    Food,
    FoodDraft,
    FoodEntry,
    FoodEntryDraft,
    GoalCategory,
    GoalCheckIn,
    GoalDraft,
    GoalPace,
    GoalProgress,
    GoalStatus,
    HabitLink,
    HabitLinkDraft,
    HabitSource,
    LengthUnit,
    LinkedRecord,
    LinkTargetKind,
    LoggedExercise,
    LoggedSession,
    MealDraft,
    MealType,
    Measurement,
    MeasurementDraft,
    MeasurementValues,
    Milestone,
    Muscle,
    Nutrients,
    NutritionDay,
    Overview,
    PeriodCount,
    PersonalRecord,
    Photo,
    Portion,
    PortionDraft,
    PreviousPerformance,
    Profile,
    ProfileDraft,
    RecordKind,
    SavedMeal,
    ScheduledWorkout,
    SessionChanges,
    SessionDetail,
    SessionExercise,
    SessionStatus,
    SessionSummary,
    SetType,
    SetValues,
    Targets,
    Template,
    TemplateCategory,
    TemplateDraft,
    TemplateExercise,
    TemplateExerciseDraft,
    UnitSystem,
    WaterDay,
    WaterEntry,
    WaterUnit,
    WeightUnit,
    WorkoutAnalytics,
    WorkoutSet,
)
from orbit_api.services.fitness.records import exercise_volume_g
from orbit_api.utils.changes import UNSET

Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(single_line),
]
ServingUnit = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=20),
    AfterValidator(single_line),
]
CustomUnit = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=20), AfterValidator(single_line)
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(multi_line)
]
Instructions = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=5000), AfterValidator(multi_line)
]
Note = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=1000), AfterValidator(multi_line)
]
LongNote = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=5000), AfterValidator(multi_line)
]
Grams = Annotated[int, Field(ge=0, le=2_000_000, description="Grams.")]
Reps = Annotated[int, Field(ge=0, le=10_000)]
Seconds = Annotated[int, Field(ge=0, le=172_800, description="Seconds.")]
Metres = Annotated[int, Field(ge=0, le=1_000_000, description="Metres.")]
Rpe = Annotated[float, Field(ge=1, le=10, description="Effort, 1 to 10 in steps of 0.5.")]
Rest = Annotated[int, Field(ge=0, le=3600, description="Rest between sets, in seconds.")]
BodyMm = Annotated[int, Field(ge=10, le=3000, description="Millimetres.")]
HeightMm = Annotated[int, Field(ge=500, le=2720, description="Millimetres.")]
EnergyCal = Annotated[
    int, Field(ge=0, le=100_000_000, description="Small calories (1 kcal = 1,000 cal).")
]
Milligrams = Annotated[int, Field(ge=0, le=10_000_000, description="Milligrams.")]
QuantityMilli = Annotated[
    int, Field(ge=1, le=100_000_000, description="Thousandths of a unit (1.5 is 1500).")
]
GoalValue = Annotated[float, Field(ge=-1_000_000_000, le=1_000_000_000)]
Muscles = Annotated[list[Muscle], Field(max_length=10)]


def _unique[T](values: list[T]) -> list[T]:
    return list(dict.fromkeys(values))


# Shared


class LinkedRecordResponse(BaseModel):
    kind: LinkTargetKind
    id: uuid.UUID
    title: str

    @classmethod
    def of(cls, record: LinkedRecord) -> "LinkedRecordResponse":
        return cls(kind=record.kind, id=record.id, title=record.title)


class NutrientsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    energy_cal: EnergyCal = 0
    protein_mg: Milligrams = 0
    carbs_mg: Milligrams = 0
    fat_mg: Milligrams = 0
    fiber_mg: Milligrams | None = None

    @classmethod
    def of(cls, nutrients: Nutrients) -> "NutrientsModel":
        return cls(
            energy_cal=nutrients.energy_cal,
            protein_mg=nutrients.protein_mg,
            carbs_mg=nutrients.carbs_mg,
            fat_mg=nutrients.fat_mg,
            fiber_mg=nutrients.fiber_mg,
        )

    def to_nutrients(self) -> Nutrients:
        return Nutrients(
            energy_cal=self.energy_cal,
            protein_mg=self.protein_mg,
            carbs_mg=self.carbs_mg,
            fat_mg=self.fat_mg,
            fiber_mg=self.fiber_mg,
        )


class TargetsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    energy_cal: Annotated[int, Field(ge=1, le=20_000_000)] | None = None
    protein_mg: Annotated[int, Field(ge=1, le=2_000_000)] | None = None
    carbs_mg: Annotated[int, Field(ge=1, le=2_000_000)] | None = None
    fat_mg: Annotated[int, Field(ge=1, le=2_000_000)] | None = None
    fiber_mg: Annotated[int, Field(ge=1, le=2_000_000)] | None = None
    water_ml: Annotated[int, Field(ge=1, le=20_000)] | None = None

    @classmethod
    def of(cls, targets: Targets) -> "TargetsModel":
        return cls(
            energy_cal=targets.energy_cal,
            protein_mg=targets.protein_mg,
            carbs_mg=targets.carbs_mg,
            fat_mg=targets.fat_mg,
            fiber_mg=targets.fiber_mg,
            water_ml=targets.water_ml,
        )

    def to_targets(self) -> Targets:
        return Targets(
            energy_cal=self.energy_cal,
            protein_mg=self.protein_mg,
            carbs_mg=self.carbs_mg,
            fat_mg=self.fat_mg,
            fiber_mg=self.fiber_mg,
            water_ml=self.water_ml,
        )


class DayParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: CalendarDate = Field(description="A local date, such as `2026-11-02`.")


class RangeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate
    end: CalendarDate = Field(description="The last date, inclusive.")


# Profile


class ProfileRequest(BaseModel):
    """The whole profile; fields left out take their defaults."""

    model_config = ConfigDict(extra="forbid")

    unit_system: UnitSystem = "metric"
    weight_unit: WeightUnit = "kg"
    length_unit: LengthUnit = "cm"
    distance_unit: DistanceUnit = "km"
    energy_unit: EnergyUnit = "kcal"
    water_unit: WaterUnit = "ml"
    height_mm: HeightMm | None = None
    date_of_birth: CalendarDate | None = Field(
        default=None, description="Optional; not needed for anything Orbit calculates."
    )
    targets: TargetsModel = Field(default_factory=TargetsModel)
    water_quick_amounts_ml: Annotated[
        list[Annotated[int, Field(ge=1, le=5000)]], Field(max_length=MAX_QUICK_AMOUNTS)
    ] = Field(default_factory=lambda: [250, 500, 750])
    hidden_sections: Annotated[list[DashboardSection], AfterValidator(_unique)] = Field(
        default_factory=list[DashboardSection]
    )

    def to_draft(self) -> ProfileDraft:
        return ProfileDraft(
            unit_system=self.unit_system,
            weight_unit=self.weight_unit,
            length_unit=self.length_unit,
            distance_unit=self.distance_unit,
            energy_unit=self.energy_unit,
            water_unit=self.water_unit,
            height_mm=self.height_mm,
            date_of_birth=self.date_of_birth,
            targets=self.targets.to_targets(),
            water_quick_amounts_ml=tuple(self.water_quick_amounts_ml),
            hidden_sections=tuple(self.hidden_sections),
        )


class ProfileResponse(BaseModel):
    unit_system: UnitSystem
    weight_unit: WeightUnit
    length_unit: LengthUnit
    distance_unit: DistanceUnit
    energy_unit: EnergyUnit
    water_unit: WaterUnit
    height_mm: int | None
    date_of_birth: date | None
    targets: TargetsModel
    water_quick_amounts_ml: list[int]
    hidden_sections: list[DashboardSection]
    updated_at: datetime

    @classmethod
    def of(cls, profile: Profile) -> "ProfileResponse":
        s = profile.settings
        return cls(
            unit_system=s.unit_system,
            weight_unit=s.weight_unit,
            length_unit=s.length_unit,
            distance_unit=s.distance_unit,
            energy_unit=s.energy_unit,
            water_unit=s.water_unit,
            height_mm=s.height_mm,
            date_of_birth=s.date_of_birth,
            targets=TargetsModel.of(s.targets),
            water_quick_amounts_ml=list(s.water_quick_amounts_ml),
            hidden_sections=list(s.hidden_sections),
            updated_at=profile.updated_at,
        )


# Exercises


class ExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    category: ExerciseCategory
    exercise_type: ExerciseType = Field(
        description="What a set records: weight and reps, reps, duration, or distance and "
        "duration. It decides which records apply."
    )
    equipment: Equipment = "none"
    description: Description = ""
    instructions: Instructions = ""
    primary_muscles: Annotated[Muscles, AfterValidator(_unique)] = Field(
        default_factory=list[Muscle]
    )
    secondary_muscles: Annotated[Muscles, AfterValidator(_unique)] = Field(
        default_factory=list[Muscle]
    )

    def to_draft(self) -> ExerciseDraft:
        return ExerciseDraft(
            name=self.name,
            category=self.category,
            exercise_type=self.exercise_type,
            equipment=self.equipment,
            description=self.description,
            instructions=self.instructions,
            primary_muscles=tuple(self.primary_muscles),
            secondary_muscles=tuple(self.secondary_muscles),
        )


class ExerciseResponse(BaseModel):
    id: uuid.UUID
    name: str
    category: ExerciseCategory
    exercise_type: ExerciseType
    equipment: Equipment
    description: str
    instructions: str
    primary_muscles: list[Muscle]
    secondary_muscles: list[Muscle]
    is_custom: bool
    builtin_key: str | None
    """The stable key of a built-in exercise, for ready-made templates; `None` when custom."""
    archived: bool
    updated_at: datetime

    @classmethod
    def of(cls, exercise: Exercise) -> "ExerciseResponse":
        d = exercise.details
        return cls(
            id=exercise.id,
            name=d.name,
            category=d.category,
            exercise_type=d.exercise_type,
            equipment=d.equipment,
            description=d.description,
            instructions=d.instructions,
            primary_muscles=list(d.primary_muscles),
            secondary_muscles=list(d.secondary_muscles),
            is_custom=exercise.is_custom,
            builtin_key=exercise.builtin_key,
            archived=exercise.archived_at is not None,
            updated_at=exercise.updated_at,
        )


class ExerciseListResponse(BaseModel):
    exercises: list[ExerciseResponse]


class ArchiveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    archived: bool


# Templates


class TemplateExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_id: uuid.UUID
    sets: int = Field(default=3, ge=1, le=20)
    target_reps_min: Annotated[int, Field(ge=1, le=1000)] | None = None
    target_reps_max: Annotated[int, Field(ge=1, le=1000)] | None = None
    target_weight_g: Grams | None = None
    target_duration_s: Annotated[int, Field(ge=1, le=172_800)] | None = None
    target_distance_m: Annotated[int, Field(ge=1, le=1_000_000)] | None = None
    rest_seconds: Rest | None = None
    notes: Note = ""

    def to_draft(self) -> TemplateExerciseDraft:
        return TemplateExerciseDraft(
            exercise_id=self.exercise_id,
            sets=self.sets,
            target_reps_min=self.target_reps_min,
            target_reps_max=self.target_reps_max,
            target_weight_g=self.target_weight_g,
            target_duration_s=self.target_duration_s,
            target_distance_m=self.target_distance_m,
            rest_seconds=self.rest_seconds,
            notes=self.notes,
        )


class TemplateRequest(BaseModel):
    """The whole template. Exercises are in order; the list replaces the current one."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    category: TemplateCategory = "other"
    description: Description = ""
    notes: LongNote = ""
    exercises: list[TemplateExerciseRequest] = Field(
        default_factory=list[TemplateExerciseRequest], max_length=MAX_TEMPLATE_EXERCISES
    )

    def to_draft(self) -> TemplateDraft:
        return TemplateDraft(
            name=self.name,
            category=self.category,
            description=self.description,
            notes=self.notes,
            exercises=tuple(e.to_draft() for e in self.exercises),
        )


class TemplateExerciseResponse(BaseModel):
    id: uuid.UUID
    position: int
    exercise_id: uuid.UUID
    exercise_name: str
    exercise_type: ExerciseType
    sets: int
    target_reps_min: int | None
    target_reps_max: int | None
    target_weight_g: int | None
    target_duration_s: int | None
    target_distance_m: int | None
    rest_seconds: int | None
    notes: str

    @classmethod
    def of(cls, item: TemplateExercise) -> "TemplateExerciseResponse":
        p = item.plan
        return cls(
            id=item.id,
            position=item.position,
            exercise_id=item.exercise.id,
            exercise_name=item.exercise.details.name,
            exercise_type=item.exercise.details.exercise_type,
            sets=p.sets,
            target_reps_min=p.target_reps_min,
            target_reps_max=p.target_reps_max,
            target_weight_g=p.target_weight_g,
            target_duration_s=p.target_duration_s,
            target_distance_m=p.target_distance_m,
            rest_seconds=p.rest_seconds,
            notes=p.notes,
        )


class TemplateResponse(BaseModel):
    id: uuid.UUID
    name: str
    category: TemplateCategory
    description: str
    notes: str
    archived: bool
    exercises: list[TemplateExerciseResponse]
    updated_at: datetime

    @classmethod
    def of(cls, template: Template) -> "TemplateResponse":
        return cls(
            id=template.id,
            name=template.name,
            category=template.category,
            description=template.description,
            notes=template.notes,
            archived=template.archived_at is not None,
            exercises=[TemplateExerciseResponse.of(e) for e in template.exercises],
            updated_at=template.updated_at,
        )


class TemplateListResponse(BaseModel):
    templates: list[TemplateResponse]


# Workouts


class SetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    set_type: SetType = "working"
    reps: Reps | None = None
    weight_g: Grams | None = None
    duration_s: Seconds | None = None
    distance_m: Metres | None = None
    rpe: Rpe | None = None
    completed: bool = False

    def to_values(self) -> SetValues:
        return SetValues(
            set_type=self.set_type,
            reps=self.reps,
            weight_g=self.weight_g,
            duration_s=self.duration_s,
            distance_m=self.distance_m,
            rpe=self.rpe,
            completed=self.completed,
        )


class SetResponse(BaseModel):
    id: uuid.UUID
    position: int
    set_type: SetType
    reps: int | None
    weight_g: int | None
    duration_s: int | None
    distance_m: int | None
    rpe: float | None
    completed: bool
    completed_at: datetime | None

    @classmethod
    def of(cls, item: WorkoutSet) -> "SetResponse":
        v = item.values
        return cls(
            id=item.id,
            position=item.position,
            set_type=v.set_type,
            reps=v.reps,
            weight_g=v.weight_g,
            duration_s=v.duration_s,
            distance_m=v.distance_m,
            rpe=v.rpe,
            completed=v.completed,
            completed_at=item.completed_at,
        )


class PreviousPerformanceResponse(BaseModel):
    session_id: uuid.UUID
    day: date
    sets: list[SetResponse]

    @classmethod
    def of(cls, previous: PreviousPerformance) -> "PreviousPerformanceResponse":
        return cls(
            session_id=previous.session_id,
            day=previous.day,
            sets=[SetResponse.of(s) for s in previous.sets],
        )


class SessionExerciseResponse(BaseModel):
    id: uuid.UUID
    exercise_id: uuid.UUID | None = Field(description="`null` once the exercise is deleted.")
    position: int
    name: str = Field(description="The exercise's name when it was added.")
    exercise_type: ExerciseType
    category: ExerciseCategory
    primary_muscles: list[Muscle]
    rest_seconds: int | None
    notes: str
    volume_g: int = Field(description="Gram-reps: weight times reps of counted sets.")
    sets: list[SetResponse]
    previous: PreviousPerformanceResponse | None

    @classmethod
    def of(
        cls, item: SessionExercise, previous: PreviousPerformance | None, volume_g: int
    ) -> "SessionExerciseResponse":
        return cls(
            id=item.id,
            exercise_id=item.exercise_id,
            position=item.position,
            name=item.snapshot.name,
            exercise_type=item.snapshot.exercise_type,
            category=item.snapshot.category,
            primary_muscles=list(item.snapshot.primary_muscles),
            rest_seconds=item.rest_seconds,
            notes=item.notes,
            volume_g=volume_g,
            sets=[SetResponse.of(s) for s in item.sets],
            previous=PreviousPerformanceResponse.of(previous) if previous else None,
        )


class SessionResponse(BaseModel):
    id: uuid.UUID
    name: str
    day: date
    timezone: str
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None
    paused_at: datetime | None
    paused_seconds: int
    duration_s: int | None = Field(description="Set when it ends: elapsed time minus pauses.")
    notes: str
    template_id: uuid.UUID | None
    template_name: str | None
    calendar_event_id: uuid.UUID | None
    volume_g: int
    exercises: list[SessionExerciseResponse]
    links: list[LinkedRecordResponse]

    @classmethod
    def of(cls, detail: SessionDetail) -> "SessionResponse":
        s = detail.session
        return cls(
            id=s.id,
            name=s.name,
            day=s.day,
            timezone=s.timezone,
            status=s.status,
            started_at=s.started_at,
            ended_at=s.ended_at,
            paused_at=s.paused_at,
            paused_seconds=s.paused_seconds,
            duration_s=s.duration_s,
            notes=s.notes,
            template_id=s.template_id,
            template_name=detail.template_name,
            calendar_event_id=s.calendar_event_id,
            volume_g=detail.volume_g,
            exercises=[
                SessionExerciseResponse.of(
                    e,
                    detail.previous.get(e.exercise_id) if e.exercise_id else None,
                    exercise_volume_g(e),
                )
                for e in detail.exercises
            ],
            links=[LinkedRecordResponse.of(link) for link in detail.links],
        )


class ActiveSessionResponse(BaseModel):
    session: SessionResponse | None


class SessionSummaryResponse(BaseModel):
    id: uuid.UUID
    name: str
    day: date
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None
    duration_s: int | None
    template_id: uuid.UUID | None
    exercise_count: int
    set_count: int = Field(description="Completed sets.")
    volume_g: int

    @classmethod
    def of(cls, summary: SessionSummary) -> "SessionSummaryResponse":
        s = summary.session
        return cls(
            id=s.id,
            name=s.name,
            day=s.day,
            status=s.status,
            started_at=s.started_at,
            ended_at=s.ended_at,
            duration_s=s.duration_s,
            template_id=s.template_id,
            exercise_count=summary.exercise_count,
            set_count=summary.set_count,
            volume_g=summary.volume_g,
        )


class SessionListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate | None = None
    end: CalendarDate | None = None
    status: Literal["completed", "abandoned", "unfinished", "all"] = "all"
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)

    def statuses(self) -> tuple[SessionStatus, ...]:
        if self.status == "all":
            return ()
        if self.status == "unfinished":
            return ("active", "paused")
        return (self.status,)


class SessionListResponse(BaseModel):
    sessions: list[SessionSummaryResponse]


class StartSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate = Field(description="The local date the workout is on.")
    timezone: TimeZoneName | None = Field(
        default=None, description="Defaults to the user's preference, else UTC."
    )
    name: Name | None = Field(default=None, description="Defaults to the template's name.")
    template_id: uuid.UUID | None = None
    calendar_event_id: uuid.UUID | None = Field(
        default=None, description="A scheduled workout's event; its template is used."
    )


class LoggedExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_id: uuid.UUID
    notes: Note = ""
    sets: list[SetRequest] = Field(
        default_factory=list[SetRequest], max_length=MAX_SETS_PER_EXERCISE
    )

    def to_logged(self) -> LoggedExercise:
        return LoggedExercise(
            exercise_id=self.exercise_id,
            notes=self.notes,
            sets=tuple(s.to_values() for s in self.sets),
        )


class LogSessionRequest(BaseModel):
    """A workout that already happened, recorded as completed."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    day: CalendarDate
    timezone: TimeZoneName | None = None
    started_at: AwareDatetime
    ended_at: AwareDatetime
    notes: LongNote = ""
    template_id: uuid.UUID | None = None
    exercises: list[LoggedExerciseRequest] = Field(
        default_factory=list[LoggedExerciseRequest], max_length=MAX_SESSION_EXERCISES
    )

    def to_logged(self, timezone: str) -> LoggedSession:
        return LoggedSession(
            name=self.name,
            day=self.day,
            timezone=timezone,
            started_at=self.started_at,
            ended_at=self.ended_at,
            notes=self.notes,
            template_id=self.template_id,
            exercises=tuple(e.to_logged() for e in self.exercises),
        )


class UpdateSessionRequest(BaseModel):
    """Only the fields sent change. Times can be corrected once the workout has ended."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    notes: LongNote | None = None
    day: CalendarDate | None = None
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None

    def to_changes(self) -> SessionChanges:
        return SessionChanges(
            name=self.name if self.name is not None else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
            day=self.day if self.day is not None else UNSET,
            started_at=self.started_at if self.started_at is not None else UNSET,
            ended_at=self.ended_at if self.ended_at is not None else UNSET,
        )


class AddSessionExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_id: uuid.UUID


class UpdateSessionExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rest_seconds: Rest | None = None
    notes: Note = ""


class ReorderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_ids: list[uuid.UUID] = Field(max_length=MAX_SESSION_EXERCISES)


class AddSetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: SetRequest | None = Field(
        default=None, description="Leave out to copy the last set (not yet done)."
    )


# Records and analytics


class PersonalRecordResponse(BaseModel):
    exercise_id: uuid.UUID
    exercise_name: str
    kind: RecordKind
    value: int = Field(description="Grams, reps, gram-reps, seconds, or metres, by kind.")
    reps: int | None
    weight_g: int | None
    day: date
    session_id: uuid.UUID
    estimated: bool = Field(description="An estimate (one-rep max), not a lift performed.")

    @classmethod
    def of(cls, record: PersonalRecord) -> "PersonalRecordResponse":
        return cls(
            exercise_id=record.exercise_id,
            exercise_name=record.exercise_name,
            kind=record.kind,
            value=record.value,
            reps=record.reps,
            weight_g=record.weight_g,
            day=record.day,
            session_id=record.session_id,
            estimated=record.estimated,
        )


class RecordListResponse(BaseModel):
    records: list[PersonalRecordResponse]


class ExercisePointResponse(BaseModel):
    day: date
    session_id: uuid.UUID
    max_weight_g: int | None
    estimated_1rm_g: int | None
    volume_g: int
    max_reps: int | None
    max_duration_s: int | None
    max_distance_m: int | None
    sets: list[SetResponse]

    @classmethod
    def of(cls, point: ExercisePoint) -> "ExercisePointResponse":
        return cls(
            day=point.day,
            session_id=point.session_id,
            max_weight_g=point.max_weight_g,
            estimated_1rm_g=point.estimated_1rm_g,
            volume_g=point.volume_g,
            max_reps=point.max_reps,
            max_duration_s=point.max_duration_s,
            max_distance_m=point.max_distance_m,
            sets=[SetResponse.of(s) for s in point.sets],
        )


class ExerciseHistoryResponse(BaseModel):
    exercise: ExerciseResponse
    points: list[ExercisePointResponse]
    records: list[PersonalRecordResponse]

    @classmethod
    def of(cls, history: ExerciseHistory) -> "ExerciseHistoryResponse":
        return cls(
            exercise=ExerciseResponse.of(history.exercise),
            points=[ExercisePointResponse.of(p) for p in history.points],
            records=[PersonalRecordResponse.of(r) for r in history.records],
        )


class PeriodCountResponse(BaseModel):
    start: date
    workouts: int
    duration_s: int
    volume_g: int

    @classmethod
    def of(cls, period: PeriodCount) -> "PeriodCountResponse":
        return cls(
            start=period.start,
            workouts=period.workouts,
            duration_s=period.duration_s,
            volume_g=period.volume_g,
        )


class AnalyticsParams(RangeParams):
    date: CalendarDate = Field(description="Today, for the streak.")


class WorkoutAnalyticsResponse(BaseModel):
    start: date
    end: date
    workouts: int
    duration_s: int
    volume_g: int
    weekly: list[PeriodCountResponse]
    monthly: list[PeriodCountResponse]
    muscle_sets: dict[str, int] = Field(description="Counted sets per primary muscle.")
    active_weeks: int
    total_weeks: int
    current_week_streak: int
    records: list[PersonalRecordResponse] = Field(description="Records set in the range.")

    @classmethod
    def of(cls, result: WorkoutAnalytics) -> "WorkoutAnalyticsResponse":
        return cls(
            start=result.start,
            end=result.end,
            workouts=result.workouts,
            duration_s=result.duration_s,
            volume_g=result.volume_g,
            weekly=[PeriodCountResponse.of(p) for p in result.weekly],
            monthly=[PeriodCountResponse.of(p) for p in result.monthly],
            muscle_sets=result.muscle_sets,
            active_weeks=result.active_weeks,
            total_weeks=result.total_weeks,
            current_week_streak=result.current_week_streak,
            records=[PersonalRecordResponse.of(r) for r in result.records],
        )


# Body


class MeasurementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate
    weight_g: Annotated[int, Field(ge=1000, le=650_000)] | None = None
    body_fat_pct: Annotated[float, Field(gt=0, lt=100)] | None = Field(
        default=None, description="As measured; Orbit never estimates it."
    )
    height_mm: HeightMm | None = None
    waist_mm: BodyMm | None = None
    chest_mm: BodyMm | None = None
    hips_mm: BodyMm | None = None
    arm_mm: BodyMm | None = None
    thigh_mm: BodyMm | None = None
    neck_mm: BodyMm | None = None
    note: Note = ""

    def to_draft(self) -> MeasurementDraft:
        return MeasurementDraft(
            day=self.day,
            values=MeasurementValues(
                weight_g=self.weight_g,
                body_fat_pct=round(self.body_fat_pct, 1) if self.body_fat_pct else None,
                height_mm=self.height_mm,
                waist_mm=self.waist_mm,
                chest_mm=self.chest_mm,
                hips_mm=self.hips_mm,
                arm_mm=self.arm_mm,
                thigh_mm=self.thigh_mm,
                neck_mm=self.neck_mm,
            ),
            note=self.note,
        )


class MeasurementResponse(BaseModel):
    id: uuid.UUID
    day: date
    weight_g: int | None
    body_fat_pct: float | None
    height_mm: int | None
    waist_mm: int | None
    chest_mm: int | None
    hips_mm: int | None
    arm_mm: int | None
    thigh_mm: int | None
    neck_mm: int | None
    note: str
    updated_at: datetime

    @classmethod
    def of(cls, m: Measurement) -> "MeasurementResponse":
        v = m.values
        return cls(
            id=m.id,
            day=m.day,
            weight_g=v.weight_g,
            body_fat_pct=v.body_fat_pct,
            height_mm=v.height_mm,
            waist_mm=v.waist_mm,
            chest_mm=v.chest_mm,
            hips_mm=v.hips_mm,
            arm_mm=v.arm_mm,
            thigh_mm=v.thigh_mm,
            neck_mm=v.neck_mm,
            note=m.note,
            updated_at=m.updated_at,
        )


class BmiResponse(BaseModel):
    value: float = Field(
        description="A general measure of weight for height; not an assessment of health."
    )
    weight_g: int
    height_mm: int
    weight_day: date

    @classmethod
    def of(cls, value: Bmi) -> "BmiResponse":
        return cls(
            value=value.value,
            weight_g=value.weight_g,
            height_mm=value.height_mm,
            weight_day=value.weight_day,
        )


class MeasurementListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate | None = None
    end: CalendarDate | None = None


class MeasurementListResponse(BaseModel):
    measurements: list[MeasurementResponse] = Field(description="Oldest first.")
    bmi: BmiResponse | None = Field(description="`null` without a valid weight and height.")


class PhotoResponse(BaseModel):
    id: uuid.UUID
    day: date
    note: str
    content_type: str
    size_bytes: int
    created_at: datetime

    @classmethod
    def of(cls, photo: Photo) -> "PhotoResponse":
        return cls(
            id=photo.id,
            day=photo.day,
            note=photo.note,
            content_type=photo.content_type,
            size_bytes=photo.size_bytes,
            created_at=photo.created_at,
        )


class PhotoListResponse(BaseModel):
    photos: list[PhotoResponse] = Field(description="Newest first.")


class PhotoUploadParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    day: CalendarDate
    note: Note = ""


# Nutrition


class FoodRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    serving_quantity_milli: QuantityMilli = Field(
        description="How much one serving is, in thousandths of the unit (100 g is 100000)."
    )
    serving_unit: ServingUnit
    nutrients: NutrientsModel = Field(description="For one serving.")

    def to_draft(self) -> FoodDraft:
        return FoodDraft(
            name=self.name,
            serving_quantity_milli=self.serving_quantity_milli,
            serving_unit=self.serving_unit,
            nutrients=self.nutrients.to_nutrients(),
        )


class FoodResponse(BaseModel):
    id: uuid.UUID
    name: str
    serving_quantity_milli: int
    serving_unit: str
    nutrients: NutrientsModel
    use_count: int
    last_used_at: datetime | None

    @classmethod
    def of(cls, food: Food) -> "FoodResponse":
        return cls(
            id=food.id,
            name=food.details.name,
            serving_quantity_milli=food.details.serving_quantity_milli,
            serving_unit=food.details.serving_unit,
            nutrients=NutrientsModel.of(food.details.nutrients),
            use_count=food.use_count,
            last_used_at=food.last_used_at,
        )


class FoodListResponse(BaseModel):
    foods: list[FoodResponse] = Field(description="Most used first.")


class PortionRequest(BaseModel):
    """A saved food (`food_id`; its nutrients are scaled to the quantity), or a name, unit,
    and nutrients typed in for this quantity."""

    model_config = ConfigDict(extra="forbid")

    quantity_milli: QuantityMilli
    food_id: uuid.UUID | None = None
    name: Name | None = None
    serving_unit: ServingUnit | None = None
    nutrients: NutrientsModel | None = None

    def to_draft(self) -> PortionDraft:
        return PortionDraft(
            quantity_milli=self.quantity_milli,
            food_id=self.food_id,
            name=self.name,
            serving_unit=self.serving_unit,
            nutrients=self.nutrients.to_nutrients() if self.nutrients else None,
        )


class PortionResponse(BaseModel):
    food_id: uuid.UUID | None
    name: str
    quantity_milli: int
    serving_unit: str
    nutrients: NutrientsModel

    @classmethod
    def of(cls, portion: Portion) -> "PortionResponse":
        return cls(
            food_id=portion.food_id,
            name=portion.name,
            quantity_milli=portion.quantity_milli,
            serving_unit=portion.serving_unit,
            nutrients=NutrientsModel.of(portion.nutrients),
        )


class MealRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    items: list[PortionRequest] = Field(min_length=1, max_length=MAX_MEAL_ITEMS)

    def to_draft(self) -> MealDraft:
        return MealDraft(name=self.name, items=tuple(i.to_draft() for i in self.items))


class MealResponse(BaseModel):
    id: uuid.UUID
    name: str
    items: list[PortionResponse]
    totals: NutrientsModel

    @classmethod
    def of(cls, meal: SavedMeal) -> "MealResponse":
        return cls(
            id=meal.id,
            name=meal.name,
            items=[PortionResponse.of(i) for i in meal.items],
            totals=NutrientsModel.of(meal.totals),
        )


class MealListResponse(BaseModel):
    meals: list[MealResponse]


class LogMealRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate
    meal: MealType


class FoodEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate
    meal: MealType
    portion: PortionRequest
    note: Note = ""

    def to_draft(self) -> FoodEntryDraft:
        return FoodEntryDraft(
            day=self.day, meal=self.meal, portion=self.portion.to_draft(), note=self.note
        )


class FoodEntryResponse(BaseModel):
    id: uuid.UUID
    day: date
    meal: MealType
    portion: PortionResponse
    note: str

    @classmethod
    def of(cls, entry: FoodEntry) -> "FoodEntryResponse":
        return cls(
            id=entry.id,
            day=entry.day,
            meal=entry.meal,
            portion=PortionResponse.of(entry.portion),
            note=entry.note,
        )


class FoodEntryListResponse(BaseModel):
    entries: list[FoodEntryResponse]


class NutritionDayResponse(BaseModel):
    day: date
    entries: list[FoodEntryResponse]
    totals: NutrientsModel
    by_meal: dict[MealType, NutrientsModel]
    targets: TargetsModel

    @classmethod
    def of(cls, result: NutritionDay) -> "NutritionDayResponse":
        return cls(
            day=result.day,
            entries=[FoodEntryResponse.of(e) for e in result.entries],
            totals=NutrientsModel.of(result.totals),
            by_meal={k: NutrientsModel.of(v) for k, v in result.by_meal.items()},
            targets=TargetsModel.of(result.targets),
        )


class DayTotalResponse(BaseModel):
    day: date
    nutrients: NutrientsModel
    entries: int

    @classmethod
    def of(cls, total: DayTotal) -> "DayTotalResponse":
        return cls(
            day=total.day, nutrients=NutrientsModel.of(total.nutrients), entries=total.entries
        )


class NutritionHistoryResponse(BaseModel):
    days: list[DayTotalResponse] = Field(description="Days with entries, oldest first.")


class WaterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate
    amount_ml: int = Field(ge=1, le=10_000)


class WaterEntryResponse(BaseModel):
    id: uuid.UUID
    amount_ml: int
    created_at: datetime

    @classmethod
    def of(cls, entry: WaterEntry) -> "WaterEntryResponse":
        return cls(id=entry.id, amount_ml=entry.amount_ml, created_at=entry.created_at)


class WaterDayResponse(BaseModel):
    day: date
    entries: list[WaterEntryResponse]
    total_ml: int
    target_ml: int | None

    @classmethod
    def of(cls, result: WaterDay) -> "WaterDayResponse":
        return cls(
            day=result.day,
            entries=[WaterEntryResponse.of(e) for e in result.entries],
            total_ml=result.total_ml,
            target_ml=result.target_ml,
        )


class WaterTotalResponse(BaseModel):
    day: date
    total_ml: int


class WaterHistoryResponse(BaseModel):
    days: list[WaterTotalResponse] = Field(description="Days with water, oldest first.")


# Activity


class ActivityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate
    kind: ActivityKind
    steps: Annotated[int, Field(ge=1, le=200_000)] | None = None
    distance_m: Annotated[int, Field(ge=1, le=1_000_000)] | None = None
    duration_s: Annotated[int, Field(ge=1, le=86_400)] | None = None
    note: Note = ""

    def to_draft(self) -> ActivityDraft:
        return ActivityDraft(
            day=self.day,
            kind=self.kind,
            steps=self.steps,
            distance_m=self.distance_m,
            duration_s=self.duration_s,
            note=self.note,
        )


class ActivityResponse(BaseModel):
    id: uuid.UUID
    day: date
    kind: ActivityKind
    steps: int | None
    distance_m: int | None
    duration_s: int | None
    note: str
    source: Literal["manual"] = Field(description="Recorded by hand; nothing is imported yet.")

    @classmethod
    def of(cls, activity: Activity) -> "ActivityResponse":
        d = activity.details
        return cls(
            id=activity.id,
            day=d.day,
            kind=d.kind,
            steps=d.steps,
            distance_m=d.distance_m,
            duration_s=d.duration_s,
            note=d.note,
            source=activity.source,
        )


class ActivityListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate | None = None
    end: CalendarDate | None = None
    kind: ActivityKind | None = None
    limit: int = Field(default=100, ge=1, le=500)


class ActivityListResponse(BaseModel):
    activities: list[ActivityResponse] = Field(description="Newest first.")


# Goals


class GoalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    category: GoalCategory
    start_value: GoalValue
    target_value: GoalValue
    start_date: CalendarDate
    unit: CustomUnit = Field(
        default="", description="Custom goals only; built-in kinds use canonical units."
    )
    description: Description = ""
    target_date: CalendarDate | None = None
    auto_track: bool = Field(
        default=False,
        description="Body-weight goals read weight measurements; strength goals read the "
        "exercise's heaviest set per workout.",
    )
    exercise_id: uuid.UUID | None = None
    habit_id: uuid.UUID | None = None

    def to_draft(self) -> GoalDraft:
        return GoalDraft(
            name=self.name,
            category=self.category,
            start_value=self.start_value,
            target_value=self.target_value,
            start_date=self.start_date,
            unit=self.unit,
            description=self.description,
            target_date=self.target_date,
            auto_track=self.auto_track,
            exercise_id=self.exercise_id,
            habit_id=self.habit_id,
        )


class GoalStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: GoalStatus


class CheckInRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: CalendarDate
    value: GoalValue
    note: Note = ""


class CheckInResponse(BaseModel):
    id: uuid.UUID
    day: date
    value: float
    note: str
    source: Literal["manual", "measurement", "workout"]

    @classmethod
    def of(cls, item: GoalCheckIn) -> "CheckInResponse":
        return cls(id=item.id, day=item.day, value=item.value, note=item.note, source=item.source)


class MilestoneResponse(BaseModel):
    fraction: float
    value: float
    expected_by: date | None
    reached_on: date | None

    @classmethod
    def of(cls, item: Milestone) -> "MilestoneResponse":
        return cls(
            fraction=item.fraction,
            value=item.value,
            expected_by=item.expected_by,
            reached_on=item.reached_on,
        )


class FitnessGoalResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    category: GoalCategory
    unit: str
    start_value: float
    target_value: float
    current_value: float
    fraction: float = Field(description="0 to 1: progress from the start value to the target.")
    reached: bool
    pace: GoalPace
    start_date: date
    target_date: date | None
    status: GoalStatus
    completed_at: datetime | None
    auto_track: bool
    exercise_id: uuid.UUID | None
    exercise_name: str | None
    habit_id: uuid.UUID | None
    habit_name: str | None
    history: list[CheckInResponse]
    milestones: list[MilestoneResponse]
    links: list[LinkedRecordResponse]

    @classmethod
    def of(cls, progress: GoalProgress) -> "FitnessGoalResponse":
        goal = progress.goal
        d = goal.details
        return cls(
            id=goal.id,
            name=d.name,
            description=d.description,
            category=d.category,
            unit=d.unit,
            start_value=d.start_value,
            target_value=d.target_value,
            current_value=progress.current_value,
            fraction=progress.fraction,
            reached=progress.reached,
            pace=progress.pace,
            start_date=d.start_date,
            target_date=d.target_date,
            status=goal.status,
            completed_at=goal.completed_at,
            auto_track=d.auto_track,
            exercise_id=d.exercise_id,
            exercise_name=progress.exercise_name,
            habit_id=d.habit_id,
            habit_name=progress.habit_name,
            history=[CheckInResponse.of(c) for c in progress.history],
            milestones=[MilestoneResponse.of(m) for m in progress.milestones],
            links=[LinkedRecordResponse.of(link) for link in progress.links],
        )


class GoalListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["active", "paused", "completed", "all"] = "all"
    date: CalendarDate = Field(description="Today, for pace.")


class GoalDateParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: CalendarDate = Field(description="Today, for pace.")


class FitnessGoalListResponse(BaseModel):
    goals: list[FitnessGoalResponse]


# Integrations


class HabitLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    habit_id: uuid.UUID
    source: HabitSource
    activity_kind: ActivityKind | None = None
    contributes: bool = Field(
        default=False,
        description="Record progress on the habit when matching records are saved.",
    )

    def to_draft(self) -> HabitLinkDraft:
        return HabitLinkDraft(
            habit_id=self.habit_id,
            source=self.source,
            activity_kind=self.activity_kind,
            contributes=self.contributes,
        )


class HabitLinkResponse(BaseModel):
    habit_id: uuid.UUID
    habit_name: str
    habit_kind: str
    source: HabitSource
    activity_kind: ActivityKind | None
    contributes: bool

    @classmethod
    def of(cls, link: HabitLink) -> "HabitLinkResponse":
        return cls(
            habit_id=link.habit_id,
            habit_name=link.habit_name,
            habit_kind=link.habit_kind,
            source=link.source,
            activity_kind=link.activity_kind,
            contributes=link.contributes,
        )


class HabitLinkListResponse(BaseModel):
    links: list[HabitLinkResponse]


class ScheduleWorkoutRequest(BaseModel):
    """Creates an ordinary calendar event for the workout and links it."""

    model_config = ConfigDict(extra="forbid")

    template_id: uuid.UUID | None = None
    title: Title | None = Field(default=None, description="Defaults to the template's name.")
    start: LocalDateTime
    end: LocalDateTime
    timezone: TimeZoneName | None = None
    alerts: Alerts = Field(default_factory=list[int])


class LinkEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: uuid.UUID | None = None


class ScheduledWorkoutResponse(BaseModel):
    calendar_event_id: uuid.UUID
    title: str
    template_id: uuid.UUID | None
    template_name: str | None
    start_at: datetime | None
    end_at: datetime | None
    session_ids: list[uuid.UUID] = Field(description="Workouts started from this event.")

    @classmethod
    def of(cls, item: ScheduledWorkout) -> "ScheduledWorkoutResponse":
        return cls(
            calendar_event_id=item.calendar_event_id,
            title=item.title,
            template_id=item.template_id,
            template_name=item.template_name,
            start_at=item.start_at,
            end_at=item.end_at,
            session_ids=list(item.session_ids),
        )


class ScheduleParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: CalendarDate
    end: CalendarDate = Field(description="The day after the last date (exclusive).")
    timezone: TimeZoneName | None = None


class ScheduledWorkoutListResponse(BaseModel):
    workouts: list[ScheduledWorkoutResponse]


class LinkListResponse(BaseModel):
    links: list[LinkedRecordResponse]


class CreateLinkedNoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(single_line)
    ] = ""


# Overview


class OverviewParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: CalendarDate
    timezone: TimeZoneName | None = None


class WeightPointResponse(BaseModel):
    day: date
    weight_g: int


class FitnessOverviewResponse(BaseModel):
    day: date
    active_session: SessionSummaryResponse | None
    completed_today: list[SessionSummaryResponse]
    scheduled_today: list[ScheduledWorkoutResponse]
    recent_sessions: list[SessionSummaryResponse]
    week_workouts: int
    weight_trend: list[WeightPointResponse]
    goals: list[FitnessGoalResponse]
    nutrition: NutrientsModel
    targets: TargetsModel
    water_ml: int
    recent_activities: list[ActivityResponse]
    records: list[PersonalRecordResponse]
    hidden_sections: list[DashboardSection]

    @classmethod
    def of(cls, overview: Overview) -> "FitnessOverviewResponse":
        active = overview.active_session
        return cls(
            day=overview.day,
            active_session=SessionSummaryResponse.of(SessionSummary(active, 0, 0, 0))
            if active
            else None,
            completed_today=[SessionSummaryResponse.of(s) for s in overview.completed_today],
            scheduled_today=[ScheduledWorkoutResponse.of(s) for s in overview.scheduled_today],
            recent_sessions=[SessionSummaryResponse.of(s) for s in overview.recent_sessions],
            week_workouts=overview.week_workouts,
            weight_trend=[
                WeightPointResponse(day=p.day, weight_g=p.weight_g) for p in overview.weight_trend
            ],
            goals=[FitnessGoalResponse.of(g) for g in overview.goals],
            nutrition=NutrientsModel.of(overview.nutrition),
            targets=TargetsModel.of(overview.targets),
            water_ml=overview.water_ml,
            recent_activities=[ActivityResponse.of(a) for a in overview.recent_activities],
            records=[PersonalRecordResponse.of(r) for r in overview.records],
            hidden_sections=list(overview.hidden_sections),
        )
