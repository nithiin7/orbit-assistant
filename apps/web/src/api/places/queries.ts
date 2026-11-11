import type { Place, Places } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getPlaceSettings, listPlaces } from "./requests";

/**
 * Cache keys for a workspace's places. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. `null` never fetches.
 */
export const placeKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "places"] as const,
  items: (workspaceId: string | null) => [...placeKeys.all(workspaceId), "items"] as const,
  settings: (workspaceId: string | null) => [...placeKeys.all(workspaceId), "settings"] as const,
};

/** Every place. Shared by the Places page and the dashboard widget. */
export function placesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: placeKeys.items(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listPlaces(token, workspaceId, { signal })),
  });
}

export function placeSettingsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: placeKeys.settings(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getPlaceSettings(token, workspaceId, { signal })),
  });
}

/** Change the cached places. */
export function updateCachedPlaces(
  queryClient: QueryClient,
  workspaceId: string,
  change: (places: Place[]) => Place[],
) {
  queryClient.setQueryData<Places>(placeKeys.items(workspaceId), (data) =>
    data ? { places: change(data.places) } : data,
  );
}

/** Put a changed or new place into the cache, keeping newest first. */
export function replaceCachedPlace(queryClient: QueryClient, workspaceId: string, place: Place) {
  updateCachedPlaces(queryClient, workspaceId, (places) =>
    [...places.filter((entry) => entry.id !== place.id), place].sort(
      (a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
    ),
  );
}
