import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, describeApiError, request, toQueryString } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("sends the token as a bearer credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await request("/api/v1/me", { token: "token-123" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/me",
      expect.objectContaining({
        headers: { Accept: "application/json", Authorization: "Bearer token-123" },
      }),
    );
  });

  it("sends JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "w1" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await request("/api/v1/workspaces", { method: "POST", body: { name: "Lab" }, token: "t" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/workspaces",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Lab" }),
        headers: expect.objectContaining({ "Content-Type": "application/json" }) as unknown,
      }),
    );
  });

  it("accepts empty 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(request("/api/v1/auth/local/sign-out", { method: "POST" })).resolves.toBe(
      undefined,
    );
  });
});

describe("ApiError", () => {
  it("carries the API's detail message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ detail: "Workspace not found." }, { status: 404 })),
    );

    const error: unknown = await request("/api/v1/me").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, detail: "Workspace not found." });
  });

  it("ignores structured validation details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ detail: [{ msg: "bad" }] }, { status: 422 })),
    );

    await expect(request("/api/v1/me")).rejects.toMatchObject({ status: 422, detail: undefined });
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

describe("toQueryString", () => {
  it("repeats arrays, writes booleans, and skips missing values", () => {
    expect(
      toQueryString({ kind: ["loan", "bill"], include_overdue: false, limit: 5, q: undefined }),
    ).toBe("?kind=loan&kind=bill&include_overdue=false&limit=5");
    expect(toQueryString({ q: null })).toBe("");
  });
});
