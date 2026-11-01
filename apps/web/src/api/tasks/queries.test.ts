import type { Task, TaskList } from "@orbit/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { removeCachedTask, replaceCachedTask, taskKeys } from "./queries";

function task(id: string, workspaceId: string, title = id): Task {
  return {
    id,
    workspace_id: workspaceId,
    title,
    description: "",
    status: "open",
    priority: "none",
    due_date: null,
    completed_at: null,
    scheduled_start: null,
    scheduled_end: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
  };
}

const open = taskKeys.list("w1", { status: "open" });
const all = taskKeys.list("w1", {});
const other = taskKeys.list("w2", {});

function seed(): QueryClient {
  const client = new QueryClient();
  client.setQueryData<TaskList>(open, { tasks: [task("a", "w1"), task("b", "w1")], total: 2 });
  client.setQueryData<TaskList>(all, { tasks: [task("a", "w1")], total: 1 });
  client.setQueryData<TaskList>(other, { tasks: [task("a", "w2")], total: 1 });
  return client;
}

describe("taskKeys", () => {
  it("scope every key to its workspace", () => {
    expect(taskKeys.list("w1", { q: "rent" })).toEqual([
      "workspaces",
      "w1",
      "tasks",
      "list",
      { q: "rent" },
    ]);
    expect(taskKeys.summary("w1", {}).slice(0, 3)).toEqual(taskKeys.all("w1"));
  });
});

describe("replaceCachedTask", () => {
  it("updates the task in every cached list of its workspace only", () => {
    const client = seed();

    replaceCachedTask(client, "w1", task("a", "w1", "Renamed"));

    expect(client.getQueryData<TaskList>(open)?.tasks.map((item) => item.title)).toEqual([
      "Renamed",
      "b",
    ]);
    expect(client.getQueryData<TaskList>(all)?.tasks[0]?.title).toBe("Renamed");
    expect(client.getQueryData<TaskList>(other)?.tasks[0]?.title).toBe("a");
  });
});

describe("removeCachedTask", () => {
  it("drops the task and its count from the lists that contain it", () => {
    const client = seed();

    removeCachedTask(client, "w1", "b");

    expect(client.getQueryData<TaskList>(open)).toEqual({ tasks: [task("a", "w1")], total: 1 });
    expect(client.getQueryData<TaskList>(all)).toEqual({ tasks: [task("a", "w1")], total: 1 });
    expect(client.getQueryData<TaskList>(other)?.total).toBe(1);
  });
});
