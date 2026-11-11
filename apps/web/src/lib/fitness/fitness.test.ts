import { describe, expect, it } from "vitest";

import {
  describeActivity,
  describeSet,
  fitnessHref,
  formatGoalValue,
  formatRecord,
  IMPERIAL_UNITS,
  matchesName,
  METRIC_UNITS,
  parseFitnessLocation,
  share,
  sortFoods,
} from "./fitness";
import {
  entrySchema,
  goalSchema,
  localEnd,
  loggedTimes,
  measurementSchema,
  newEntryValues,
  newGoalValues,
  newMeasurementValues,
  parseGoalValue,
  profileSchema,
  toActivityRequest,
  toGoalRequest,
  toMeasurementRequest,
  toPortionRequest,
  toProfileFormValues,
  toProfileRequest,
} from "./forms";
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatEnergy,
  formatWater,
  formatWeight,
  parseClock,
  parseDecimal,
  parseDistance,
  parseEnergy,
  parseLength,
  parseWater,
  parseWeight,
  weightInput,
} from "./units";

describe("units", () => {
  it("parse decimals with a point or comma", () => {
    expect(parseDecimal("72.5")).toBe(72.5);
    expect(parseDecimal("72,5")).toBe(72.5);
    expect(parseDecimal(".5")).toBe(0.5);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("12kg")).toBeNull();
  });

  it("convert weight with exact factors and round to the gram", () => {
    expect(parseWeight("100", "kg")).toBe(100_000);
    expect(parseWeight("225", "lb")).toBe(102_058);
    expect(parseWeight("2.5", "lb")).toBe(1_134);
    // A typed weight survives the round trip.
    expect(weightInput(parseWeight("225", "lb"), "lb")).toBe("225");
    expect(weightInput(parseWeight("102.5", "kg"), "kg")).toBe("102.5");
    expect(formatWeight(102_058, "lb")).toBe("225 lb");
    expect(formatWeight(null, "kg")).toBe("—");
  });

  it("convert lengths, distances, energy, and water", () => {
    expect(parseLength("175", "cm")).toBe(1750);
    expect(parseLength("70", "in")).toBe(1778);
    expect(parseDistance("5", "km")).toBe(5000);
    expect(parseDistance("3.1", "mi")).toBe(4989);
    expect(formatDistance(800, "km")).toBe("800 m");
    expect(formatDistance(8047, "mi")).toBe("5 mi");
    expect(parseEnergy("250", "kcal")).toBe(250_000);
    expect(parseEnergy("1046", "kj")).toBe(250_000);
    expect(formatEnergy(250_000, "kj")).toBe("1,046 kJ");
    expect(parseWater("1.5", "l")).toBe(1500);
    expect(parseWater("16", "fl_oz")).toBe(473);
    expect(formatWater(1500, "l")).toBe("1.5 L");
  });

  it("format and parse durations", () => {
    expect(formatDuration(40)).toBe("40 s");
    expect(formatDuration(2700)).toBe("45 min");
    expect(formatDuration(3900)).toBe("1 h 05 min");
    expect(formatClock(3909)).toBe("1:05:09");
    expect(formatClock(90)).toBe("1:30");
    expect(parseClock("1:30")).toBe(90);
    expect(parseClock("1:05:09")).toBe(3909);
    expect(parseClock("45")).toBe(45);
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });
});

