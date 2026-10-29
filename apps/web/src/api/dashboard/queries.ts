import type { DashboardLayout, DashboardLayoutRequest } from "@orbit/contracts";
import { queryOptions } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { deleteMyDashboard, getMyDashboard, putMyDashboard } from "./requests";

export const dashboardKeys = {
  layout: () => ["me", "dashboard"] as const,
};

/** The layout saved to the user's account, or `null` when they haven't arranged it. */
export function dashboardLayoutOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: dashboardKeys.layout(),
    queryFn: ({ signal }) => withToken((token) => getMyDashboard(token, { signal })),
  });
}

/** A change to the account's layout: the whole layout is sent each time, or a reset. */
export type DashboardLayoutChange =
  { kind: "save"; widgets: DashboardLayoutRequest["widgets"] } | { kind: "reset" };

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
    return putMyDashboard(token, { widgets: change.widgets });
  });
}
