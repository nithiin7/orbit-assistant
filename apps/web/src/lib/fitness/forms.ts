/**
 * Health & Fitness form values, Yup schemas mirroring the API's rules, and their conversion to
 * requests. Forms hold text in the person's units; requests carry the API's canonical units.
 */

import type {
  ActivityKind,
  ActivityRequest,
  Equipment,
  Exercise,
  ExerciseCategory,
  ExerciseRequest,
  ExerciseType,
  FitnessGoal,
  FitnessGoalCategory,
  FitnessGoalRequest,
  FitnessProfile,
  FitnessProfileRequest,
  FitnessSection,
  Food,
  FoodRequest,
  MealType,
  Measurement,
  MeasurementRequest,
  Muscle,
  Portion,
  PortionRequest,
  SavedMealRequest,
  UnitSystem,
  WorkoutTemplate,
  WorkoutTemplateCategory,
  WorkoutTemplateRequest,
} from "@orbit/contracts";
import { array, mixed, object, string, type TestContext } from "yup";

import { addDays } from "@/utils/dates";
import { zonedTimeToInstant } from "@/utils/time-zones";
import { multiLineText, singleLineText } from "@/utils/validation";

import { activityFields, type Units } from "./fitness";
import {
  distanceInput,
  energyInput,
  gramsInput,
  hoursInput,
  KJ_PER_KCAL,
  lengthInput,
  minutesInput,
  ML_PER_FL_OZ,
  MM_PER_INCH,
  parseDecimal,
  parseDistance,
  parseEnergy,
  parseGrams,
  parseHours,
  parseLength,
  parseMinutes,
  parseQuantity,
  parseWater,
  parseWeight,
  quantityInput,
  waterInput,
  weightInput,
} from "./units";

const NAME_MAX = 100;
const NOTE_MAX = 1000;

/** An optional decimal: blank, or a number in `[min, max]`. */
function optionalNumber(message: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return string()
    .defined()
    .test("number", message, (value) => {
      if (value.trim() === "") return true;
      const number = parseDecimal(value);
      return number !== null && number >= min && number <= max;
    });
}

function requiredNumber(message: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return string()
    .defined()
    .test("number", message, (value) => {
      const number = parseDecimal(value);
      return number !== null && number >= min && number <= max;
    });
}

function orNull<T>(value: T | null): T | null {
  return value === null || Number.isNaN(value) ? null : value;
}

// Profile

export type ProfileFormValues = {
  unitSystem: UnitSystem;
  weightUnit: FitnessProfile["weight_unit"];
  lengthUnit: FitnessProfile["length_unit"];
  distanceUnit: FitnessProfile["distance_unit"];
  energyUnit: FitnessProfile["energy_unit"];
  waterUnit: FitnessProfile["water_unit"];
  height: string;
  dateOfBirth: string;
  energyTarget: string;
  proteinTarget: string;
  carbsTarget: string;
  fatTarget: string;
  fiberTarget: string;
  waterTarget: string;
  /** Daily steps. Blank uses the default goal. */
  stepsTarget: string;
  /** Daily active minutes. */
  activeTarget: string;
  /** Nightly sleep, in hours. */
  sleepTarget: string;
  quickAmounts: string;
  hiddenSections: FitnessSection[];
};

// The API's profile limits, in its canonical units.
const HEIGHT_MM = { min: 500, max: 2720 };
const WATER_TARGET_MAX_ML = 20_000;
const ENERGY_TARGET_MAX_CAL = 20_000_000;
const QUICK_AMOUNT_MAX_ML = 5000;

/**
 * An optional amount typed in the person's units, checked against the API's range in canonical
 * units so a value it would refuse is flagged on its field with the range in those units.
 */
function optionalInRange(
  toCanonical: (value: string, parent: Partial<ProfileFormValues>) => number | null,
  range: (parent: Partial<ProfileFormValues>) => string,
  min: number,
  max: number,
) {
  return string()
    .defined()
    .test("range", (value, context) => {
      if (value.trim() === "") return true;
      const parent = context.parent as Partial<ProfileFormValues>;
      const canonical = toCanonical(value, parent);
      if (canonical !== null && canonical >= min && canonical <= max) return true;
      return context.createError({ message: `Enter ${range(parent)}, or leave it blank.` });
    });
}

