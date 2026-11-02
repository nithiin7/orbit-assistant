import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { createQueryClient, isSummaryQueryKey, shouldRetry } from "./query-client";

describe("shouldRetry", () => {
  it("retries network failures and server errors a limited number of times", () => {
    expect(shouldRetry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, "/x"))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, "/x"))).toBe(false);
  });

  it("never retries client errors", () => {
    expect(shouldRetry(0, new ApiError(404, "/x"))).toBe(false);
    expect(shouldRetry(0, new ApiError(422, "/x"))).toBe(false);
  });
});

describe("summary queries", () => {
  it("are the workspace's dashboard overview and search", () => {
    expect(isSummaryQueryKey(["workspaces", "w1", "dashboard", "today", "UTC"])).toBe(true);
    expect(isSummaryQueryKey(["workspaces", "w1", "search", { q: "rent" }])).toBe(true);
    expect(isSummaryQueryKey(["workspaces", "w1", "tasks", "list"])).toBe(false);
    expect(isSummaryQueryKey(["me", "dashboard"])).toBe(false);
  });

  it("go stale after any successful change", async () => {
    const client = createQueryClient({ retry: false });
    client.setQueryData(["workspaces", "w1", "dashboard", "today", "UTC"], { ok: true });
    client.setQueryData(["workspaces", "w1", "tasks", "list"], []);

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.resolve(1) })
      .execute(undefined);

    expect(
      client.getQueryState(["workspaces", "w1", "dashboard", "today", "UTC"])?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(["workspaces", "w1", "tasks", "list"])?.isInvalidated).toBe(false);
  });
});
