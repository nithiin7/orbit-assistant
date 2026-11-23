import type { CreatePersonRequest, People, Person, UpdatePersonRequest } from "@orbit/contracts";

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
