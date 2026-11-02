"""Body, nutrition, goal, and habit-contribution calculations as pure functions.

- **BMI** is weight in kilograms over height in metres squared, rounded to one decimal, and only
  when both values are within plausible human ranges. It's a general measure that doesn't
  account for muscle, frame, age, or sex; it isn't an assessment of health.
- **Portions** scale a saved food's nutrients by quantity over its serving quantity, rounding
  half up to the canonical unit (whole small calories and milligrams), so a day's total is an
  exact integer sum of its entries.
- **Goal progress** is how far the current value has moved from the start value toward the
  target, from 0 to 1, in either direction (losing or gaining). Milestones sit at 25, 50, 75,
  and 100 percent; with a target date, a straight line from the start date sets when each is
  expected and whether progress is ahead, on track (within 5 points), or behind.
"""

import math
from collections.abc import Sequence
from datetime import date, timedelta

from orbit_api.services.fitness.models import (
    ActivityKind,
    GoalCheckIn,
    GoalPace,
    Milestone,
    Nutrients,
    WaterUnit,
)

MIN_BMI_WEIGHT_G = 2_000
MAX_BMI_WEIGHT_G = 650_000
MIN_BMI_HEIGHT_MM = 500
MAX_BMI_HEIGHT_MM = 2_720
MILESTONES = (0.25, 0.5, 0.75, 1.0)
PACE_TOLERANCE = 0.05
WATER_UNIT_ML: dict[WaterUnit, float] = {"ml": 1.0, "l": 1000.0, "fl_oz": 29.5735295625}
METRES_PER_KM = 1000.0
METRES_PER_MILE = 1609.344


def bmi(weight_g: int, height_mm: int) -> float | None:
    if not MIN_BMI_WEIGHT_G <= weight_g <= MAX_BMI_WEIGHT_G:
        return None
    if not MIN_BMI_HEIGHT_MM <= height_mm <= MAX_BMI_HEIGHT_MM:
        return None
    metres = height_mm / 1000
    return round((weight_g / 1000) / (metres * metres), 1)


def _scale(value: int, quantity_milli: int, serving_milli: int) -> int:
    # Integer round-half-up of value * quantity / serving, for non-negative values.
    return (2 * value * quantity_milli + serving_milli) // (2 * serving_milli)


def scale_nutrients(per_serving: Nutrients, quantity_milli: int, serving_milli: int) -> Nutrients:
    """The nutrients in `quantity_milli` of a food whose values are per `serving_milli`."""
    if serving_milli <= 0 or quantity_milli <= 0:
        raise ValueError("Quantities must be positive.")
    return Nutrients(
        energy_cal=_scale(per_serving.energy_cal, quantity_milli, serving_milli),
        protein_mg=_scale(per_serving.protein_mg, quantity_milli, serving_milli),
        carbs_mg=_scale(per_serving.carbs_mg, quantity_milli, serving_milli),
        fat_mg=_scale(per_serving.fat_mg, quantity_milli, serving_milli),
        fiber_mg=None
        if per_serving.fiber_mg is None
        else _scale(per_serving.fiber_mg, quantity_milli, serving_milli),
    )


def sum_nutrients(items: Sequence[Nutrients]) -> Nutrients:
    total = Nutrients()
    for item in items:
        total = total + item
    return total


def goal_fraction(start: float, target: float, current: float) -> float:
    if target == start:
        return 1.0
    fraction = (current - start) / (target - start)
    return min(1.0, max(0.0, fraction))


def goal_reached(start: float, target: float, current: float) -> bool:
    return current >= target if target > start else current <= target


def _expected_by(start_date: date, target_date: date | None, fraction: float) -> date | None:
    if target_date is None:
        return None
    days = (target_date - start_date).days
    return start_date + timedelta(days=math.ceil(days * fraction))


def milestones(
    start: float,
    target: float,
    start_date: date,
    target_date: date | None,
    history: Sequence[GoalCheckIn],
) -> tuple[Milestone, ...]:
    """Suggested milestones and the first check-in that reached each."""
    ordered = sorted(history, key=lambda c: c.day)
    result: list[Milestone] = []
    for fraction in MILESTONES:
        value = start + (target - start) * fraction
        reached = next(
            (c.day for c in ordered if goal_fraction(start, target, c.value) >= fraction - 1e-9),
            None,
        )
        result.append(
            Milestone(
                fraction=fraction,
                value=value,
                expected_by=_expected_by(start_date, target_date, fraction),
                reached_on=reached,
            )
        )
    return tuple(result)


def goal_pace(
    fraction: float, reached: bool, start_date: date, target_date: date | None, today: date
) -> GoalPace:
    if reached:
        return "reached"
    if target_date is None:
        return "no_target_date"
    total = (target_date - start_date).days
    elapsed = min(max((today - start_date).days, 0), total)
    expected = elapsed / total if total > 0 else 1.0
    if fraction >= expected + PACE_TOLERANCE:
        return "ahead"
    if fraction >= expected - PACE_TOLERANCE:
        return "on_track"
    return "behind"


def water_in_unit(amount_ml: int, unit: WaterUnit) -> float:
    return round(amount_ml / WATER_UNIT_ML[unit], 2)


def distance_in_unit(distance_m: int, miles: bool) -> float:
    return round(distance_m / (METRES_PER_MILE if miles else METRES_PER_KM), 2)


DISTANCE_ACTIVITIES: frozenset[ActivityKind] = frozenset({"walk", "run", "cycle", "swim"})
