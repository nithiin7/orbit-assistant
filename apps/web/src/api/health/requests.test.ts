import type { HealthResponse } from "@orbit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../client";
import { getDatabaseHealth, getHealth } from "./requests";

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

describe("getDatabaseHealth", () => {
  it("requests the database health endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "ok", storage_mode: "local" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDatabaseHealth()).resolves.toEqual({ status: "ok", storage_mode: "local" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/health/database",
      expect.anything(),
    );
  });
});
