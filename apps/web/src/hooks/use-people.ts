"use client";

import type {
  CreatePersonLedgerEntryRequest,
  CreatePersonRequest,
  People,
  Person,
  PersonLedgerEntry,
  UpdatePersonLedgerEntryRequest,
  UpdatePersonRequest,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { financeKeys } from "@/api/finance";
import {
  createLedgerEntry,
  createPerson,
  deleteLedgerEntry,
  deletePerson,
  peopleKeys,
  peopleLedgerOptions,
  peopleOptions,
  replaceCachedPerson,
  updateCachedPeople,
  updateLedgerEntry,
  updatePerson,
} from "@/api/people";
import { reminderKeys } from "@/api/reminders";
import { queryResource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { splitsByTransaction } from "@/lib/people";
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
      // Their ledger entries go with them.
      void queryClient.invalidateQueries({ queryKey: peopleKeys.ledger(workspaceId) });
    },
  });

  return { add, update, remove };
}

/** Money between you and everyone: entries newest first, and each person's balances. */
export function usePeopleLedger(workspaceId: string) {
  const { withToken } = useAuth();
  const query = useQuery(peopleLedgerOptions(withToken, workspaceId));
  return { ledger: queryResource(query, "Couldn’t load money owed."), reload: query.refetch };
}

/**
 * Recording, correcting, and deleting money owed. A repayment can record a Finance transaction
 * and a share links to one, so every change refreshes Finance too.
 */
export function useLedgerMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: peopleKeys.ledger(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: financeKeys.all(workspaceId) });
  };

  const add = useMutation({
    mutationFn: ({ personId, body }: { personId: string; body: CreatePersonLedgerEntryRequest }) =>
      withToken((token) => createLedgerEntry(token, workspaceId, personId, body)),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({
      entry,
      changes,
    }: {
      entry: PersonLedgerEntry;
      changes: UpdatePersonLedgerEntryRequest;
    }) => withToken((token) => updateLedgerEntry(token, workspaceId, entry, changes)),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (entry: PersonLedgerEntry) =>
      withToken((token) => deleteLedgerEntry(token, workspaceId, entry)),
    onSuccess: refresh,
  });
  return { add, update, remove };
}

/** The shares already split from one expense; fetched only while `transactionId` is set. */
export function useTransactionSplits(workspaceId: string, transactionId: string | null) {
  const { withToken } = useAuth();
  const query = useQuery({
    ...peopleLedgerOptions(withToken, workspaceId),
    enabled: transactionId !== null,
  });
  return query.data && transactionId
    ? (splitsByTransaction(query.data).get(transactionId) ?? [])
    : [];
}
