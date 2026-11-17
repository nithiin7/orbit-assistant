import type { BriefingSourceRef } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { briefingContent, withOverdueTask } from "@/test/briefing";

import {
  briefingHref,
  briefingItemHrefs,
  briefingSettingsSchema,
  settingsToValues,
  valuesToSettings,
} from "./briefing";

function ref(type: BriefingSourceRef["type"], id = "r1"): BriefingSourceRef {
  return { module: "tasks", type, id, occurrence: null, key: `${type}:${id}` };
}

describe("briefing links", () => {
  it.each([
    ["task", "/tasks?task=r1"],
    ["reminder", "/reminders?reminder=r1"],
    ["event", "/calendar?view=day&date=2030-06-11"],
    ["budget", "/finance?view=budgets"],
    ["savings_goal", "/finance?view=goals"],
    ["habit", "/habits?habit=r1"],
    ["routine", "/habits?routine=r1"],
    ["workout", "/health?workout=r1"],
    ["fitness_goal", "/health?goal=r1"],
    ["document", "/documents?document=r1"],
    ["shopping_list", "/shopping"],
    ["sip", "/finance?view=investments"],
    ["deposit", "/finance?view=investments"],
  ] as const)("links a %s to its record", (type, href) => {
    expect(briefingHref(ref(type), { day: "2030-06-11" })).toBe(href);
  });

  it("links payments to their commitment's list", () => {
    const commitment = ref("commitment");
    expect(briefingHref(commitment, { day: "2030-06-11", kind: "loan" })).toBe(
      "/finance?view=loans",
    );
    expect(briefingHref(commitment, { day: "2030-06-11", kind: "bill" })).toBe(
      "/finance?view=bills",
    );
    expect(briefingHref(commitment, { day: "2030-06-11", kind: "subscription" })).toBe(
      "/finance?view=subscriptions",
    );
  });

  it("indexes every item's link by its key, for a summary's priorities", () => {
    const content = briefingContent({
      ...withOverdueTask(),
      payments: {
        items: [
          {
            ref: ref("commitment", "c1"),
            kind: "loan",
            name: "Car loan",
            counterparty: "",
            amount: 1,
            estimated: false,
            currency: "INR",
            due_date: "2030-06-11",
            status: "due",
            severity: "warning",
          },
        ],
        overdue: 0,
        due_today: 1,
        upcoming: 0,
      },
    });

    const hrefs = briefingItemHrefs(content, "2030-06-11");

    expect(hrefs.get("task:t1")).toBe("/tasks?task=t1");
    expect(hrefs.get("commitment:c1")).toBe("/finance?view=loans");
    expect(hrefs.get("event:missing")).toBeUndefined();
  });
});

describe("briefing settings", () => {
  it("round-trips settings through the form, keeping briefing order", () => {
    const values = settingsToValues({
      horizon_days: 3,
      hidden: ["health", "budgets"],
      prepare_at: "07:30:00",
    });

    expect(values.prepareAt).toBe("07:30");
    expect(values.shown).not.toContain("health");
    expect(valuesToSettings(values)).toEqual({
      horizon_days: 3,
      hidden: ["budgets", "health"],
      prepare_at: "07:30",
    });
    expect(valuesToSettings({ ...values, prepareAt: "" }).prepare_at).toBeNull();
  });

  it("rejects an empty briefing and odd look-aheads", async () => {
    await expect(
      briefingSettingsSchema.validate({ horizonDays: "7", shown: [], prepareAt: "" }),
    ).rejects.toThrow("Keep at least one module");
    await expect(
      briefingSettingsSchema.validate({ horizonDays: "15", shown: ["tasks"], prepareAt: "" }),
    ).rejects.toThrow("Choose 1 to 14 days.");
  });
});
