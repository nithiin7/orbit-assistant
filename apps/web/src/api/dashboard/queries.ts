import type { DashboardLayout, DashboardLayoutRequest } from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { deleteMyDashboard, getMyDashboard, getTodayOverview, putMyDashboard } from "./requests";

export const dashboardKeys = {
  layout: () => ["me", "dashboard"] as const,
  /** The workspace's daily overview. It summarizes other modules, so it is refreshed (not
   * edited) after their changes. */
  today: (workspaceId: string | null, timezone: string) =>
    ["workspaces", workspaceId, "dashboard", "today", timezone] as const,
  todayAll: (workspaceId: string | null) => ["workspaces", workspaceId, "dashboard"] as const,
};

/** The layout saved to the user's account, or `null` when they haven't arranged it. */
export function dashboardLayoutOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: dashboardKeys.layout(),
    queryFn: ({ signal }) => withToken((token) => getMyDashboard(token, { signal })),
  });
}

/**
 * Today across the workspace, in `timezone`. The overview, the attention list, and the agenda
 * summary share this one request. It refreshes every few minutes while shown, so "today" and
 * "overdue" stay current past midnight without a reload.
 */
export function todayOverviewOptions(
  withToken: WithToken,
  workspaceId: string | null,
  timezone: string,
) {
  return queryOptions({
    queryKey: dashboardKeys.today(workspaceId, timezone),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getTodayOverview(token, workspaceId, { timezone }, { signal })),
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
}

/** A change to the account's layout: the whole layout is sent each time, or a reset. */
export type DashboardLayoutChange =
  { kind: "save"; layout: DashboardLayoutRequest } | { kind: "reset" };

/** Apply a change to the account. Resolves to what the account now holds. */
export function sendDashboardLayout(
  withToken: WithToken,
  change: DashboardLayoutChange,
): Promise<DashboardLayout | null> {
  return withToken(async (token) => {
    if (change.kind === "reset") {
      await deleteMyDashboard(token);
      return null;
    }
    return putMyDashboard(token, change.layout);
  });
}
