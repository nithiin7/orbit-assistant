import type { Achievement, AchievementProfile, RewardItem } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  filterAchievements,
  levelPercent,
  nextUp,
  parseProfileView,
  profileHref,
  recentUnlocks,
  rewardState,
  unlockCheer,
} from "./achievements";

function achievement(overrides: Partial<Achievement> & Pick<Achievement, "key">): Achievement {
  return {
    title: overrides.key,
    description: "",
    area: "tasks",
    tier: "easy",
    xp: 15,
    current: 0,
    target: 10,
    secret: false,
    unlocked_at: null,
    earned_xp: null,
    ...overrides,
  };
}

function item(overrides: Partial<RewardItem> & Pick<RewardItem, "key">): RewardItem {
  return {
    slot: "frame",
    name: overrides.key,
    description: "",
    cost: 100,
    min_level: 1,
    owned: false,
    equipped: false,
    ...overrides,
  };
}

function profile(overrides: Partial<AchievementProfile> = {}): AchievementProfile {
  return {
    earned_xp: 150,
    spent_xp: 0,
    balance: 150,
    level: { level: 2, floor_xp: 100, next_xp: 300 },
    achievements: [],
    store: [],
    equipped: { frame: null, banner: null, title: null, confetti: null },
    new_unlocks: [],
    ...overrides,
  };
}

describe("profile views", () => {
  it("reads the view from the URL, defaulting to the overview", () => {
    expect(parseProfileView(new URLSearchParams("view=store"))).toBe("store");
    expect(parseProfileView(new URLSearchParams("view=nope"))).toBe("overview");
    expect(profileHref()).toBe("/profile");
    expect(profileHref("collection")).toBe("/profile?view=collection");
  });
});

describe("progress", () => {
  const all = [
    achievement({ key: "far", current: 1 }),
    achievement({ key: "close", current: 9 }),
    achievement({ key: "secret", current: 9, secret: true }),
    achievement({ key: "done", current: 10, unlocked_at: "2026-11-02T00:00:00Z" }),
    achievement({ key: "older", current: 10, unlocked_at: "2026-11-01T00:00:00Z" }),
  ];

  it("puts the closest locked, visible achievements next", () => {
    expect(nextUp(all).map((a) => a.key)).toEqual(["close", "far"]);
  });

  it("lists unlocks newest first", () => {
    expect(recentUnlocks(all).map((a) => a.key)).toEqual(["done", "older"]);
  });

  it("filters by tier and status", () => {
    const mixed = [...all, achievement({ key: "hard", tier: "hard" })];
    expect(filterAchievements(mixed, { tier: "hard", status: "all" }).map((a) => a.key)).toEqual([
      "hard",
    ]);
    expect(filterAchievements(mixed, { tier: "all", status: "unlocked" })).toHaveLength(2);
  });

  it("measures the way through the current level", () => {
    expect(levelPercent(profile())).toBe(25);
  });
});

describe("unlockCheer", () => {
  it("is null when nothing unlocked", () => {
    expect(unlockCheer(profile())).toBeNull();
  });

  it("names a single unlock and sums the XP of several", () => {
    const one = profile({
      achievements: [achievement({ key: "a", title: "First step", earned_xp: 15 })],
      new_unlocks: ["a"],
    });
    expect(unlockCheer(one)).toMatchObject({ title: "Achievement unlocked: First step", xp: 15 });

    const many = profile({
      achievements: [
        achievement({ key: "a", title: "First step", earned_xp: 15 }),
        achievement({ key: "b", tier: "hard", earned_xp: 300 }),
      ],
      new_unlocks: ["a", "b"],
    });
    expect(unlockCheer(many)).toMatchObject({
      title: "2 achievements unlocked",
      xp: 315,
      big: true,
    });
  });
});

describe("rewardState", () => {
  it("follows ownership, then level, then balance", () => {
    const p = profile();
    expect(rewardState(item({ key: "a", equipped: true, owned: true }), p)).toBe("equipped");
    expect(rewardState(item({ key: "b", owned: true }), p)).toBe("owned");
    expect(rewardState(item({ key: "c", min_level: 3 }), p)).toBe("locked");
    expect(rewardState(item({ key: "d", cost: 200 }), p)).toBe("short");
    expect(rewardState(item({ key: "e", cost: 150 }), p)).toBe("available");
  });
});
