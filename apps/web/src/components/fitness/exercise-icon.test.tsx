import { describe, expect, it } from "vitest";

import { exerciseIcon } from "./exercise-icon";

describe("exerciseIcon", () => {
  it.each([
    ["Running", "cardio", "none", "footprints"],
    ["Stationary bike", "cardio", "machine", "bike"],
    ["Swimming", "cardio", "none", "waves"],
    ["Rowing machine", "cardio", "machine", "rowing"],
    ["Hamstring stretch", "flexibility", "none", "flower"],
    ["Dumbbell curl", "strength", "dumbbell", "biceps"],
    ["Leg curl", "strength", "machine", "weight"],
    ["Plank", "bodyweight", "bodyweight", "target"],
    ["Barbell row", "strength", "barbell", "dumbbell"],
    ["Seated cable row", "strength", "cable", "weight"],
    ["Pull-up", "bodyweight", "bodyweight", "person"],
    ["Elliptical", "cardio", "machine", "activity"],
    ["Mystery move", "other", "other", "activity"],
  ] as const)("pictures %s", (name, category, equipment, icon) => {
    expect(exerciseIcon({ name, category, equipment })).toBe(icon);
  });
});
