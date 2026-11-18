import { queryOptions } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getPushStatus } from "./requests";

export const pushKeys = {
  /** Per person, not per workspace. */
  me: () => ["me", "push"] as const,
  status: () => [...pushKeys.me(), "status"] as const,
  /** Whether this browser is subscribed, which only the browser knows. */
  device: (publicKey: string | null) => [...pushKeys.me(), "device", publicKey] as const,
};

export function pushStatusOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: pushKeys.status(),
    queryFn: ({ signal }) => withToken((token) => getPushStatus(token, { signal })),
  });
}
