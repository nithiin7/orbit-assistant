import type { UserProfile, Workspace } from "@orbit/contracts";
import { vi } from "vitest";

export type MockRequest = {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  signal: AbortSignal | undefined;
};

type Handler = (request: MockRequest) => Response | Promise<Response>;

/** Respond with JSON. Each call builds a fresh Response, since bodies can be read only once. */
export const json =
  (body: unknown, status = 200): Handler =>
  () =>
    Response.json(body, { status });

export const status =
  (code: number, detail?: string): Handler =>
  () =>
    detail === undefined
      ? new Response(null, { status: code })
      : Response.json({ detail }, { status: code });

/**
 * Replace `fetch` with a router over Orbit API paths, keyed as "METHOD /api/v1/...".
 * Unmatched requests fail the test loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init?.method ?? "GET";
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new Error(`Unexpected API request: ${method} ${url.pathname}`);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return handler({
      method,
      path: url.pathname,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal ?? undefined,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const ada: UserProfile = {
  id: "8f8e0f7e-1111-4c2b-9e57-000000000001",
  email: "ada@example.com",
  display_name: "Ada",
  auth_provider: "local",
  timezone: null,
  created_at: "2026-10-01T09:00:00Z",
};

export function workspace(overrides: Partial<Workspace> & Pick<Workspace, "id" | "name">) {
  return {
    is_personal: false,
    role: "owner",
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  } satisfies Workspace;
}

export const personal = workspace({
  id: "0d1c0ffe-2222-4c2b-9e57-000000000001",
  name: "Personal",
  is_personal: true,
});

export const lab = workspace({ id: "0d1c0ffe-2222-4c2b-9e57-000000000002", name: "Lab" });