/** `value` in `unit`, rounded for showing a limit. */
function limit(value: number, unit: string): string {
  return `${Number(value.toFixed(value < 100 ? 1 : 0)).toLocaleString()} ${unit}`;
}

export const profileSchema = object({
  unitSystem: mixed<UnitSystem>().defined(),
  weightUnit: mixed<FitnessProfile["weight_unit"]>().defined(),
  lengthUnit: mixed<FitnessProfile["length_unit"]>().defined(),
  distanceUnit: mixed<FitnessProfile["distance_unit"]>().defined(),
  energyUnit: mixed<FitnessProfile["energy_unit"]>().defined(),
  waterUnit: mixed<FitnessProfile["water_unit"]>().defined(),
  height: optionalInRange(
    (value, { lengthUnit = "cm" }) => parseLength(value, lengthUnit),
    ({ lengthUnit = "cm" }) =>
      lengthUnit === "cm"
        ? `a height from ${limit(HEIGHT_MM.min / 10, "cm")} to ${limit(HEIGHT_MM.max / 10, "cm")}`
        : `a height from ${limit(HEIGHT_MM.min / MM_PER_INCH, "in")} to ${limit(HEIGHT_MM.max / MM_PER_INCH, "in")}`,
    HEIGHT_MM.min,
    HEIGHT_MM.max,
  ),
  dateOfBirth: string().defined(),
  energyTarget: optionalInRange(
    (value, { energyUnit = "kcal" }) => parseEnergy(value, energyUnit),
    ({ energyUnit = "kcal" }) =>
      `up to ${energyUnit === "kcal" ? limit(ENERGY_TARGET_MAX_CAL / 1000, "kcal") : limit((ENERGY_TARGET_MAX_CAL / 1000) * KJ_PER_KCAL, "kJ")}`,
    1,
    ENERGY_TARGET_MAX_CAL,
  ),
  proteinTarget: optionalNumber("Enter grams, or leave it blank.", 0, 2000),
  carbsTarget: optionalNumber("Enter grams, or leave it blank.", 0, 2000),
  fatTarget: optionalNumber("Enter grams, or leave it blank.", 0, 2000),
  fiberTarget: optionalNumber("Enter grams, or leave it blank.", 0, 2000),
  waterTarget: optionalInRange(
    (value, { waterUnit = "ml" }) => parseWater(value, waterUnit),
    ({ waterUnit = "ml" }) =>
      `up to ${
        waterUnit === "ml"
          ? limit(WATER_TARGET_MAX_ML, "ml")
          : waterUnit === "l"
            ? limit(WATER_TARGET_MAX_ML / 1000, "l")
            : limit(WATER_TARGET_MAX_ML / ML_PER_FL_OZ, "fl oz")
      }`,
    1,
    WATER_TARGET_MAX_ML,
  ),
  stepsTarget: optionalNumber("Enter 1 to 200,000 steps, or leave it blank.", 1, 200_000),
  activeTarget: optionalNumber("Enter 1 to 1,440 minutes, or leave it blank.", 1, 1440),
  sleepTarget: optionalNumber("Enter 1 to 24 hours, or leave it blank.", 1, 24),
  quickAmounts: string()
    .defined()
    .test("amounts", "List up to six amounts, separated by commas.", (value, context) => {
      const { waterUnit = "ml" } = context.parent as Partial<ProfileFormValues>;
      const parts = value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return (
        parts.length <= 6 &&
        parts.every((part) => {
          const ml = parseWater(part, waterUnit);
          return ml !== null && ml >= 1 && ml <= QUICK_AMOUNT_MAX_ML;
        })
      );
    }),
  hiddenSections: array(mixed<FitnessSection>().defined()).defined(),
});

