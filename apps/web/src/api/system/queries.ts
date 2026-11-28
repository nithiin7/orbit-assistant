import { queryOptions } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getSystemStatus, getUpdateStatus } from "./requests";

/** Server-wide, so not under a workspace. */
export const systemKeys = {
  status: () => ["system", "status"] as const,
  update: () => ["system", "update"] as const,
};

export function systemStatusOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: systemKeys.status(),
    queryFn: ({ signal }) => withToken((token) => getSystemStatus(token, { signal })),
  });
}

/** The update notice. The server asks GitHub at most once a day, so a long stale time is fine. */
export function updateStatusOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: systemKeys.update(),
    queryFn: ({ signal }) => withToken((token) => getUpdateStatus(token, { signal })),
    staleTime: 60 * 60 * 1000,
  });
}
