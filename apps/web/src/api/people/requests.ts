import type {
  CreatePersonLedgerEntryRequest,
  CreatePersonRequest,
  People,
  Person,
  PersonLedger,
  PersonLedgerEntry,
  UpdatePersonLedgerEntryRequest,
  UpdatePersonRequest,
} from "@orbit/contracts";

import { request, type Signal, workspacePath } from "../client";

function peoplePath(workspaceId: string): string {
  return workspacePath(workspaceId, "/people");
}

function personPath(workspaceId: string, personId: string): string {
  return `${peoplePath(workspaceId)}/${encodeURIComponent(personId)}`;
}

/** Everyone, by name. */
export function listPeople(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<People> {
  return request<People>(peoplePath(workspaceId), { token, signal });
}

export function createPerson(
  token: string,
  workspaceId: string,
  body: CreatePersonRequest,
): Promise<Person> {
  return request<Person>(peoplePath(workspaceId), { method: "POST", body, token });
}

export function updatePerson(
  token: string,
  workspaceId: string,
  personId: string,
  body: UpdatePersonRequest,
): Promise<Person> {
  return request<Person>(personPath(workspaceId, personId), { method: "PATCH", body, token });
}

export function deletePerson(token: string, workspaceId: string, personId: string) {
  return request<void>(personPath(workspaceId, personId), { method: "DELETE", token });
}

/** Every ledger entry in the workspace, newest first, with each person's balances. */
export function getPeopleLedger(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<PersonLedger> {
  return request<PersonLedger>(`${peoplePath(workspaceId)}/ledger`, { token, signal });
}

function entriesPath(workspaceId: string, personId: string): string {
  return `${personPath(workspaceId, personId)}/ledger`;
}

export function createLedgerEntry(
  token: string,
  workspaceId: string,
  personId: string,
  body: CreatePersonLedgerEntryRequest,
): Promise<PersonLedgerEntry> {
  return request<PersonLedgerEntry>(entriesPath(workspaceId, personId), {
    method: "POST",
    body,
    token,
  });
}

export function updateLedgerEntry(
  token: string,
  workspaceId: string,
  entry: PersonLedgerEntry,
  body: UpdatePersonLedgerEntryRequest,
): Promise<PersonLedgerEntry> {
  return request<PersonLedgerEntry>(
    `${entriesPath(workspaceId, entry.person_id)}/${encodeURIComponent(entry.id)}`,
    { method: "PATCH", body, token },
  );
}

export function deleteLedgerEntry(token: string, workspaceId: string, entry: PersonLedgerEntry) {
  return request<void>(
    `${entriesPath(workspaceId, entry.person_id)}/${encodeURIComponent(entry.id)}`,
    { method: "DELETE", token },
  );
}
