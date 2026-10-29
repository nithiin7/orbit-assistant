import type { WorkspaceList } from "@orbit/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { lab, personal } from "@/test/api-mock";

import { shoppingKeys } from "../shopping/queries";
import { taskKeys } from "../tasks/queries";
import { removeCachedWorkspace, replaceCachedWorkspace, workspaceKeys } from "./queries";

function seed(): QueryClient {
  const client = new QueryClient();
  client.setQueryData<WorkspaceList>(workspaceKeys.list(), { workspaces: [personal, lab] });
  client.setQueryData(workspaceKeys.detail(lab.id), lab);
  client.setQueryData(taskKeys.list(lab.id, {}), { tasks: [], total: 0 });
  client.setQueryData(shoppingKeys.lists(lab.id), { lists: [] });
  client.setQueryData(taskKeys.list(personal.id, {}), { tasks: [], total: 0 });
  return client;
}

describe("replaceCachedWorkspace", () => {
  it("shows the new name in the list and the workspace's detail", () => {
    const client = seed();
    const renamed = { ...lab, name: "Research" };

    replaceCachedWorkspace(client, renamed);

    expect(client.getQueryData<WorkspaceList>(workspaceKeys.list())?.workspaces).toEqual([
      personal,
      renamed,
    ]);
    expect(client.getQueryData(workspaceKeys.detail(lab.id))).toEqual(renamed);
  });
});

describe("removeCachedWorkspace", () => {
  it("forgets everything cached about the workspace, and nothing about others", () => {
    const client = seed();

    removeCachedWorkspace(client, lab.id);

    expect(client.getQueryData<WorkspaceList>(workspaceKeys.list())?.workspaces).toEqual([
      personal,
    ]);
    expect(client.getQueryData(workspaceKeys.detail(lab.id))).toBeUndefined();
    expect(client.getQueryData(taskKeys.list(lab.id, {}))).toBeUndefined();
    expect(client.getQueryData(shoppingKeys.lists(lab.id))).toBeUndefined();
    expect(client.getQueryData(taskKeys.list(personal.id, {}))).toBeDefined();
  });
});
