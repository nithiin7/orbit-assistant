import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getBriefingSettings, getTodayBriefing } from "./requests";

export const briefingKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "briefings"] as const,
  today: (workspaceId: string | null, timezone: string) =>
    ["workspaces", workspaceId, "briefings", "today", timezone] as const,
  settings: (workspaceId: string | null) =>
    ["workspaces", workspaceId, "briefings", "settings"] as const,
};

/**
 * Today's briefing in `timezone`. It is a stored snapshot that changes only when regenerated,
 * so it isn't refetched on a timer. `enabled: false` (AI off) never asks for it, so no briefing
 * is prepared for someone who won't see its summary.
 */
export function todayBriefingOptions(
  withToken: WithToken,
  workspaceId: string | null,
  timezone: string,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: briefingKeys.today(workspaceId, timezone),
    queryFn:
      workspaceId === null || !enabled
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getTodayBriefing(token, workspaceId, { timezone }, { signal })),
    staleTime: 5 * 60_000,
  });
}

export function briefingSettingsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: briefingKeys.settings(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getBriefingSettings(token, workspaceId, { signal })),
  });
}
