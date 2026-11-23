"use client";

import type { CreatePersonRequest, People, Person, UpdatePersonRequest } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPerson,
  deletePerson,
  peopleOptions,
  replaceCachedPerson,
  updateCachedPeople,
  updatePerson,
} from "@/api/people";
import { reminderKeys } from "@/api/reminders";
import { queryResource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

const selectPeople = (data: People) => data.people;

/** Everyone in the workspace. */
export function usePeople(workspaceId: string) {
  const { withToken } = useAuth();
  const query = useQuery({ ...peopleOptions(withToken, workspaceId), select: selectPeople });
  useWorkspaceNotFound(query.error);
  return { people: queryResource(query, "Couldn’t load your people."), reload: query.refetch };
}

/**
 * Adding, changing, and removing people; each updates the cached list to match. Dates manage a
 * reminder, so every change refreshes the workspace's reminders too.
 */
export function usePeopleMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refreshReminders = () =>
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
  const store = (person: Person) => {
    replaceCachedPerson(queryClient, workspaceId, person);
    refreshReminders();
  };

  const add = useMutation({
    mutationFn: (body: CreatePersonRequest) =>
      withToken((token) => createPerson(token, workspaceId, body)),
    onSuccess: store,
  });

  const update = useMutation({
    mutationFn: ({ person, changes }: { person: Person; changes: UpdatePersonRequest }) =>
      withToken((token) => updatePerson(token, workspaceId, person.id, changes)),
    onSuccess: store,
  });

  const remove = useMutation({
    mutationFn: (person: Person) =>
      withToken((token) => deletePerson(token, workspaceId, person.id)),
    onSuccess: (_result, person) => {
      updateCachedPeople(queryClient, workspaceId, (people) =>
        people.filter((entry) => entry.id !== person.id),
      );
      refreshReminders();
    },
  });

  return { add, update, remove };
}
