import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { financeKeys } from "../finance";
import { listContributions, listGoals } from "./requests";

/**
 * Cache keys for a workspace's savings goals, under the finance keys: a goal's linked account
 * balance and its transfers come from the ledger, so any finance change refetches them.
 */
export const goalKeys = {
  all: (workspaceId: string | null) => [...financeKeys.all(workspaceId), "goals"] as const,
  list: (workspaceId: string | null, today: string) =>
    [...goalKeys.all(workspaceId), "list", today] as const,
  contributions: (workspaceId: string | null, goalId: string) =>
    [...goalKeys.all(workspaceId), "contributions", goalId] as const,
};

export function goalsOptions(withToken: WithToken, workspaceId: string | null, today: string) {
  return queryOptions({
    queryKey: goalKeys.list(workspaceId, today),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listGoals(token, workspaceId, today, { signal })),
  });
}

export function contributionsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  goalId: string,
) {
  return queryOptions({
    queryKey: goalKeys.contributions(workspaceId, goalId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listContributions(token, workspaceId, goalId, { signal })),
  });
}
