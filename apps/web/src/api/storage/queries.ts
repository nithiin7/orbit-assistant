import { queryOptions } from "@tanstack/react-query";

import { fetchStorageStatus } from "@/lib/storage";

import type { WithToken } from "../client";
import { getStorageLocation } from "./requests";

export const storageKeys = {
  /** Which database the API uses. Public: shown on the sign-in pages too. */
  status: () => ["storage", "status"] as const,
  location: () => ["storage", "location"] as const,
};

/** The API's storage mode. Never fails: an unreachable API is a status of its own. */
export function storageStatusOptions() {
  return queryOptions({
    queryKey: storageKeys.status(),
    queryFn: ({ signal }) => fetchStorageStatus(signal),
  });
}

/** Where the database file lives, when the API shares it (local mode only). */
export function storageLocationOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: storageKeys.location(),
    queryFn: ({ signal }) => withToken((token) => getStorageLocation(token, { signal })),
  });
}
