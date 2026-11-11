import { describe, expect, it } from "vitest";

import { FOOD_PACKS, foodPackRequest } from "./food-packs";

describe("food packs", () => {
  it("have unique ids and food names, with sane nutrients", () => {
    expect(new Set(FOOD_PACKS.map((p) => p.id)).size).toBe(FOOD_PACKS.length);
    for (const pack of FOOD_PACKS) {
      const names = pack.foods.map((f) => f.name.toLocaleLowerCase());
      expect(new Set(names).size).toBe(names.length);
      for (const food of pack.foods) {
        expect(food.quantity).toBeGreaterThan(0);
        // Energy roughly matches the macronutrients (4/4/9 kcal per gram), within 25%.
        const fromMacros = food.protein * 4 + food.carbs * 4 + food.fat * 9;
        expect(Math.abs(fromMacros - food.kcal)).toBeLessThanOrEqual(Math.max(food.kcal * 0.25, 5));
      }
    }
  });

  it("convert to saved-food requests in canonical units", () => {
    expect(
      foodPackRequest({
        name: "Idli",
        quantity: 1.5,
        unit: "piece",
        kcal: 58,
        protein: 2,
        carbs: 12,
        fat: 0.4,
      }),
    ).toEqual({
      name: "Idli",
      serving_quantity_milli: 1500,
      serving_unit: "piece",
      nutrients: {
        energy_cal: 58_000,
        protein_mg: 2_000,
        carbs_mg: 12_000,
        fat_mg: 400,
        fiber_mg: null,
      },
    });
  });
});
