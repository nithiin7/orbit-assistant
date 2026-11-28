import { queryOptions } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getAppLock } from "./requests";

export const appLockKeys = {
  /** Per person and session, not per workspace. Kept when the app locks and clears its cache. */
  me: () => ["me", "app-lock"] as const,
  status: () => [...appLockKeys.me(), "status"] as const,
};

export function appLockStatusOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: appLockKeys.status(),
    queryFn: ({ signal }) => withToken((token) => getAppLock(token, { signal })),
  });
}
