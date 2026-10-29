import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { shouldRetry } from "./query-client";

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