describe("display", () => {
  it("describe sets by exercise type", () => {
    const set = { reps: 5, weight_g: 100_000, duration_s: 1500, distance_m: 5000 };
    expect(describeSet(set, "weight_reps", METRIC_UNITS)).toBe("100 kg × 5");
    expect(describeSet(set, "reps", METRIC_UNITS)).toBe("5 reps");
    expect(describeSet(set, "duration", METRIC_UNITS)).toBe("25 min");
    expect(describeSet(set, "distance_duration", METRIC_UNITS)).toBe("5 km in 25 min");
  });

  it("label estimated records as estimates", () => {
    const record = {
      exercise_id: "e",
      exercise_name: "Bench press",
      kind: "estimated_1rm" as const,
      value: 116_667,
      reps: 5,
      weight_g: 100_000,
      day: "2026-01-01",
      session_id: "s",
      estimated: true,
    };
    expect(formatRecord(record, METRIC_UNITS)).toBe("≈ 116.67 kg");
    expect(formatRecord({ ...record, kind: "max_weight", value: 100_000 }, IMPERIAL_UNITS)).toBe(
      "220.5 lb × 5",
    );
  });

  it("describe activity and goal values in the person's units", () => {
    expect(
      describeActivity(
        { kind: "run", steps: null, distance_m: 5000, duration_s: 1500 },
        METRIC_UNITS,
      ),
    ).toBe("5 km · 25 min");
    expect(
      describeActivity(
        { kind: "steps", steps: 8500, distance_m: null, duration_s: null },
        METRIC_UNITS,
      ),
    ).toBe("8,500 steps");
    expect(formatGoalValue(75_000, { category: "body_weight", unit: "g" }, METRIC_UNITS)).toBe(
      "75 kg",
    );
    expect(formatGoalValue(30, { category: "custom", unit: "pages" }, METRIC_UNITS)).toBe(
      "30 pages",
    );
    expect(share(500, 2000)).toBe(0.25);
    expect(share(3000, 2000)).toBe(1);
    expect(share(500, null)).toBeNull();
  });

  it("read and write locations", () => {
    expect(parseFitnessLocation(new URLSearchParams("view=water"))).toEqual({
      kind: "view",
      view: "water",
    });
    expect(parseFitnessLocation(new URLSearchParams("workout=w1"))).toEqual({
      kind: "workout",
      id: "w1",
    });
    expect(parseFitnessLocation(new URLSearchParams("view=nope"))).toEqual({
      kind: "view",
      view: "overview",
    });
    expect(fitnessHref({ kind: "view", view: "overview" })).toBe("/health");
    expect(fitnessHref({ kind: "goal", id: "g 1" })).toBe("/health?goal=g%201");
  });
});

