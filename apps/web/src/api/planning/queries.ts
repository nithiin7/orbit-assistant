import type { PlanQuery } from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { financeKeys } from "../finance";
import { getPlan } from "./requests";

/** Cache keys for monthly plans, under the finance keys: a plan's actuals come from the ledger. */
export const planKeys = {
  all: (workspaceId: string | null) => [...financeKeys.all(workspaceId), "plan"] as const,
  month: (workspaceId: string | null, query: PlanQuery) =>
    [...planKeys.all(workspaceId), query] as const,
};

export function planOptions(withToken: WithToken, workspaceId: string | null, query: PlanQuery) {
  return queryOptions({
    queryKey: planKeys.month(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getPlan(token, workspaceId, query, { signal })),
  });
}
