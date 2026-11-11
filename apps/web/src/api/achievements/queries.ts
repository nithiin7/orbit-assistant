import { queryOptions } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getMyAchievements } from "./requests";

/** Per person, like the profile photo; the cache is cleared when the user changes. */
export const achievementKeys = {
  all: () => ["me", "achievements"] as const,
};

/** Marks mutations that change achievements themselves, so they don't trigger a check. */
export const ACHIEVEMENT_MUTATION_KEY = ["me", "achievements", "mutation"] as const;

export function achievementsOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: achievementKeys.all(),
    queryFn: ({ signal }) => withToken((token) => getMyAchievements(token, { signal })),
  });
}
