import type { AchievementProfile, RewardSlot } from "@orbit/contracts";

import { request, type Signal } from "../client";

const BASE = "/api/v1/me/achievements";

/** Achievements, XP, and the store. Read-only: nothing unlocks until `checkMyAchievements`. */
export function getMyAchievements(
  token: string,
  { signal }: Signal = {},
): Promise<AchievementProfile> {
  return request<AchievementProfile>(BASE, { token, signal });
}

/** Unlock whatever the user's data now reaches; `new_unlocks` lists what just unlocked. */
export function checkMyAchievements(token: string): Promise<AchievementProfile> {
  return request<AchievementProfile>(`${BASE}/check`, { method: "POST", token });
}

export function buyReward(token: string, itemKey: string): Promise<AchievementProfile> {
  return request<AchievementProfile>(`${BASE}/store/purchases`, {
    method: "POST",
    body: { item_key: itemKey },
    token,
  });
}

export function equipReward(token: string, itemKey: string): Promise<AchievementProfile> {
  return request<AchievementProfile>(`${BASE}/store/equipped`, {
    method: "PUT",
    body: { item_key: itemKey },
    token,
  });
}

export function unequipReward(token: string, slot: RewardSlot): Promise<AchievementProfile> {
  return request<AchievementProfile>(`${BASE}/store/unequip`, {
    method: "POST",
    body: { slot },
    token,
  });
}
