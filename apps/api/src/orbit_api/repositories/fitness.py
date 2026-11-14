"""Health and fitness. Top-level queries filter by workspace **and** owning user, so one person's
health records never reach another, even in a workspace someone else can open; rows reached
through an owned parent (sets, template exercises, meal items, check-ins) are filtered by
workspace and parent. Links inside the module are composite foreign keys, so the database refuses
cross-workspace rows too."""

import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import ColumnElement, and_, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    CalendarEventModel,
    DocumentModel,
    FitnessActivityModel,
    FitnessExerciseModel,
    FitnessFoodEntryModel,
    FitnessFoodModel,
    FitnessGoalModel,
    FitnessGoalProgressModel,
    FitnessHabitLinkModel,
    FitnessLinkModel,
    FitnessMealItemModel,
    FitnessMealModel,
    FitnessMeasurementModel,
    FitnessPhotoModel,
    FitnessProfileModel,
    FitnessSessionExerciseModel,
    FitnessSessionModel,
    FitnessSetModel,
    FitnessTemplateExerciseModel,
    FitnessTemplateModel,
    FitnessWaterEntryModel,
    FitnessWorkoutEventModel,
    HabitModel,
    NoteModel,
)
from orbit_api.repositories.calendar import build_calendar_service
from orbit_api.repositories.habits import build_habit_service
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.fitness.body import BodyService, PhotoFiles
from orbit_api.services.fitness.integrations import (
    Contributions,
    HabitHealth,
    IntegrationService,
)
from orbit_api.services.fitness.models import (
    Activity,
    ActivityDraft,
    ActivityKind,
    DashboardSection,
    Exercise,
    ExerciseDraft,
    ExerciseSnapshot,
    Food,
    FoodDraft,
    FoodEntry,
    Goal,
    GoalCheckIn,
    GoalDraft,
    GoalStatus,
    HabitLink,
    HabitLinkDraft,
    HabitSource,
    LinkedRecord,
    LinkOwnerKind,
    LinkTargetKind,
    Measurement,
    MeasurementValues,
    Muscle,
    Nutrients,
    Owner,
    Photo,
    Portion,
    Profile,
    ProfileDraft,
    SavedMeal,
    Session,
    SessionExercise,
    SessionStatus,
    SetValues,
    Targets,
    Template,
    TemplateExercise,
    TemplateExerciseDraft,
    WaterEntry,
    WorkoutSet,
)
from orbit_api.services.fitness.nutrition import NutritionService
from orbit_api.services.fitness.overview import Fitness
from orbit_api.services.fitness.service import FitnessService, normalize_name
from orbit_api.services.fitness.tracking import TrackingService
from orbit_api.services.fitness.workouts import WorkoutService
from orbit_api.services.habits.service import HabitService

E = FitnessExerciseModel
S = FitnessSessionModel
SE = FitnessSessionExerciseModel


def _owned(model: Any, owner: Owner) -> ColumnElement[bool]:
    return and_(model.workspace_id == owner.workspace_id, model.user_id == owner.user_id)


def _owner(model: Any) -> Owner:
    return Owner(workspace_id=model.workspace_id, user_id=model.user_id)


def _muscles(value: list[str]) -> tuple[Muscle, ...]:
    # Stored values were validated on the way in.
    return tuple(cast(Muscle, m) for m in value)


