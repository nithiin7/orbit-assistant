import type { HealthResponse } from "@orbit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createWorkspace,
  describeApiError,
  getDatabaseHealth,
  getHealth,
  getMe,
  localSignOut,
} from "./api";

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

describe("authenticated requests", () => {
  it("send the token as a bearer credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getMe("token-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/me",
      expect.objectContaining({
        headers: { Accept: "application/json", Authorization: "Bearer token-123" },
      }),
    );
  });

  it("send JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "w1" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await createWorkspace("token-123", { name: "Lab" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/workspaces",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Lab" }),
        headers: expect.objectContaining({ "Content-Type": "application/json" }) as unknown,
      }),
    );
  });

  it("accept empty 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(localSignOut("token-123")).resolves.toBeUndefined();
  });
});

describe("ApiError", () => {
  it("carries the API's detail message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ detail: "Workspace not found." }, { status: 404 })),
    );

    const error: unknown = await getMe("t").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, detail: "Workspace not found." });
  });

  it("ignores structured validation details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ detail: [{ msg: "bad" }] }, { status: 422 })),
    );

    await expect(getMe("t")).rejects.toMatchObject({ status: 422, detail: undefined });
  });
});

describe("describeApiError", () => {
  it("prefers the API's message, then status-based and network messages", () => {
    expect(describeApiError(new ApiError(409, "/x", "Taken."), "Fallback")).toBe("Taken.");
    expect(describeApiError(new ApiError(503, "/x"), "Fallback")).toMatch(/database/);
    expect(describeApiError(new ApiError(500, "/x"), "Fallback")).toBe("Fallback");
    expect(describeApiError(new TypeError("Failed to fetch"), "Fallback")).toMatch(
      /Can’t reach the Orbit API/,
    );
  });
});