describe("forms", () => {
  it("send measurements in canonical units and require one value", async () => {
    const values = { ...newMeasurementValues("2026-01-01"), weight: "180", waist: "32" };
    expect(toMeasurementRequest(values, IMPERIAL_UNITS)).toMatchObject({
      weight_g: 81_647,
      waist_mm: 813,
      chest_mm: null,
      body_fat_pct: null,
    });
    await expect(measurementSchema.validate(newMeasurementValues("2026-01-01"))).rejects.toThrow(
      "Enter at least one measurement.",
    );
  });

  it("send a typed-in food with its nutrients, or a saved food by ID", async () => {
    const typed = {
      ...newEntryValues("2026-01-01", "lunch"),
      name: "Soup",
      quantity: "1.5",
      energy: "180",
      protein: "9.5",
    };
    expect(toPortionRequest(typed, METRIC_UNITS)).toEqual({
      quantity_milli: 1500,
      food_id: null,
      name: "Soup",
      serving_unit: "serving",
      nutrients: { energy_cal: 180_000, protein_mg: 9_500, carbs_mg: 0, fat_mg: 0, fiber_mg: null },
    });
    expect(toPortionRequest({ ...typed, foodId: "f1" }, METRIC_UNITS)).toMatchObject({
      food_id: "f1",
      nutrients: null,
    });
    await expect(
      entrySchema.validate({ ...newEntryValues("2026-01-01", "lunch"), quantity: "0" }),
    ).rejects.toThrow();
  });

  it("send activity by kind", () => {
    expect(
      toActivityRequest(
        { day: "2026-01-01", kind: "sleep", steps: "", distance: "", duration: "7.5", note: "" },
        METRIC_UNITS,
      ),
    ).toMatchObject({ duration_s: 27_000, distance_m: null, steps: null });
    expect(
      toActivityRequest(
        { day: "2026-01-01", kind: "run", steps: "", distance: "3.1", duration: "30", note: "" },
        IMPERIAL_UNITS,
      ),
    ).toMatchObject({ distance_m: 4989, duration_s: 1800 });
  });

  it("convert goal values and only auto-track supported kinds", async () => {
    expect(parseGoalValue("165", "body_weight", IMPERIAL_UNITS)).toBe(74_843);
    expect(parseGoalValue("45", "running_duration", METRIC_UNITS)).toBe(2700);
    const values = {
      ...newGoalValues("2026-01-01"),
      name: "Read",
      category: "custom" as const,
      unit: "pages",
      startValue: "0",
      targetValue: "300",
      autoTrack: true,
    };
    expect(toGoalRequest(values, METRIC_UNITS)).toMatchObject({
      start_value: 0,
      target_value: 300,
      auto_track: false,
    });
    await expect(goalSchema.validate({ ...values, targetValue: "0" })).rejects.toThrow(
      "The target must differ from the starting value.",
    );
  });

  it("round-trip the profile", () => {
    const profile = {
      unit_system: "imperial" as const,
      weight_unit: "lb" as const,
      length_unit: "in" as const,
      distance_unit: "mi" as const,
      energy_unit: "kcal" as const,
      water_unit: "fl_oz" as const,
      height_mm: 1778,
      date_of_birth: null,
      targets: {
        energy_cal: 2_000_000,
        protein_mg: 150_000,
        carbs_mg: null,
        fat_mg: null,
        fiber_mg: null,
        water_ml: 2366,
        steps: 8000,
        active_s: 45 * 60,
        sleep_s: 7.5 * 3600,
      },
      water_quick_amounts_ml: [237, 473],
      hidden_sections: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    const values = toProfileFormValues(profile);
    expect(values.height).toBe("70");
    expect(values.waterTarget).toBe("80");
    expect([values.stepsTarget, values.activeTarget, values.sleepTarget]).toEqual([
      "8000",
      "45",
      "7.5",
    ]);
    expect(toProfileRequest(values)).toMatchObject({
      height_mm: 1778,
      targets: {
        energy_cal: 2_000_000,
        protein_mg: 150_000,
        water_ml: 2366,
        steps: 8000,
        active_s: 2700,
        sleep_s: 27_000,
      },
      water_quick_amounts_ml: [237, 473],
    });
  });

  it("check profile amounts against the API's limits, in the person's units", async () => {
    const metric = toProfileFormValues({
      unit_system: "metric",
      weight_unit: "kg",
      length_unit: "cm",
      distance_unit: "km",
      energy_unit: "kcal",
      water_unit: "ml",
      height_mm: null,
      date_of_birth: null,
      targets: {
        energy_cal: null,
        protein_mg: null,
        carbs_mg: null,
        fat_mg: null,
        fiber_mg: null,
        water_ml: null,
      },
      water_quick_amounts_ml: [250, 500],
      hidden_sections: [],
      updated_at: "2026-01-01T00:00:00Z",
    });
    await expect(
      profileSchema.validate({
        ...metric,
        height: "175",
        waterTarget: "3000",
        energyTarget: "2200",
      }),
    ).resolves.toBeTruthy();
    // A height in metres typed into the centimetre field.
    await expect(profileSchema.validate({ ...metric, height: "1.75" })).rejects.toThrow(
      "Enter a height from 50 cm to 272 cm, or leave it blank.",
    );
    await expect(
      profileSchema.validate({ ...metric, lengthUnit: "in", height: "5.9" }),
    ).rejects.toThrow("Enter a height from 19.7 in to 107 in, or leave it blank.");
    await expect(profileSchema.validate({ ...metric, waterTarget: "30000" })).rejects.toThrow(
      "Enter up to 20,000 ml, or leave it blank.",
    );
    expect(toProfileRequest(metric).targets).toMatchObject({
      steps: null,
      active_s: null,
      sleep_s: null,
    });
    await expect(profileSchema.validate({ ...metric, sleepTarget: "30" })).rejects.toThrow(
      "Enter 1 to 24 hours, or leave it blank.",
    );
    await expect(profileSchema.validate({ ...metric, energyTarget: "25000" })).rejects.toThrow(
      "Enter up to 20,000 kcal, or leave it blank.",
    );
    await expect(profileSchema.validate({ ...metric, quickAmounts: "250, 6000" })).rejects.toThrow(
      "List up to six amounts, separated by commas.",
    );
  });

  it("work out schedule and log times", () => {
    expect(localEnd("2026-01-01", "23:30", 90)).toBe("2026-01-02T01:00");
    expect(
      loggedTimes(
        { name: "", templateId: "", date: "2026-01-01", time: "07:00", minutes: "45" },
        "Asia/Kolkata",
      ),
    ).toEqual({ started_at: "2026-01-01T01:30:00.000Z", ended_at: "2026-01-01T02:15:00.000Z" });
  });
});

describe("saved food search and sort", () => {
  const foods = [
    { name: "Oats" },
    { name: "banana" },
    { name: "Crème fraîche" },
    { name: "Egg 10" },
    { name: "Egg 2" },
  ];

  it("match names ignoring case, accents, and outer spaces", () => {
    expect(matchesName("Crème fraîche", " CREME ")).toBe(true);
    expect(matchesName("Oats", "")).toBe(true);
    expect(matchesName("Oats", "rice")).toBe(false);
  });

  it("sort by name either way, or keep the most-used order", () => {
    expect(sortFoods(foods, "most-used").map((f) => f.name)).toEqual(foods.map((f) => f.name));
    expect(sortFoods(foods, "name-asc").map((f) => f.name)).toEqual([
      "banana",
      "Crème fraîche",
      "Egg 2",
      "Egg 10",
      "Oats",
    ]);
    expect(sortFoods(foods, "name-desc").map((f) => f.name)[0]).toBe("Oats");
  });
});