def _to_profile(model: FitnessProfileModel) -> Profile:
    return Profile(
        id=model.id,
        owner=_owner(model),
        settings=ProfileDraft(
            unit_system=cast(Any, model.unit_system),
            weight_unit=cast(Any, model.weight_unit),
            length_unit=cast(Any, model.length_unit),
            distance_unit=cast(Any, model.distance_unit),
            energy_unit=cast(Any, model.energy_unit),
            water_unit=cast(Any, model.water_unit),
            height_mm=model.height_mm,
            date_of_birth=model.date_of_birth,
            targets=Targets(
                energy_cal=model.energy_target_cal,
                protein_mg=model.protein_target_mg,
                carbs_mg=model.carbs_target_mg,
                fat_mg=model.fat_target_mg,
                fiber_mg=model.fiber_target_mg,
                water_ml=model.water_target_ml,
                steps=model.steps_target,
                active_s=model.active_target_s,
                sleep_s=model.sleep_target_s,
            ),
            water_quick_amounts_ml=tuple(model.water_quick_amounts_ml),
            hidden_sections=tuple(cast(DashboardSection, s) for s in model.hidden_sections),
        ),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_exercise(model: FitnessExerciseModel) -> Exercise:
    return Exercise(
        id=model.id,
        owner=_owner(model),
        builtin_key=model.builtin_key,
        details=ExerciseDraft(
            name=model.name,
            category=cast(Any, model.category),
            exercise_type=cast(Any, model.exercise_type),
            equipment=cast(Any, model.equipment),
            description=model.description,
            instructions=model.instructions,
            primary_muscles=_muscles(model.primary_muscles),
            secondary_muscles=_muscles(model.secondary_muscles),
        ),
        archived_at=model.archived_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _exercise_fields(exercise: Exercise) -> dict[str, object]:
    details = exercise.details
    return {
        "builtin_key": exercise.builtin_key,
        "name": details.name,
        "normalized_name": normalize_name(details.name),
        "description": details.description,
        "instructions": details.instructions,
        "category": details.category,
        "exercise_type": details.exercise_type,
        "equipment": details.equipment,
        "primary_muscles": list(details.primary_muscles),
        "secondary_muscles": list(details.secondary_muscles),
        "is_custom": exercise.is_custom,
        "archived_at": exercise.archived_at,
        "updated_at": exercise.updated_at,
    }


def _to_session(model: FitnessSessionModel) -> Session:
    return Session(
        id=model.id,
        owner=_owner(model),
        template_id=model.template_id,
        calendar_event_id=model.calendar_event_id,
        name=model.name,
        day=model.day,
        timezone=model.timezone,
        status=cast(SessionStatus, model.status),
        started_at=model.started_at,
        ended_at=model.ended_at,
        paused_at=model.paused_at,
        paused_seconds=model.paused_seconds,
        duration_s=model.duration_s,
        notes=model.notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _session_fields(session: Session) -> dict[str, object]:
    return {
        "template_id": session.template_id,
        "calendar_event_id": session.calendar_event_id,
        "name": session.name,
        "day": session.day,
        "timezone": session.timezone,
        "status": session.status,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "paused_at": session.paused_at,
        "paused_seconds": session.paused_seconds,
        "duration_s": session.duration_s,
        "notes": session.notes,
        "updated_at": session.updated_at,
    }


def _to_set(model: FitnessSetModel) -> WorkoutSet:
    return WorkoutSet(
        id=model.id,
        position=model.position,
        values=SetValues(
            set_type=cast(Any, model.set_type),
            reps=model.reps,
            weight_g=model.weight_g,
            duration_s=model.duration_s,
            distance_m=model.distance_m,
            rpe=model.rpe,
            completed=model.completed,
        ),
        completed_at=model.completed_at,
    )


def _set_fields(item: WorkoutSet) -> dict[str, object]:
    values = item.values
    return {
        "position": item.position,
        "set_type": values.set_type,
        "reps": values.reps,
        "weight_g": values.weight_g,
        "duration_s": values.duration_s,
        "distance_m": values.distance_m,
        "rpe": values.rpe,
        "completed": values.completed,
        "completed_at": item.completed_at,
    }


def _to_session_exercise(
    model: FitnessSessionExerciseModel, sets: Sequence[WorkoutSet]
) -> SessionExercise:
    return SessionExercise(
        id=model.id,
        session_id=model.session_id,
        exercise_id=model.exercise_id,
        position=model.position,
        snapshot=ExerciseSnapshot(
            name=model.exercise_name,
            exercise_type=cast(Any, model.exercise_type),
            category=cast(Any, model.exercise_category),
            primary_muscles=_muscles(model.primary_muscles),
        ),
        rest_seconds=model.rest_seconds,
        notes=model.notes,
        sets=tuple(sets),
    )


def _to_measurement(model: FitnessMeasurementModel) -> Measurement:
    return Measurement(
        id=model.id,
        owner=_owner(model),
        day=model.day,
        values=MeasurementValues(
            weight_g=model.weight_g,
            body_fat_pct=model.body_fat_pct,
            height_mm=model.height_mm,
            waist_mm=model.waist_mm,
            chest_mm=model.chest_mm,
            hips_mm=model.hips_mm,
            arm_mm=model.arm_mm,
            thigh_mm=model.thigh_mm,
            neck_mm=model.neck_mm,
        ),
        note=model.note,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_photo(model: FitnessPhotoModel) -> Photo:
    return Photo(
        id=model.id,
        owner=_owner(model),
        day=model.day,
        note=model.note,
        blob_id=model.blob_id,
        content_type=model.content_type,
        size_bytes=model.size_bytes,
        created_at=model.created_at,
    )


def _nutrients(model: Any) -> Nutrients:
    return Nutrients(
        energy_cal=model.energy_cal,
        protein_mg=model.protein_mg,
        carbs_mg=model.carbs_mg,
        fat_mg=model.fat_mg,
        fiber_mg=model.fiber_mg,
    )


def _nutrient_fields(nutrients: Nutrients) -> dict[str, object]:
    return {
        "energy_cal": nutrients.energy_cal,
        "protein_mg": nutrients.protein_mg,
        "carbs_mg": nutrients.carbs_mg,
        "fat_mg": nutrients.fat_mg,
        "fiber_mg": nutrients.fiber_mg,
    }


def _to_food(model: FitnessFoodModel) -> Food:
    return Food(
        id=model.id,
        owner=_owner(model),
        details=FoodDraft(
            name=model.name,
            serving_quantity_milli=model.serving_quantity_milli,
            serving_unit=model.serving_unit,
            nutrients=_nutrients(model),
        ),
        use_count=model.use_count,
        last_used_at=model.last_used_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_portion(model: FitnessMealItemModel | FitnessFoodEntryModel) -> Portion:
    return Portion(
        food_id=model.food_id,
        name=model.name,
        quantity_milli=model.quantity_milli,
        serving_unit=model.serving_unit,
        nutrients=_nutrients(model),
    )


def _portion_fields(portion: Portion) -> dict[str, object]:
    return {
        "food_id": portion.food_id,
        "name": portion.name,
        "quantity_milli": portion.quantity_milli,
        "serving_unit": portion.serving_unit,
        **_nutrient_fields(portion.nutrients),
    }


def _to_food_entry(model: FitnessFoodEntryModel) -> FoodEntry:
    return FoodEntry(
        id=model.id,
        owner=_owner(model),
        day=model.day,
        meal=cast(Any, model.meal),
        portion=_to_portion(model),
        note=model.note,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_activity(model: FitnessActivityModel) -> Activity:
    return Activity(
        id=model.id,
        owner=_owner(model),
        details=ActivityDraft(
            day=model.day,
            kind=cast(ActivityKind, model.kind),
            steps=model.steps,
            distance_m=model.distance_m,
            duration_s=model.duration_s,
            note=model.note,
        ),
        source="manual",
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_goal(model: FitnessGoalModel) -> Goal:
    return Goal(
        id=model.id,
        owner=_owner(model),
        details=GoalDraft(
            name=model.name,
            category=cast(Any, model.category),
            start_value=model.start_value,
            target_value=model.target_value,
            start_date=model.start_date,
            unit=model.unit,
            description=model.description,
            target_date=model.target_date,
            auto_track=model.auto_track,
            exercise_id=model.exercise_id,
            habit_id=model.habit_id,
        ),
        status=cast(GoalStatus, model.status),
        completed_at=model.completed_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


_LINK_OWNERS = {"session": FitnessLinkModel.session_id, "goal": FitnessLinkModel.goal_id}
_LINK_TARGETS = {"note": FitnessLinkModel.note_id, "document": FitnessLinkModel.document_id}


class SqlFitnessStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _put(self, model_type: Any, row_id: uuid.UUID, fields: dict[str, object]) -> None:
        """Insert or update one row by primary key."""
        model = await self._session.get(model_type, row_id)
        if model is None:
            self._session.add(model_type(id=row_id, **fields))
        else:
            for name, value in fields.items():
                setattr(model, name, value)
        await flush(self._session)

    async def _delete(self, model_type: Any, *conditions: ColumnElement[bool]) -> bool:
        deleted = await self._session.execute(
            delete(model_type).where(*conditions).returning(model_type.id)
        )
        return deleted.first() is not None

    # Profile

    async def get_profile(self, owner: Owner) -> Profile | None:
        model = await self._session.scalar(
            select(FitnessProfileModel).where(_owned(FitnessProfileModel, owner))
        )
        return _to_profile(model) if model else None

    async def put_profile(self, profile: Profile) -> None:
        settings = profile.settings
        targets = settings.targets
        await self._put(
            FitnessProfileModel,
            profile.id,
            {
                "workspace_id": profile.owner.workspace_id,
                "user_id": profile.owner.user_id,
                "unit_system": settings.unit_system,
                "weight_unit": settings.weight_unit,
                "length_unit": settings.length_unit,
                "distance_unit": settings.distance_unit,
                "energy_unit": settings.energy_unit,
                "water_unit": settings.water_unit,
                "height_mm": settings.height_mm,
                "date_of_birth": settings.date_of_birth,
                "energy_target_cal": targets.energy_cal,
                "protein_target_mg": targets.protein_mg,
                "carbs_target_mg": targets.carbs_mg,
                "fat_target_mg": targets.fat_mg,
                "fiber_target_mg": targets.fiber_mg,
                "water_target_ml": targets.water_ml,
                "steps_target": targets.steps,
                "active_target_s": targets.active_s,
                "sleep_target_s": targets.sleep_s,
                "water_quick_amounts_ml": list(settings.water_quick_amounts_ml),
                "hidden_sections": list(settings.hidden_sections),
                "created_at": profile.created_at,
                "updated_at": profile.updated_at,
            },
        )

    # Exercises

    async def exercises(self, owner: Owner) -> list[Exercise]:
        rows = await self._session.scalars(
            select(E).where(_owned(E, owner)).order_by(E.normalized_name, E.id)
        )
        return [_to_exercise(m) for m in rows]

    async def get_exercise(self, owner: Owner, exercise_id: uuid.UUID) -> Exercise | None:
        model = await self._session.scalar(select(E).where(_owned(E, owner), E.id == exercise_id))
        return _to_exercise(model) if model else None

    async def add_exercises(self, exercises: Sequence[Exercise]) -> None:
        self._session.add_all(
            E(
                id=e.id,
                workspace_id=e.owner.workspace_id,
                user_id=e.owner.user_id,
                created_at=e.created_at,
                **_exercise_fields(e),
            )
            for e in exercises
        )

    async def save_exercise(self, exercise: Exercise) -> None:
        await self._session.execute(
            update(E)
            .where(_owned(E, exercise.owner), E.id == exercise.id)
            .values(**_exercise_fields(exercise))
        )

    async def delete_exercise(self, owner: Owner, exercise_id: uuid.UUID) -> bool:
        return await self._delete(E, _owned(E, owner), E.id == exercise_id)

    async def exercise_in_use(self, owner: Owner, exercise_id: uuid.UUID) -> bool:
        in_template = await self._session.scalar(
            select(FitnessTemplateExerciseModel.id)
            .where(
                FitnessTemplateExerciseModel.workspace_id == owner.workspace_id,
                FitnessTemplateExerciseModel.exercise_id == exercise_id,
            )
            .limit(1)
        )
        in_session = await self._session.scalar(
            select(SE.id)
            .where(SE.workspace_id == owner.workspace_id, SE.exercise_id == exercise_id)
            .limit(1)
        )
        return in_template is not None or in_session is not None

    # Templates

    async def _load_templates(self, models: Sequence[FitnessTemplateModel]) -> list[Template]:
        if not models:
            return []
        rows = (
            await self._session.execute(
                select(FitnessTemplateExerciseModel, E)
                .join(
                    E,
                    and_(
                        E.id == FitnessTemplateExerciseModel.exercise_id,
                        E.workspace_id == FitnessTemplateExerciseModel.workspace_id,
                    ),
                )
                .where(FitnessTemplateExerciseModel.template_id.in_([m.id for m in models]))
                .order_by(FitnessTemplateExerciseModel.position)
            )
        ).all()
        items: dict[uuid.UUID, list[TemplateExercise]] = defaultdict(list)
        for item, exercise in rows:
            items[item.template_id].append(
                TemplateExercise(
                    id=item.id,
                    position=item.position,
                    exercise=_to_exercise(exercise),
                    plan=TemplateExerciseDraft(
                        exercise_id=item.exercise_id,
                        sets=item.sets,
                        target_reps_min=item.target_reps_min,
                        target_reps_max=item.target_reps_max,
                        target_weight_g=item.target_weight_g,
                        target_duration_s=item.target_duration_s,
                        target_distance_m=item.target_distance_m,
                        rest_seconds=item.rest_seconds,
                        notes=item.notes,
                    ),
                )
            )
        return [
            Template(
                id=m.id,
                owner=_owner(m),
                name=m.name,
                category=cast(Any, m.category),
                description=m.description,
                notes=m.notes,
                archived_at=m.archived_at,
                created_at=m.created_at,
                updated_at=m.updated_at,
                exercises=tuple(items[m.id]),
            )
            for m in models
        ]

    async def templates(self, owner: Owner) -> list[Template]:
        rows = await self._session.scalars(
            select(FitnessTemplateModel)
            .where(_owned(FitnessTemplateModel, owner))
            .order_by(func.lower(FitnessTemplateModel.name), FitnessTemplateModel.id)
        )
        return await self._load_templates(list(rows))

    async def get_template(self, owner: Owner, template_id: uuid.UUID) -> Template | None:
        model = await self._session.scalar(
            select(FitnessTemplateModel).where(
                _owned(FitnessTemplateModel, owner), FitnessTemplateModel.id == template_id
            )
        )
        return (await self._load_templates([model]))[0] if model else None

    async def put_template(self, template: Template) -> None:
        await self._put(
            FitnessTemplateModel,
            template.id,
            {
                "workspace_id": template.owner.workspace_id,
                "user_id": template.owner.user_id,
                "name": template.name,
                "category": template.category,
                "description": template.description,
                "notes": template.notes,
                "archived_at": template.archived_at,
                "created_at": template.created_at,
                "updated_at": template.updated_at,
            },
        )
        await self._session.execute(
            delete(FitnessTemplateExerciseModel).where(
                FitnessTemplateExerciseModel.workspace_id == template.owner.workspace_id,
                FitnessTemplateExerciseModel.template_id == template.id,
            )
        )
        self._session.add_all(
            FitnessTemplateExerciseModel(
                id=item.id,
                workspace_id=template.owner.workspace_id,
                template_id=template.id,
                exercise_id=item.exercise.id,
                position=item.position,
                sets=item.plan.sets,
                target_reps_min=item.plan.target_reps_min,
                target_reps_max=item.plan.target_reps_max,
                target_weight_g=item.plan.target_weight_g,
                target_duration_s=item.plan.target_duration_s,
                target_distance_m=item.plan.target_distance_m,
                rest_seconds=item.plan.rest_seconds,
                notes=item.plan.notes,
            )
            for item in template.exercises
        )
        await flush(self._session)

    async def delete_template(self, owner: Owner, template_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessTemplateModel,
            _owned(FitnessTemplateModel, owner),
            FitnessTemplateModel.id == template_id,
        )

    # Sessions

    async def unfinished_session(self, owner: Owner) -> Session | None:
        model = await self._session.scalar(
            select(S).where(_owned(S, owner), S.status.in_(("active", "paused")))
        )
        return _to_session(model) if model else None

    async def get_session(self, owner: Owner, session_id: uuid.UUID) -> Session | None:
        model = await self._session.scalar(select(S).where(_owned(S, owner), S.id == session_id))
        return _to_session(model) if model else None

    def _session_filter(
        self,
        owner: Owner,
        start: date | None,
        end: date | None,
        statuses: Sequence[str],
        calendar_event_id: uuid.UUID | None = None,
    ) -> list[ColumnElement[bool]]:
        conditions = [_owned(S, owner)]
        if start is not None:
            conditions.append(S.day >= start)
        if end is not None:
            conditions.append(S.day <= end)
        if statuses:
            conditions.append(S.status.in_(list(statuses)))
        if calendar_event_id is not None:
            conditions.append(S.calendar_event_id == calendar_event_id)
        return conditions

    async def sessions(
        self,
        owner: Owner,
        *,
        start: date | None = None,
        end: date | None = None,
        statuses: Sequence[SessionStatus] = (),
        calendar_event_id: uuid.UUID | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Session]:
        query = (
            select(S)
            .where(*self._session_filter(owner, start, end, statuses, calendar_event_id))
            .order_by(S.day.desc(), S.started_at.desc(), S.id)
            .offset(offset)
        )
        if limit is not None:
            query = query.limit(limit)
        return [_to_session(m) for m in await self._session.scalars(query)]

    async def count_sessions(
        self, owner: Owner, *, start: date | None, end: date | None, statuses: Sequence[str]
    ) -> int:
        count = await self._session.scalar(
            select(func.count())
            .select_from(S)
            .where(*self._session_filter(owner, start, end, statuses))
        )
        return count or 0

    async def add_session(self, session: Session) -> None:
        self._session.add(
            S(
                id=session.id,
                workspace_id=session.owner.workspace_id,
                user_id=session.owner.user_id,
                created_at=session.created_at,
                **_session_fields(session),
            )
        )
        await flush(self._session)

    async def save_session(self, session: Session) -> None:
        await self._session.execute(
            update(S)
            .where(_owned(S, session.owner), S.id == session.id)
            .values(**_session_fields(session))
        )

    async def delete_session(self, owner: Owner, session_id: uuid.UUID) -> bool:
        return await self._delete(S, _owned(S, owner), S.id == session_id)

    async def session_exercises(
        self, workspace_id: uuid.UUID, session_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[SessionExercise]]:
        if not session_ids:
            return {}
        models = list(
            await self._session.scalars(
                select(SE)
                .where(SE.workspace_id == workspace_id, SE.session_id.in_(list(session_ids)))
                .order_by(SE.position, SE.id)
            )
        )
        return await self._with_sets(workspace_id, models)

    async def _with_sets(
        self, workspace_id: uuid.UUID, models: Sequence[FitnessSessionExerciseModel]
    ) -> dict[uuid.UUID, list[SessionExercise]]:
        sets: dict[uuid.UUID, list[WorkoutSet]] = defaultdict(list)
        ids = [m.id for m in models]
        for start in range(0, len(ids), 500):
            rows = await self._session.scalars(
                select(FitnessSetModel)
                .where(
                    FitnessSetModel.workspace_id == workspace_id,
                    FitnessSetModel.session_exercise_id.in_(ids[start : start + 500]),
                )
                .order_by(FitnessSetModel.position, FitnessSetModel.id)
            )
            for row in rows:
                sets[row.session_exercise_id].append(_to_set(row))
        result: dict[uuid.UUID, list[SessionExercise]] = defaultdict(list)
        for model in models:
            result[model.session_id].append(_to_session_exercise(model, sets[model.id]))
        return dict(result)

    async def performed(
        self, owner: Owner, exercise_ids: Sequence[uuid.UUID] | None = None
    ) -> list[tuple[Session, SessionExercise]]:
        query = (
            select(SE, S)
            .join(S, and_(S.id == SE.session_id, S.workspace_id == SE.workspace_id))
            .where(_owned(S, owner), S.status == "completed")
            .order_by(S.day, S.started_at, SE.position)
        )
        if exercise_ids is not None:
            query = query.where(SE.exercise_id.in_(list(exercise_ids)))
        rows = (await self._session.execute(query)).all()
        items = await self._with_sets(owner.workspace_id, [item for item, _ in rows])
        by_id = {e.id: e for group in items.values() for e in group}
        return [(_to_session(session), by_id[item.id]) for item, session in rows]

    async def add_session_exercise(self, workspace_id: uuid.UUID, item: SessionExercise) -> None:
        self._session.add(
            SE(
                id=item.id,
                workspace_id=workspace_id,
                session_id=item.session_id,
                exercise_id=item.exercise_id,
                position=item.position,
                exercise_name=item.snapshot.name,
                exercise_type=item.snapshot.exercise_type,
                exercise_category=item.snapshot.category,
                primary_muscles=list(item.snapshot.primary_muscles),
                rest_seconds=item.rest_seconds,
                notes=item.notes,
            )
        )
        await flush(self._session)
        self._session.add_all(
            FitnessSetModel(
                id=s.id, workspace_id=workspace_id, session_exercise_id=item.id, **_set_fields(s)
            )
            for s in item.sets
        )
        await flush(self._session)

    async def save_session_exercise(self, workspace_id: uuid.UUID, item: SessionExercise) -> None:
        await self._session.execute(
            update(SE)
            .where(SE.workspace_id == workspace_id, SE.id == item.id)
            .values(position=item.position, rest_seconds=item.rest_seconds, notes=item.notes)
        )

    async def delete_session_exercise(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(SE).where(SE.workspace_id == workspace_id, SE.id == item_id)
        )

    async def add_set(
        self, workspace_id: uuid.UUID, session_exercise_id: uuid.UUID, item: WorkoutSet
    ) -> None:
        self._session.add(
            FitnessSetModel(
                id=item.id,
                workspace_id=workspace_id,
                session_exercise_id=session_exercise_id,
                **_set_fields(item),
            )
        )
        await flush(self._session)

    async def save_set(self, workspace_id: uuid.UUID, item: WorkoutSet) -> None:
        await self._session.execute(
            update(FitnessSetModel)
            .where(FitnessSetModel.workspace_id == workspace_id, FitnessSetModel.id == item.id)
            .values(**_set_fields(item))
        )

    async def delete_set(self, workspace_id: uuid.UUID, set_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(FitnessSetModel).where(
                FitnessSetModel.workspace_id == workspace_id, FitnessSetModel.id == set_id
            )
        )

    # Body

    async def measurements(
        self, owner: Owner, start: date | None = None, end: date | None = None
    ) -> list[Measurement]:
        query = select(FitnessMeasurementModel).where(_owned(FitnessMeasurementModel, owner))
        if start is not None:
            query = query.where(FitnessMeasurementModel.day >= start)
        if end is not None:
            query = query.where(FitnessMeasurementModel.day <= end)
        rows = await self._session.scalars(
            query.order_by(
                FitnessMeasurementModel.day,
                FitnessMeasurementModel.created_at,
                FitnessMeasurementModel.id,
            )
        )
        return [_to_measurement(m) for m in rows]

    async def get_measurement(self, owner: Owner, measurement_id: uuid.UUID) -> Measurement | None:
        model = await self._session.scalar(
            select(FitnessMeasurementModel).where(
                _owned(FitnessMeasurementModel, owner), FitnessMeasurementModel.id == measurement_id
            )
        )
        return _to_measurement(model) if model else None

    async def put_measurement(self, measurement: Measurement) -> None:
        values = measurement.values
        await self._put(
            FitnessMeasurementModel,
            measurement.id,
            {
                "workspace_id": measurement.owner.workspace_id,
                "user_id": measurement.owner.user_id,
                "day": measurement.day,
                "weight_g": values.weight_g,
                "body_fat_pct": values.body_fat_pct,
                "height_mm": values.height_mm,
                "waist_mm": values.waist_mm,
                "chest_mm": values.chest_mm,
                "hips_mm": values.hips_mm,
                "arm_mm": values.arm_mm,
                "thigh_mm": values.thigh_mm,
                "neck_mm": values.neck_mm,
                "note": measurement.note,
                "created_at": measurement.created_at,
                "updated_at": measurement.updated_at,
            },
        )

    async def delete_measurement(self, owner: Owner, measurement_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessMeasurementModel,
            _owned(FitnessMeasurementModel, owner),
            FitnessMeasurementModel.id == measurement_id,
        )

    async def photos(self, owner: Owner) -> list[Photo]:
        rows = await self._session.scalars(
            select(FitnessPhotoModel)
            .where(_owned(FitnessPhotoModel, owner))
            .order_by(FitnessPhotoModel.day.desc(), FitnessPhotoModel.created_at.desc())
        )
        return [_to_photo(m) for m in rows]

    async def get_photo(self, owner: Owner, photo_id: uuid.UUID) -> Photo | None:
        model = await self._session.scalar(
            select(FitnessPhotoModel).where(
                _owned(FitnessPhotoModel, owner), FitnessPhotoModel.id == photo_id
            )
        )
        return _to_photo(model) if model else None

    async def add_photo(self, photo: Photo) -> None:
        self._session.add(
            FitnessPhotoModel(
                id=photo.id,
                workspace_id=photo.owner.workspace_id,
                user_id=photo.owner.user_id,
                day=photo.day,
                note=photo.note,
                blob_id=photo.blob_id,
                content_type=photo.content_type,
                size_bytes=photo.size_bytes,
                created_at=photo.created_at,
            )
        )
        await flush(self._session)

    async def delete_photo(self, owner: Owner, photo_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessPhotoModel, _owned(FitnessPhotoModel, owner), FitnessPhotoModel.id == photo_id
        )

    # Nutrition

    async def foods(self, owner: Owner) -> list[Food]:
        rows = await self._session.scalars(
            select(FitnessFoodModel)
            .where(_owned(FitnessFoodModel, owner))
            .order_by(FitnessFoodModel.normalized_name)
        )
        return [_to_food(m) for m in rows]

    async def get_food(self, owner: Owner, food_id: uuid.UUID) -> Food | None:
        model = await self._session.scalar(
            select(FitnessFoodModel).where(
                _owned(FitnessFoodModel, owner), FitnessFoodModel.id == food_id
            )
        )
        return _to_food(model) if model else None

    async def put_food(self, food: Food) -> None:
        await self._put(
            FitnessFoodModel,
            food.id,
            {
                "workspace_id": food.owner.workspace_id,
                "user_id": food.owner.user_id,
                "name": food.details.name,
                "normalized_name": normalize_name(food.details.name),
                "serving_quantity_milli": food.details.serving_quantity_milli,
                "serving_unit": food.details.serving_unit,
                **_nutrient_fields(food.details.nutrients),
                "use_count": food.use_count,
                "last_used_at": food.last_used_at,
                "created_at": food.created_at,
                "updated_at": food.updated_at,
            },
        )

    async def delete_food(self, owner: Owner, food_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessFoodModel, _owned(FitnessFoodModel, owner), FitnessFoodModel.id == food_id
        )

    async def _load_meals(self, models: Sequence[FitnessMealModel]) -> list[SavedMeal]:
        if not models:
            return []
        items: dict[uuid.UUID, list[Portion]] = defaultdict(list)
        rows = await self._session.scalars(
            select(FitnessMealItemModel)
            .where(FitnessMealItemModel.meal_id.in_([m.id for m in models]))
            .order_by(FitnessMealItemModel.position)
        )
        for row in rows:
            items[row.meal_id].append(_to_portion(row))
        return [
            SavedMeal(
                id=m.id,
                owner=_owner(m),
                name=m.name,
                items=tuple(items[m.id]),
                created_at=m.created_at,
                updated_at=m.updated_at,
            )
            for m in models
        ]

    async def meals(self, owner: Owner) -> list[SavedMeal]:
        rows = await self._session.scalars(
            select(FitnessMealModel)
            .where(_owned(FitnessMealModel, owner))
            .order_by(func.lower(FitnessMealModel.name), FitnessMealModel.id)
        )
        return await self._load_meals(list(rows))

    async def get_meal(self, owner: Owner, meal_id: uuid.UUID) -> SavedMeal | None:
        model = await self._session.scalar(
            select(FitnessMealModel).where(
                _owned(FitnessMealModel, owner), FitnessMealModel.id == meal_id
            )
        )
        return (await self._load_meals([model]))[0] if model else None

    async def put_meal(self, meal: SavedMeal) -> None:
        await self._put(
            FitnessMealModel,
            meal.id,
            {
                "workspace_id": meal.owner.workspace_id,
                "user_id": meal.owner.user_id,
                "name": meal.name,
                "created_at": meal.created_at,
                "updated_at": meal.updated_at,
            },
        )
        await self._session.execute(
            delete(FitnessMealItemModel).where(
                FitnessMealItemModel.workspace_id == meal.owner.workspace_id,
                FitnessMealItemModel.meal_id == meal.id,
            )
        )
        self._session.add_all(
            FitnessMealItemModel(
                id=uuid.uuid4(),
                workspace_id=meal.owner.workspace_id,
                meal_id=meal.id,
                position=position,
                **_portion_fields(item),
            )
            for position, item in enumerate(meal.items)
        )
        await flush(self._session)

    async def delete_meal(self, owner: Owner, meal_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessMealModel, _owned(FitnessMealModel, owner), FitnessMealModel.id == meal_id
        )

    async def food_entries(self, owner: Owner, start: date, end: date) -> list[FoodEntry]:
        rows = await self._session.scalars(
            select(FitnessFoodEntryModel)
            .where(
                _owned(FitnessFoodEntryModel, owner),
                FitnessFoodEntryModel.day >= start,
                FitnessFoodEntryModel.day <= end,
            )
            .order_by(
                FitnessFoodEntryModel.day,
                FitnessFoodEntryModel.created_at,
                FitnessFoodEntryModel.id,
            )
        )
        return [_to_food_entry(m) for m in rows]

    async def get_food_entry(self, owner: Owner, entry_id: uuid.UUID) -> FoodEntry | None:
        model = await self._session.scalar(
            select(FitnessFoodEntryModel).where(
                _owned(FitnessFoodEntryModel, owner), FitnessFoodEntryModel.id == entry_id
            )
        )
        return _to_food_entry(model) if model else None

    async def put_food_entry(self, entry: FoodEntry) -> None:
        await self._put(
            FitnessFoodEntryModel,
            entry.id,
            {
                "workspace_id": entry.owner.workspace_id,
                "user_id": entry.owner.user_id,
                "day": entry.day,
                "meal": entry.meal,
                **_portion_fields(entry.portion),
                "note": entry.note,
                "created_at": entry.created_at,
                "updated_at": entry.updated_at,
            },
        )

    async def delete_food_entry(self, owner: Owner, entry_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessFoodEntryModel,
            _owned(FitnessFoodEntryModel, owner),
            FitnessFoodEntryModel.id == entry_id,
        )

    async def water_entries(self, owner: Owner, start: date, end: date) -> list[WaterEntry]:
        rows = await self._session.scalars(
            select(FitnessWaterEntryModel)
            .where(
                _owned(FitnessWaterEntryModel, owner),
                FitnessWaterEntryModel.day >= start,
                FitnessWaterEntryModel.day <= end,
            )
            .order_by(
                FitnessWaterEntryModel.day,
                FitnessWaterEntryModel.created_at,
                FitnessWaterEntryModel.id,
            )
        )
        return [
            WaterEntry(
                id=m.id, owner=_owner(m), day=m.day, amount_ml=m.amount_ml, created_at=m.created_at
            )
            for m in rows
        ]

    async def get_water_entry(self, owner: Owner, entry_id: uuid.UUID) -> WaterEntry | None:
        m = await self._session.scalar(
            select(FitnessWaterEntryModel).where(
                _owned(FitnessWaterEntryModel, owner), FitnessWaterEntryModel.id == entry_id
            )
        )
        if m is None:
            return None
        return WaterEntry(
            id=m.id, owner=_owner(m), day=m.day, amount_ml=m.amount_ml, created_at=m.created_at
        )

    async def add_water_entry(self, entry: WaterEntry) -> None:
        self._session.add(
            FitnessWaterEntryModel(
                id=entry.id,
                workspace_id=entry.owner.workspace_id,
                user_id=entry.owner.user_id,
                day=entry.day,
                amount_ml=entry.amount_ml,
                created_at=entry.created_at,
            )
        )
        await flush(self._session)

    async def delete_water_entry(self, owner: Owner, entry_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessWaterEntryModel,
            _owned(FitnessWaterEntryModel, owner),
            FitnessWaterEntryModel.id == entry_id,
        )

    # Activity

    async def activities(
        self,
        owner: Owner,
        start: date | None = None,
        end: date | None = None,
        kind: ActivityKind | None = None,
        limit: int | None = None,
    ) -> list[Activity]:
        query = select(FitnessActivityModel).where(_owned(FitnessActivityModel, owner))
        if start is not None:
            query = query.where(FitnessActivityModel.day >= start)
        if end is not None:
            query = query.where(FitnessActivityModel.day <= end)
        if kind is not None:
            query = query.where(FitnessActivityModel.kind == kind)
        query = query.order_by(
            FitnessActivityModel.day.desc(),
            FitnessActivityModel.created_at.desc(),
            FitnessActivityModel.id,
        )
        if limit is not None:
            query = query.limit(limit)
        return [_to_activity(m) for m in await self._session.scalars(query)]

    async def get_activity(self, owner: Owner, activity_id: uuid.UUID) -> Activity | None:
        model = await self._session.scalar(
            select(FitnessActivityModel).where(
                _owned(FitnessActivityModel, owner), FitnessActivityModel.id == activity_id
            )
        )
        return _to_activity(model) if model else None

    async def put_activity(self, activity: Activity) -> None:
        details = activity.details
        await self._put(
            FitnessActivityModel,
            activity.id,
            {
                "workspace_id": activity.owner.workspace_id,
                "user_id": activity.owner.user_id,
                "day": details.day,
                "kind": details.kind,
                "steps": details.steps,
                "distance_m": details.distance_m,
                "duration_s": details.duration_s,
                "note": details.note,
                "source": activity.source,
                "created_at": activity.created_at,
                "updated_at": activity.updated_at,
            },
        )

    async def delete_activity(self, owner: Owner, activity_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessActivityModel,
            _owned(FitnessActivityModel, owner),
            FitnessActivityModel.id == activity_id,
        )

    # Goals

    async def goals(self, owner: Owner, statuses: Sequence[GoalStatus] = ()) -> list[Goal]:
        query = select(FitnessGoalModel).where(_owned(FitnessGoalModel, owner))
        if statuses:
            query = query.where(FitnessGoalModel.status.in_(list(statuses)))
        rows = await self._session.scalars(
            query.order_by(FitnessGoalModel.created_at, FitnessGoalModel.id)
        )
        return [_to_goal(m) for m in rows]

    async def get_goal(self, owner: Owner, goal_id: uuid.UUID) -> Goal | None:
        model = await self._session.scalar(
            select(FitnessGoalModel).where(
                _owned(FitnessGoalModel, owner), FitnessGoalModel.id == goal_id
            )
        )
        return _to_goal(model) if model else None

    async def put_goal(self, goal: Goal) -> None:
        details = goal.details
        await self._put(
            FitnessGoalModel,
            goal.id,
            {
                "workspace_id": goal.owner.workspace_id,
                "user_id": goal.owner.user_id,
                "name": details.name,
                "description": details.description,
                "category": details.category,
                "unit": details.unit,
                "start_value": details.start_value,
                "target_value": details.target_value,
                "start_date": details.start_date,
                "target_date": details.target_date,
                "status": goal.status,
                "completed_at": goal.completed_at,
                "auto_track": details.auto_track,
                "exercise_id": details.exercise_id,
                "habit_id": details.habit_id,
                "created_at": goal.created_at,
                "updated_at": goal.updated_at,
            },
        )

    async def delete_goal(self, owner: Owner, goal_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessGoalModel, _owned(FitnessGoalModel, owner), FitnessGoalModel.id == goal_id
        )

    async def check_ins(
        self, workspace_id: uuid.UUID, goal_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[GoalCheckIn]]:
        if not goal_ids:
            return {}
        rows = await self._session.scalars(
            select(FitnessGoalProgressModel)
            .where(
                FitnessGoalProgressModel.workspace_id == workspace_id,
                FitnessGoalProgressModel.goal_id.in_(list(goal_ids)),
            )
            .order_by(FitnessGoalProgressModel.day, FitnessGoalProgressModel.created_at)
        )
        result: dict[uuid.UUID, list[GoalCheckIn]] = defaultdict(list)
        for row in rows:
            result[row.goal_id].append(
                GoalCheckIn(id=row.id, day=row.day, value=row.value, note=row.note, source="manual")
            )
        return dict(result)

    async def add_check_in(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, check_in: GoalCheckIn
    ) -> None:
        self._session.add(
            FitnessGoalProgressModel(
                id=check_in.id,
                workspace_id=workspace_id,
                goal_id=goal_id,
                day=check_in.day,
                value=check_in.value,
                note=check_in.note,
            )
        )
        await flush(self._session)

    async def delete_check_in(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, check_in_id: uuid.UUID
    ) -> bool:
        return await self._delete(
            FitnessGoalProgressModel,
            FitnessGoalProgressModel.workspace_id == workspace_id,
            FitnessGoalProgressModel.goal_id == goal_id,
            FitnessGoalProgressModel.id == check_in_id,
        )

    # Integrations

    async def habit(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> tuple[str, str] | None:
        row = (
            await self._session.execute(
                select(HabitModel.name, HabitModel.kind).where(
                    HabitModel.workspace_id == workspace_id, HabitModel.id == habit_id
                )
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def habit_links(self, owner: Owner, source: HabitSource | None = None) -> list[HabitLink]:
        query = (
            select(FitnessHabitLinkModel, HabitModel.name, HabitModel.kind)
            .join(
                HabitModel,
                and_(
                    HabitModel.id == FitnessHabitLinkModel.habit_id,
                    HabitModel.workspace_id == FitnessHabitLinkModel.workspace_id,
                ),
            )
            .where(_owned(FitnessHabitLinkModel, owner))
            .order_by(func.lower(HabitModel.name))
        )
        if source is not None:
            query = query.where(FitnessHabitLinkModel.source == source)
        return [
            HabitLink(
                id=link.id,
                habit_id=link.habit_id,
                habit_name=name,
                habit_kind=kind,
                source=cast(HabitSource, link.source),
                activity_kind=cast(ActivityKind | None, link.activity_kind),
                contributes=link.contributes,
            )
            for link, name, kind in (await self._session.execute(query)).all()
        ]

    async def put_habit_link(self, owner: Owner, link_id: uuid.UUID, draft: HabitLinkDraft) -> None:
        await self._put(
            FitnessHabitLinkModel,
            link_id,
            {
                "workspace_id": owner.workspace_id,
                "user_id": owner.user_id,
                "habit_id": draft.habit_id,
                "source": draft.source,
                "activity_kind": draft.activity_kind,
                "contributes": draft.contributes,
            },
        )

    async def delete_habit_link(self, owner: Owner, habit_id: uuid.UUID) -> bool:
        return await self._delete(
            FitnessHabitLinkModel,
            _owned(FitnessHabitLinkModel, owner),
            FitnessHabitLinkModel.habit_id == habit_id,
        )

    async def event_title(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> str | None:
        return await self._session.scalar(
            select(CalendarEventModel.title).where(
                CalendarEventModel.workspace_id == workspace_id, CalendarEventModel.id == event_id
            )
        )

    async def workout_events(
        self, owner: Owner, event_ids: Sequence[uuid.UUID] | None = None
    ) -> dict[uuid.UUID, uuid.UUID | None]:
        query = select(
            FitnessWorkoutEventModel.calendar_event_id, FitnessWorkoutEventModel.template_id
        ).where(_owned(FitnessWorkoutEventModel, owner))
        if event_ids is not None:
            query = query.where(FitnessWorkoutEventModel.calendar_event_id.in_(list(event_ids)))
        return {row[0]: row[1] for row in (await self._session.execute(query)).all()}

    async def put_workout_event(
        self, owner: Owner, event_id: uuid.UUID, template_id: uuid.UUID | None
    ) -> None:
        model = await self._session.get(FitnessWorkoutEventModel, event_id)
        if model is None:
            self._session.add(
                FitnessWorkoutEventModel(
                    calendar_event_id=event_id,
                    workspace_id=owner.workspace_id,
                    user_id=owner.user_id,
                    template_id=template_id,
                )
            )
        elif model.workspace_id == owner.workspace_id and model.user_id == owner.user_id:
            model.template_id = template_id
        await flush(self._session)

    async def delete_workout_event(self, owner: Owner, event_id: uuid.UUID) -> bool:
        deleted = await self._session.execute(
            delete(FitnessWorkoutEventModel)
            .where(
                _owned(FitnessWorkoutEventModel, owner),
                FitnessWorkoutEventModel.calendar_event_id == event_id,
            )
            .returning(FitnessWorkoutEventModel.calendar_event_id)
        )
        return deleted.first() is not None

    async def record_title(
        self, workspace_id: uuid.UUID, kind: LinkTargetKind, record_id: uuid.UUID
    ) -> str | None:
        if kind == "note":
            row = (
                await self._session.execute(
                    select(NoteModel.title).where(
                        NoteModel.workspace_id == workspace_id,
                        NoteModel.id == record_id,
                        NoteModel.trashed_at.is_(None),
                    )
                )
            ).first()
            return (row[0] or "Untitled") if row else None
        return await self._session.scalar(
            select(DocumentModel.title).where(
                DocumentModel.workspace_id == workspace_id,
                DocumentModel.id == record_id,
                DocumentModel.trashed_at.is_(None),
            )
        )

    async def links(
        self, owner: Owner, kind: LinkOwnerKind, owner_id: uuid.UUID
    ) -> list[LinkedRecord]:
        rows = (
            await self._session.execute(
                select(
                    FitnessLinkModel.note_id,
                    NoteModel.title,
                    FitnessLinkModel.document_id,
                    DocumentModel.title,
                )
                .outerjoin(NoteModel, NoteModel.id == FitnessLinkModel.note_id)
                .outerjoin(DocumentModel, DocumentModel.id == FitnessLinkModel.document_id)
                .where(_owned(FitnessLinkModel, owner), _LINK_OWNERS[kind] == owner_id)
                .order_by(FitnessLinkModel.created_at)
            )
        ).all()
        result: list[LinkedRecord] = []
        for note_id, note_title, document_id, document_title in rows:
            if note_id is not None:
                result.append(LinkedRecord("note", note_id, note_title or "Untitled"))
            elif document_id is not None:
                result.append(LinkedRecord("document", document_id, document_title or "Untitled"))
        return result

    async def put_link(
        self,
        owner: Owner,
        kind: LinkOwnerKind,
        owner_id: uuid.UUID,
        target: LinkTargetKind,
        target_id: uuid.UUID,
    ) -> None:
        existing = await self._session.scalar(
            select(FitnessLinkModel.id).where(
                _owned(FitnessLinkModel, owner),
                _LINK_OWNERS[kind] == owner_id,
                _LINK_TARGETS[target] == target_id,
            )
        )
        if existing is not None:
            return
        self._session.add(
            FitnessLinkModel(
                id=uuid.uuid4(),
                workspace_id=owner.workspace_id,
                user_id=owner.user_id,
                session_id=owner_id if kind == "session" else None,
                goal_id=owner_id if kind == "goal" else None,
                note_id=target_id if target == "note" else None,
                document_id=target_id if target == "document" else None,
            )
        )
        await flush(self._session)

    async def delete_link(
        self,
        owner: Owner,
        kind: LinkOwnerKind,
        owner_id: uuid.UUID,
        target: LinkTargetKind,
        target_id: uuid.UUID,
    ) -> bool:
        return await self._delete(
            FitnessLinkModel,
            _owned(FitnessLinkModel, owner),
            _LINK_OWNERS[kind] == owner_id,
            _LINK_TARGETS[target] == target_id,
        )


def build_fitness(
    session: AsyncSession, files: PhotoFiles, clock: Callable[[], datetime] | None = None
) -> Fitness:
    """The health and fitness services, sharing `session`'s transaction with the habit and
    calendar services they use."""
    store = SqlFitnessStore(session)
    transaction = SqlTransaction(session)
    timing = {"clock": clock} if clock else {}
    contributions = Contributions(store, build_habit_service(session, clock))
    return Fitness(
        library=FitnessService(store, transaction, **timing),
        workouts=WorkoutService(store, contributions, transaction, **timing),
        body=BodyService(store, files, transaction, **timing),
        nutrition=NutritionService(store, contributions, transaction, **timing),
        tracking=TrackingService(store, contributions, transaction, **timing),
        integrations=IntegrationService(store, build_calendar_service(session), transaction),
    )


def build_health_linked_habits(session: AsyncSession, user_id: uuid.UUID) -> HabitService:
    """A habit service for one person whose habits linked to Health take their days from that
    person's records, and log amounts into them."""
    return build_habit_service(session, health=HabitHealth(SqlFitnessStore(session), user_id))


async def referenced_photo_blob_ids(session: AsyncSession) -> set[uuid.UUID]:
    """Every progress photo's file, across workspaces, for the worker's sweep of unreferenced
    files."""
    return set(await session.scalars(select(FitnessPhotoModel.blob_id)))
