import { publicEnv } from "@/lib/env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    /** The API's `detail` message, when it sent one. Written for users; safe to display. */
    readonly detail?: string,
  ) {
    super(`Request to ${path} failed with status ${status}.`);
    this.name = "ApiError";
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-encoded, except a `Blob`, which is sent as-is with its own content type. */
  body?: unknown;
  /** Session or access token, sent as `Authorization: Bearer`. */
  token?: string;
  signal?: AbortSignal;
};

export type Signal = { signal?: AbortSignal };

/** Send a request to the Orbit API, throwing `ApiError` for any non-2xx response. */
export async function send(path: string, { method, body, token, signal }: RequestOptions = {}) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body instanceof Blob) headers["Content-Type"] = body.type;
  else if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${publicEnv.apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined || body instanceof Blob ? body : JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, path, await readDetail(response));
  return response;
}

/** Call the Orbit API. Response types come from the shared API contract. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function readDetail(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "detail" in body) {
      return typeof body.detail === "string" ? body.detail : undefined;
    }
  } catch {
    // Not JSON (for example a proxy error page); the status code is all there is.
  }
  return undefined;
}

type QueryValue = string | number | readonly string[] | null | undefined;

/** `?a=1&b=x&b=y` from defined values; arrays repeat their key. */
export function toQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number") search.append(key, String(value));
    else for (const item of value) search.append(key, item);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** `/api/v1/workspaces/{id}` followed by `suffix`, with the ID encoded. */
export function workspacePath(workspaceId: string, suffix = ""): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}${suffix}`;
}

/** A message for a failed request, suitable for showing to the user. */
export function describeApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.detail) return error.detail;
    if (error.status === 503) return "Orbit’s database is unavailable. Try again shortly.";
    return fallback;
  }
  return "Can’t reach the Orbit API. Check that it’s running, then try again.";
}
