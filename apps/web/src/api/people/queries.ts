import type { People, Person } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { listPeople } from "./requests";

/**
 * Cache keys for a workspace's people. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. `null` never fetches.
 */
export const peopleKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "people"] as const,
  list: (workspaceId: string | null) => [...peopleKeys.all(workspaceId), "list"] as const,
};

/** Everyone. Shared by the People page and the dashboard widget. */
export function peopleOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: peopleKeys.list(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listPeople(token, workspaceId, { signal })),
  });
}

/** Change the cached people. */
export function updateCachedPeople(
  queryClient: QueryClient,
  workspaceId: string,
  change: (people: Person[]) => Person[],
) {
  queryClient.setQueryData<People>(peopleKeys.list(workspaceId), (data) =>
    data ? { people: change(data.people) } : data,
  );
}

/** Put a changed or new person into the cache, keeping everyone in name order. */
export function replaceCachedPerson(queryClient: QueryClient, workspaceId: string, person: Person) {
  updateCachedPeople(queryClient, workspaceId, (people) =>
    [...people.filter((entry) => entry.id !== person.id), person].sort(
      (a, b) =>
        a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) ||
        a.id.localeCompare(b.id),
    ),
  );
}
