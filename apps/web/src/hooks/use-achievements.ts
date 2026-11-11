"use client";

import type { AchievementProfile, EquippedRewards, RewardSlot } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ACHIEVEMENT_MUTATION_KEY,
  achievementKeys,
  achievementsOptions,
  buyReward,
  checkMyAchievements,
  equipReward,
  unequipReward,
} from "@/api/achievements";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useAuth } from "@/providers/auth";

/** Achievements, XP, and the store, as a view's loading, error, or success state. */
export function useAchievements(): { state: Resource<AchievementProfile>; retry: () => void } {
  const { withToken } = useAuth();
  const query = useQuery(achievementsOptions(withToken));
  return {
    state: queryResource(query, "Couldn’t load your achievements."),
    retry: () => void query.refetch(),
  };
}

/** What the user wears, from whatever the cache holds; never fetches on its own. The app's
 * achievement check fills the cache once signed in, so avatars across the app pick it up. */
export function useEquippedRewards(): EquippedRewards | null {
  const { withToken } = useAuth();
  const { data } = useQuery({ ...achievementsOptions(withToken), enabled: false });
  return data?.equipped ?? null;
}

type StoreAction =
  | { kind: "buy"; itemKey: string }
  | { kind: "equip"; itemKey: string }
  | { kind: "unequip"; slot: RewardSlot };

/** Buy, wear, and take off store items. Each returns the whole profile, which replaces the
 * cached one. */
export function useRewardStore() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ACHIEVEMENT_MUTATION_KEY,
    mutationFn: (action: StoreAction) =>
      withToken((token) => {
        switch (action.kind) {
          case "buy":
            return buyReward(token, action.itemKey);
          case "equip":
            return equipReward(token, action.itemKey);
          case "unequip":
            return unequipReward(token, action.slot);
        }
      }),
    onSuccess: (profile) => queryClient.setQueryData(achievementKeys.all(), profile),
  });
}

/** Unlock whatever the user's data now reaches. */
export function useAchievementCheck() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ACHIEVEMENT_MUTATION_KEY,
    mutationFn: () => withToken((token) => checkMyAchievements(token)),
    onSuccess: (profile) => queryClient.setQueryData(achievementKeys.all(), profile),
  });
}
