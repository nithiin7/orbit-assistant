"""The Health & Fitness dashboard: one read that gathers each section's summary. Sections the
person hid are still computed cheaply but the web app doesn't show them."""

from dataclasses import dataclass
from datetime import date, timedelta

from orbit_api.services.fitness.body import BodyService
from orbit_api.services.fitness.integrations import IntegrationService
from orbit_api.services.fitness.models import Overview, Owner, Targets, WeightPoint
from orbit_api.services.fitness.nutrition import NutritionService
from orbit_api.services.fitness.records import week_start
from orbit_api.services.fitness.service import FitnessService
from orbit_api.services.fitness.tracking import TrackingService
from orbit_api.services.fitness.workouts import WorkoutService

WEIGHT_TREND_DAYS = 90
RECENT = 5


@dataclass(frozen=True, slots=True)
class Fitness:
    """The module's services, sharing one session and transaction."""

    library: FitnessService
    workouts: WorkoutService
    body: BodyService
    nutrition: NutritionService
    tracking: TrackingService
    integrations: IntegrationService

    async def overview(self, owner: Owner, day: date, timezone: str) -> Overview:
        profile = await self.library.profile(owner)
        active = await self.workouts.active(owner)
        today_sessions = await self.workouts.find(
            owner, start=day, end=day, statuses=("completed",)
        )
        recent = await self.workouts.find(owner, statuses=("completed",), limit=RECENT)
        week = week_start(day)
        week_sessions = await self.workouts.find(
            owner, start=week, end=week + timedelta(days=6), statuses=("completed",)
        )
        measurements = await self.body.measurements(
            owner, day - timedelta(days=WEIGHT_TREND_DAYS), day
        )
        goals = await self.tracking.goals(owner, day, ("active",))
        nutrition = await self.nutrition.day(owner, day)
        water = await self.nutrition.water_day(owner, day)
        records = await self.workouts.records(owner)
        scheduled = await self.integrations.scheduled(owner, day, day + timedelta(days=1), timezone)
        return Overview(
            day=day,
            active_session=active.session if active else None,
            completed_today=tuple(today_sessions),
            scheduled_today=tuple(scheduled),
            recent_sessions=tuple(recent),
            week_workouts=len(week_sessions),
            weight_trend=tuple(
                WeightPoint(day=m.day, weight_g=m.values.weight_g)
                for m in measurements
                if m.values.weight_g is not None
            ),
            goals=tuple(goals),
            nutrition=nutrition.totals,
            targets=profile.settings.targets if profile else Targets(),
            water_ml=water.total_ml,
            recent_activities=tuple(await self.tracking.activities(owner, limit=RECENT)),
            records=tuple(
                sorted(records, key=lambda r: (r.day, r.exercise_name), reverse=True)[:RECENT]
            ),
            hidden_sections=profile.settings.hidden_sections,
        )
