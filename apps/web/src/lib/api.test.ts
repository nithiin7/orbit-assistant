import type { HealthResponse } from "@orbit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getHealth } from "./api";

const health: HealthResponse = { status: "ok", service: "orbit-api", version: "0.1.0" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHealth", () => {
  it("requests the health endpoint and returns the typed payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(health));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual(health);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/health",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("throws an ApiError for unsuccessful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(getHealth()).rejects.toThrow(ApiError);
  });
});