export function toProfileFormValues(profile: FitnessProfile): ProfileFormValues {
  const t = profile.targets;
  return {
    unitSystem: profile.unit_system,
    weightUnit: profile.weight_unit,
    lengthUnit: profile.length_unit,
    distanceUnit: profile.distance_unit,
    energyUnit: profile.energy_unit,
    waterUnit: profile.water_unit,
    height: lengthInput(profile.height_mm, profile.length_unit),
    dateOfBirth: profile.date_of_birth ?? "",
    energyTarget: energyInput(t.energy_cal, profile.energy_unit),
    proteinTarget: gramsInput(t.protein_mg),
    carbsTarget: gramsInput(t.carbs_mg),
    fatTarget: gramsInput(t.fat_mg),
    fiberTarget: gramsInput(t.fiber_mg),
    waterTarget: waterInput(t.water_ml, profile.water_unit),
    stepsTarget: t.steps == null ? "" : String(t.steps),
    activeTarget: t.active_s == null ? "" : String(Math.round(t.active_s / 60)),
    sleepTarget: t.sleep_s == null ? "" : String(Math.round(t.sleep_s / 360) / 10),
    quickAmounts: profile.water_quick_amounts_ml
      .map((ml) => waterInput(ml, profile.water_unit))
      .join(", "),
    hiddenSections: [...profile.hidden_sections],
  };
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/** A typed number times `scale`, rounded, or `null` when blank or not positive. */
function scaledOrNull(value: string, scale: number): number | null {
  const number = parseDecimal(value);
  return number !== null && number > 0 ? Math.round(number * scale) : null;
}

export function toProfileRequest(values: ProfileFormValues): FitnessProfileRequest {
  return {
    unit_system: values.unitSystem,
    weight_unit: values.weightUnit,
    length_unit: values.lengthUnit,
    distance_unit: values.distanceUnit,
    energy_unit: values.energyUnit,
    water_unit: values.waterUnit,
    height_mm: parseLength(values.height, values.lengthUnit),
    date_of_birth: values.dateOfBirth || null,
    targets: {
      energy_cal: positiveOrNull(parseEnergy(values.energyTarget, values.energyUnit)),
      protein_mg: positiveOrNull(parseGrams(values.proteinTarget)),
      carbs_mg: positiveOrNull(parseGrams(values.carbsTarget)),
      fat_mg: positiveOrNull(parseGrams(values.fatTarget)),
      fiber_mg: positiveOrNull(parseGrams(values.fiberTarget)),
      water_ml: positiveOrNull(parseWater(values.waterTarget, values.waterUnit)),
      steps: scaledOrNull(values.stepsTarget, 1),
      active_s: scaledOrNull(values.activeTarget, 60),
      sleep_s: scaledOrNull(values.sleepTarget, 3600),
    },
    water_quick_amounts_ml: values.quickAmounts
      .split(",")
      .map((part) => parseWater(part, values.waterUnit))
      .filter((ml): ml is number => ml !== null && ml > 0),
    hidden_sections: values.hiddenSections,
  };
}

// Exercises

export type ExerciseFormValues = {
  name: string;
  category: ExerciseCategory;
  exerciseType: ExerciseType;
  equipment: Equipment;
  description: string;
  instructions: string;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
};

export const exerciseSchema = object({
  name: singleLineText(NAME_MAX).required("Name the exercise."),
  category: mixed<ExerciseCategory>().defined(),
  exerciseType: mixed<ExerciseType>().defined(),
  equipment: mixed<Equipment>().defined(),
  description: multiLineText(2000),
  instructions: multiLineText(5000),
  primaryMuscles: array(mixed<Muscle>().defined()).defined().max(10),
  secondaryMuscles: array(mixed<Muscle>().defined())
    .defined()
    .max(10)
    .test(
      "distinct",
      "A muscle can’t be both primary and secondary.",
      (value, context: TestContext) => {
        const primary: unknown = context.parent.primaryMuscles;
        return !Array.isArray(primary) || !value.some((muscle) => primary.includes(muscle));
      },
    ),
});

export function newExerciseValues(): ExerciseFormValues {
  return {
    name: "",
    category: "strength",
    exerciseType: "weight_reps",
    equipment: "none",
    description: "",
    instructions: "",
    primaryMuscles: [],
    secondaryMuscles: [],
  };
}

export function toExerciseFormValues(exercise: Exercise): ExerciseFormValues {
  return {
    name: exercise.name,
    category: exercise.category,
    exerciseType: exercise.exercise_type,
    equipment: exercise.equipment,
    description: exercise.description,
    instructions: exercise.instructions,
    primaryMuscles: [...exercise.primary_muscles],
    secondaryMuscles: [...exercise.secondary_muscles],
  };
}

export function toExerciseRequest(values: ExerciseFormValues): ExerciseRequest {
  return {
    name: values.name,
    category: values.category,
    exercise_type: values.exerciseType,
    equipment: values.equipment,
    description: values.description,
    instructions: values.instructions,
    primary_muscles: values.primaryMuscles,
    secondary_muscles: values.secondaryMuscles,
  };
}

// Templates

export type TemplateExerciseFields = {
  exerciseId: string;
  sets: string;
  repsMin: string;
  repsMax: string;
  weight: string;
  rest: string;
  notes: string;
};

export type TemplateFormValues = {
  name: string;
  category: WorkoutTemplateCategory;
  description: string;
  notes: string;
  exercises: TemplateExerciseFields[];
};

const wholeNumber = (message: string, min: number, max: number) =>
  string()
    .defined()
    .test("whole", message, (value) => {
      if (value.trim() === "") return true;
      const number = Number(value);
      return Number.isInteger(number) && number >= min && number <= max;
    });

export const templateSchema = object({
  name: singleLineText(NAME_MAX).required("Name the template."),
  category: mixed<WorkoutTemplateCategory>().defined(),
  description: multiLineText(2000),
  notes: multiLineText(5000),
  exercises: array(
    object({
      exerciseId: string().defined().required("Choose an exercise."),
      sets: wholeNumber("Use 1 to 20 sets.", 1, 20).required("Use 1 to 20 sets."),
      repsMin: wholeNumber("Use 1 to 1,000 reps.", 1, 1000),
      repsMax: wholeNumber("Use 1 to 1,000 reps.", 1, 1000).test(
        "range",
        "The most reps can’t be below the fewest.",
        (value, context: TestContext) => {
          const min = Number(context.parent.repsMin);
          return value.trim() === "" || Number.isNaN(min) || Number(value) >= min;
        },
      ),
      weight: optionalNumber("Enter a weight, or leave it blank."),
      rest: wholeNumber("Use 0 to 3,600 seconds.", 0, 3600),
      notes: multiLineText(NOTE_MAX),
    }),
  )
    .defined()
    .max(30, "A template can have up to 30 exercises."),
});

export function newTemplateValues(): TemplateFormValues {
  return { name: "", category: "other", description: "", notes: "", exercises: [] };
}

export function newTemplateExercise(exerciseId: string): TemplateExerciseFields {
  return { exerciseId, sets: "3", repsMin: "", repsMax: "", weight: "", rest: "", notes: "" };
}

export function toTemplateFormValues(template: WorkoutTemplate, units: Units): TemplateFormValues {
  return {
    name: template.name,
    category: template.category,
    description: template.description,
    notes: template.notes,
    exercises: template.exercises.map((item) => ({
      exerciseId: item.exercise_id,
      sets: String(item.sets),
      repsMin: item.target_reps_min === null ? "" : String(item.target_reps_min),
      repsMax: item.target_reps_max === null ? "" : String(item.target_reps_max),
      weight: weightInput(item.target_weight_g, units.weight_unit),
      rest: item.rest_seconds === null ? "" : String(item.rest_seconds),
      notes: item.notes,
    })),
  };
}

function optionalInt(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function toTemplateRequest(
  values: TemplateFormValues,
  units: Units,
): WorkoutTemplateRequest {
  return {
    name: values.name,
    category: values.category,
    description: values.description,
    notes: values.notes,
    exercises: values.exercises.map((item) => ({
      exercise_id: item.exerciseId,
      sets: Number(item.sets),
      target_reps_min: optionalInt(item.repsMin),
      target_reps_max: optionalInt(item.repsMax),
      target_weight_g: parseWeight(item.weight, units.weight_unit),
      target_duration_s: null,
      target_distance_m: null,
      rest_seconds: optionalInt(item.rest),
      notes: item.notes,
    })),
  };
}

// Measurements

export const MEASUREMENT_FIELDS = [
  "waist",
  "chest",
  "hips",
  "arm",
  "thigh",
  "neck",
] as const satisfies readonly string[];
export type CircumferenceField = (typeof MEASUREMENT_FIELDS)[number];

export const CIRCUMFERENCE_LABELS: Record<CircumferenceField, string> = {
  waist: "Waist",
  chest: "Chest",
  hips: "Hips",
  arm: "Arm",
  thigh: "Thigh",
  neck: "Neck",
};

export type MeasurementFormValues = {
  day: string;
  weight: string;
  bodyFat: string;
  height: string;
  note: string;
} & Record<CircumferenceField, string>;

const circumference = optionalNumber("Enter a measurement, or leave it blank.");

export const measurementSchema = object({
  day: string().defined().required("Choose a date."),
  weight: optionalNumber("Enter a weight, or leave it blank."),
  bodyFat: optionalNumber("Use a percentage between 0 and 100.", 0.1, 99.9),
  height: optionalNumber("Enter a height, or leave it blank."),
  waist: circumference,
  chest: circumference,
  hips: circumference,
  arm: circumference,
  thigh: circumference,
  neck: circumference,
  note: multiLineText(NOTE_MAX),
}).test("any", "Enter at least one measurement.", (values, context) =>
  [values.weight, values.bodyFat, values.height, ...MEASUREMENT_FIELDS.map((f) => values[f])].some(
    (value) => value.trim() !== "",
  )
    ? true
    : context.createError({ path: "weight", message: "Enter at least one measurement." }),
);

export function newMeasurementValues(day: string): MeasurementFormValues {
  return {
    day,
    weight: "",
    bodyFat: "",
    height: "",
    waist: "",
    chest: "",
    hips: "",
    arm: "",
    thigh: "",
    neck: "",
    note: "",
  };
}

export function toMeasurementFormValues(
  measurement: Measurement,
  units: Units,
): MeasurementFormValues {
  const length = (mm: number | null) => lengthInput(mm, units.length_unit);
  return {
    day: measurement.day,
    weight: weightInput(measurement.weight_g, units.weight_unit),
    bodyFat: measurement.body_fat_pct === null ? "" : String(measurement.body_fat_pct),
    height: length(measurement.height_mm),
    waist: length(measurement.waist_mm),
    chest: length(measurement.chest_mm),
    hips: length(measurement.hips_mm),
    arm: length(measurement.arm_mm),
    thigh: length(measurement.thigh_mm),
    neck: length(measurement.neck_mm),
    note: measurement.note,
  };
}

export function toMeasurementRequest(
  values: MeasurementFormValues,
  units: Units,
): MeasurementRequest {
  const length = (text: string) => parseLength(text, units.length_unit);
  return {
    day: values.day,
    weight_g: parseWeight(values.weight, units.weight_unit),
    body_fat_pct: orNull(parseDecimal(values.bodyFat)),
    height_mm: length(values.height),
    waist_mm: length(values.waist),
    chest_mm: length(values.chest),
    hips_mm: length(values.hips),
    arm_mm: length(values.arm),
    thigh_mm: length(values.thigh),
    neck_mm: length(values.neck),
    note: values.note,
  };
}

// Foods and entries

export type NutrientFields = {
  energy: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
};

const nutrientFields = {
  energy: requiredNumber("Enter the energy, or 0.", 0, 100_000),
  protein: optionalNumber("Enter grams, or leave it blank.", 0, 10_000),
  carbs: optionalNumber("Enter grams, or leave it blank.", 0, 10_000),
  fat: optionalNumber("Enter grams, or leave it blank.", 0, 10_000),
  fiber: optionalNumber("Enter grams, or leave it blank.", 0, 10_000),
};

function toNutrients(values: NutrientFields, units: Units) {
  return {
    energy_cal: parseEnergy(values.energy, units.energy_unit) ?? 0,
    protein_mg: parseGrams(values.protein) ?? 0,
    carbs_mg: parseGrams(values.carbs) ?? 0,
    fat_mg: parseGrams(values.fat) ?? 0,
    fiber_mg: parseGrams(values.fiber),
  };
}

export type FoodFormValues = NutrientFields & {
  name: string;
  servingQuantity: string;
  servingUnit: string;
};

export const foodSchema = object({
  name: singleLineText(NAME_MAX).required("Name the food."),
  servingQuantity: requiredNumber("Enter how much one serving is.", 0.001, 100_000).test(
    "positive",
    "Enter how much one serving is.",
    (value) => (parseDecimal(value) ?? 0) > 0,
  ),
  servingUnit: singleLineText(20).required("Enter a unit, such as g, cup, or slice."),
  ...nutrientFields,
});

export function newFoodValues(): FoodFormValues {
  return {
    name: "",
    servingQuantity: "100",
    servingUnit: "g",
    energy: "",
    protein: "",
    carbs: "",
    fat: "",
    fiber: "",
  };
}

export function toFoodFormValues(food: Food, units: Units): FoodFormValues {
  const n = food.nutrients;
  return {
    name: food.name,
    servingQuantity: quantityInput(food.serving_quantity_milli),
    servingUnit: food.serving_unit,
    energy: energyInput(n.energy_cal, units.energy_unit),
    protein: gramsInput(n.protein_mg),
    carbs: gramsInput(n.carbs_mg),
    fat: gramsInput(n.fat_mg),
    fiber: gramsInput(n.fiber_mg),
  };
}

export function toFoodRequest(values: FoodFormValues, units: Units): FoodRequest {
  return {
    name: values.name,
    serving_quantity_milli: parseQuantity(values.servingQuantity) ?? 1000,
    serving_unit: values.servingUnit,
    nutrients: toNutrients(values, units),
  };
}

export type MealNameFormValues = { name: string };

export const mealNameSchema = object({
  name: singleLineText(NAME_MAX).required("Name the meal, such as “Rice combo”."),
});

/** A saved meal holding copies of these portions (their nutrients are kept as logged). */
export function toSavedMealRequest(name: string, portions: readonly Portion[]): SavedMealRequest {
  return {
    name: name.trim(),
    items: portions.map((portion) => ({
      quantity_milli: portion.quantity_milli,
      food_id: null,
      name: portion.name,
      serving_unit: portion.serving_unit,
      nutrients: portion.nutrients,
    })),
  };
}

export type EntryFormValues = NutrientFields & {
  day: string;
  meal: MealType;
  /** A saved food, or `""` to type the food in. */
  foodId: string;
  name: string;
  quantity: string;
  servingUnit: string;
  note: string;
  /** Also save a typed-in food for next time. */
  saveFood: boolean;
};

export const entrySchema = object({
  day: string().defined().required("Choose a date."),
  meal: mixed<MealType>().defined(),
  foodId: string().defined(),
  quantity: requiredNumber("Enter how much.", 0.001, 100_000).test(
    "positive",
    "Enter how much.",
    (value) => (parseDecimal(value) ?? 0) > 0,
  ),
  name: singleLineText(NAME_MAX).when("foodId", {
    is: "",
    then: (schema) => schema.required("Name the food."),
  }),
  servingUnit: singleLineText(20).when("foodId", {
    is: "",
    then: (schema) => schema.required("Enter a unit, such as g, cup, or slice."),
  }),
  energy: string()
    .defined()
    .when("foodId", { is: "", then: () => nutrientFields.energy }),
  protein: nutrientFields.protein,
  carbs: nutrientFields.carbs,
  fat: nutrientFields.fat,
  fiber: nutrientFields.fiber,
  note: multiLineText(NOTE_MAX),
  saveFood: mixed<boolean>().defined(),
});

export function newEntryValues(day: string, meal: MealType): EntryFormValues {
  return {
    day,
    meal,
    foodId: "",
    name: "",
    quantity: "1",
    servingUnit: "serving",
    energy: "",
    protein: "",
    carbs: "",
    fat: "",
    fiber: "",
    note: "",
    saveFood: false,
  };
}

/** The portion an entry form describes. Typed-in nutrients are for the whole quantity. */
export function toPortionRequest(values: EntryFormValues, units: Units): PortionRequest {
  const quantity = parseQuantity(values.quantity) ?? 1000;
  if (values.foodId) {
    return {
      quantity_milli: quantity,
      food_id: values.foodId,
      name: null,
      serving_unit: null,
      nutrients: null,
    };
  }
  return {
    quantity_milli: quantity,
    food_id: null,
    name: values.name,
    serving_unit: values.servingUnit,
    nutrients: toNutrients(values, units),
  };
}

// Activity

export type ActivityFormValues = {
  day: string;
  kind: ActivityKind;
  steps: string;
  distance: string;
  /** Minutes, or hours for sleep. */
  duration: string;
  note: string;
};

export const activitySchema = object({
  day: string().defined().required("Choose a date."),
  kind: mixed<ActivityKind>().defined(),
  steps: string()
    .defined()
    .when("kind", {
      is: "steps",
      then: () => wholeNumber("Use 1 to 200,000 steps.", 1, 200_000).required("Enter your steps."),
    }),
  distance: optionalNumber("Enter a distance, or leave it blank."),
  duration: optionalNumber("Enter a duration, or leave it blank.").when("kind", {
    is: "sleep",
    then: () => requiredNumber("Enter hours of sleep.", 0.1, 24),
  }),
  note: multiLineText(NOTE_MAX),
}).test("values", "Enter a distance, a duration, or both.", (values, context) => {
  const fields = activityFields(values.kind);
  if (!fields.distance || values.distance.trim() !== "" || values.duration.trim() !== "") {
    return true;
  }
  return context.createError({
    path: "distance",
    message: "Enter a distance, a duration, or both.",
  });
});

export function newActivityValues(day: string, kind: ActivityKind = "steps"): ActivityFormValues {
  return { day, kind, steps: "", distance: "", duration: "", note: "" };
}

export function toActivityRequest(values: ActivityFormValues, units: Units): ActivityRequest {
  const fields = activityFields(values.kind);
  const steps = values.steps.trim() === "" ? null : Number(values.steps);
  return {
    day: values.day,
    kind: values.kind,
    steps: fields.steps ? steps : null,
    distance_m: fields.distance ? parseDistance(values.distance, units.distance_unit) : null,
    duration_s: !fields.duration
      ? null
      : values.kind === "sleep"
        ? parseHours(values.duration)
        : parseMinutes(values.duration),
    note: values.note,
  };
}

export function toActivityFormValues(
  activity: {
    day: string;
    kind: ActivityKind;
    steps: number | null;
    distance_m: number | null;
    duration_s: number | null;
    note: string;
  },
  units: Units,
): ActivityFormValues {
  return {
    day: activity.day,
    kind: activity.kind,
    steps: activity.steps === null ? "" : String(activity.steps),
    distance: distanceInput(activity.distance_m, units.distance_unit),
    duration:
      activity.kind === "sleep"
        ? hoursInput(activity.duration_s)
        : minutesInput(activity.duration_s),
    note: activity.note,
  };
}

// Goals

export type GoalFormValues = {
  name: string;
  category: FitnessGoalCategory;
  description: string;
  unit: string;
  startValue: string;
  targetValue: string;
  startDate: string;
  targetDate: string;
  autoTrack: boolean;
  exerciseId: string;
  habitId: string;
};

export const goalSchema = object({
  name: singleLineText(NAME_MAX).required("Name the goal."),
  category: mixed<FitnessGoalCategory>().defined(),
  description: multiLineText(2000),
  unit: singleLineText(20).when("category", {
    is: "custom",
    then: (schema) => schema.required("Enter a unit, such as pages or minutes."),
  }),
  startValue: requiredNumber("Enter where you’re starting from.", -1_000_000, 1_000_000_000),
  targetValue: requiredNumber("Enter your target.", -1_000_000, 1_000_000_000).test(
    "differs",
    "The target must differ from the starting value.",
    (value, context: TestContext) => value.trim() !== String(context.parent.startValue).trim(),
  ),
  startDate: string().defined().required("Choose a start date."),
  targetDate: string()
    .defined()
    .test(
      "after",
      "The target date must be after the start date.",
      (value, context: TestContext) => value === "" || value > String(context.parent.startDate),
    ),
  autoTrack: mixed<boolean>().defined(),
  exerciseId: string()
    .defined()
    .when(["category", "autoTrack"], {
      is: (category: FitnessGoalCategory, autoTrack: boolean) =>
        category === "strength" && autoTrack,
      then: (schema) => schema.required("Choose the exercise to track."),
    }),
  habitId: string().defined(),
});

/** A goal value typed in the person's units, as the API's canonical value. */
export function parseGoalValue(
  input: string,
  category: FitnessGoalCategory,
  units: Units,
): number | null {
  switch (category) {
    case "body_weight":
    case "strength":
      return parseWeight(input, units.weight_unit);
    case "running_distance":
      return parseDistance(input, units.distance_unit);
    case "running_duration":
      return parseMinutes(input);
    case "nutrition":
      return parseEnergy(input, units.energy_unit);
    case "water":
      return parseWater(input, units.water_unit);
    case "workout_frequency":
    case "custom":
      return parseDecimal(input);
  }
}

export function goalValueInput(value: number, category: FitnessGoalCategory, units: Units): string {
  switch (category) {
    case "body_weight":
    case "strength":
      return weightInput(value, units.weight_unit);
    case "running_distance":
      return distanceInput(value, units.distance_unit);
    case "running_duration":
      return minutesInput(value);
    case "nutrition":
      return energyInput(value, units.energy_unit);
    case "water":
      return waterInput(value, units.water_unit);
    case "workout_frequency":
    case "custom":
      return String(value);
  }
}

export function newGoalValues(today: string): GoalFormValues {
  return {
    name: "",
    category: "body_weight",
    description: "",
    unit: "",
    startValue: "",
    targetValue: "",
    startDate: today,
    targetDate: "",
    autoTrack: false,
    exerciseId: "",
    habitId: "",
  };
}

export function toGoalFormValues(goal: FitnessGoal, units: Units): GoalFormValues {
  return {
    name: goal.name,
    category: goal.category,
    description: goal.description,
    unit: goal.category === "custom" ? goal.unit : "",
    startValue: goalValueInput(goal.start_value, goal.category, units),
    targetValue: goalValueInput(goal.target_value, goal.category, units),
    startDate: goal.start_date,
    targetDate: goal.target_date ?? "",
    autoTrack: goal.auto_track,
    exerciseId: goal.exercise_id ?? "",
    habitId: goal.habit_id ?? "",
  };
}

export function toGoalRequest(values: GoalFormValues, units: Units): FitnessGoalRequest {
  const parse = (input: string) => parseGoalValue(input, values.category, units) ?? 0;
  const tracks = values.category === "body_weight" || values.category === "strength";
  return {
    name: values.name,
    category: values.category,
    description: values.description,
    unit: values.category === "custom" ? values.unit : "",
    start_value: parse(values.startValue),
    target_value: parse(values.targetValue),
    start_date: values.startDate,
    target_date: values.targetDate || null,
    auto_track: tracks && values.autoTrack,
    exercise_id: values.exerciseId || null,
    habit_id: values.habitId || null,
  };
}

// Scheduling and logging workouts

export type WhenFormValues = {
  name: string;
  templateId: string;
  date: string;
  time: string;
  minutes: string;
};

export const whenSchema = object({
  name: singleLineText(NAME_MAX),
  templateId: string().defined(),
  date: string().defined().required("Choose a date."),
  time: string()
    .defined()
    .matches(/^\d{2}:\d{2}$/, "Choose a time."),
  minutes: wholeNumber("Use 1 to 1,440 minutes.", 1, 1440).required("Enter how long."),
});

export type ScheduleFormValues = WhenFormValues & { alert: string };

export const scheduleSchema = whenSchema.shape({ alert: string().defined() });

/** The local wall-clock end of `minutes` from `date` and `time`, as `YYYY-MM-DDTHH:MM`. */
export function localEnd(date: string, time: string, minutes: number): string {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const day = addDays(date, Math.floor(total / 1440));
  const rest = total % 1440;
  const hh = String(Math.floor(rest / 60)).padStart(2, "0");
  const mm = String(rest % 60).padStart(2, "0");
  return `${day}T${hh}:${mm}`;
}

/** The start and end instants of a past workout in `timeZone`. */
export function loggedTimes(
  values: WhenFormValues,
  timeZone: string,
): { started_at: string; ended_at: string } {
  const start = zonedTimeToInstant(values.date, values.time, timeZone);
  const end = new Date(start.getTime() + Number(values.minutes) * 60_000);
  return { started_at: start.toISOString(), ended_at: end.toISOString() };
}
