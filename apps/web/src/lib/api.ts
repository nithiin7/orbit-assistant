import type {
  AuthConfig,
  CreateWorkspaceRequest,
  DatabaseHealthResponse,
  HealthResponse,
  LocalSessionResponse,
  LocalSignInRequest,
  LocalSignUpRequest,
  StorageLocation,
  UpdateProfileRequest,
  UpdateWorkspaceRequest,
  UserProfile,
  Workspace,
  WorkspaceList,
} from "@orbit/contracts";

import { publicEnv } from "./env";

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

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-encoded, except a `Blob`, which is sent as-is with its own content type. */
  body?: unknown;
  /** Session or access token, sent as `Authorization: Bearer`. */
  token?: string;
  signal?: AbortSignal;
};

/** Send a request to the Orbit API, throwing `ApiError` for any non-2xx response. */
async function send(path: string, { method, body, token, signal }: RequestOptions = {}) {
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
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

type Signal = { signal?: AbortSignal };

export function getHealth({ signal }: Signal = {}): Promise<HealthResponse> {
  return request<HealthResponse>("/api/v1/health", { signal });
}

/** Reports which storage mode the API uses. Responds 503 when the database is unreachable. */
export function getDatabaseHealth({ signal }: Signal = {}): Promise<DatabaseHealthResponse> {
  return request<DatabaseHealthResponse>("/api/v1/health/database", { signal });
}

/** How to sign in: local accounts or Supabase Auth, decided by the API's storage mode. */
export function getAuthConfig({ signal }: Signal = {}): Promise<AuthConfig> {
  return request<AuthConfig>("/api/v1/auth/config", { signal });
}

export function localSignUp(body: LocalSignUpRequest): Promise<LocalSessionResponse> {
  return request<LocalSessionResponse>("/api/v1/auth/local/sign-up", { method: "POST", body });
}

export function localSignIn(body: LocalSignInRequest): Promise<LocalSessionResponse> {
  return request<LocalSessionResponse>("/api/v1/auth/local/sign-in", { method: "POST", body });
}

export function localSignOut(token: string): Promise<void> {
  return request<void>("/api/v1/auth/local/sign-out", { method: "POST", token });
}

export function getMe(token: string, { signal }: Signal = {}): Promise<UserProfile> {
  return request<UserProfile>("/api/v1/me", { token, signal });
}

export function updateMe(token: string, body: UpdateProfileRequest): Promise<UserProfile> {
  return request<UserProfile>("/api/v1/me", { method: "PATCH", body, token });
}

/** The signed-in user's profile photo, or `null` when none is set. */
export async function getMyAvatar(token: string, { signal }: Signal = {}): Promise<Blob | null> {
  const response = await send("/api/v1/me/avatar", { token, signal });
  return response.status === 204 ? null : response.blob();
}

export function putMyAvatar(token: string, image: Blob): Promise<void> {
  return request<void>("/api/v1/me/avatar", { method: "PUT", body: image, token });
}

export function deleteMyAvatar(token: string): Promise<void> {
  return request<void>("/api/v1/me/avatar", { method: "DELETE", token });
}

export function listWorkspaces(token: string, { signal }: Signal = {}): Promise<WorkspaceList> {
  return request<WorkspaceList>("/api/v1/workspaces", { token, signal });
}

export function createWorkspace(token: string, body: CreateWorkspaceRequest): Promise<Workspace> {
  return request<Workspace>("/api/v1/workspaces", { method: "POST", body, token });
}

export function getWorkspace(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<Workspace> {
  return request<Workspace>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, {
    token,
    signal,
  });
}

export function renameWorkspace(
  token: string,
  workspaceId: string,
  body: UpdateWorkspaceRequest,
): Promise<Workspace> {
  return request<Workspace>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteWorkspace(token: string, workspaceId: string): Promise<void> {
  return request<void>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
    token,
  });
}

export function getStorageLocation(
  token: string,
  { signal }: Signal = {},
): Promise<StorageLocation> {
  return request<StorageLocation>("/api/v1/storage", { token, signal });
}

export function revealStorageLocation(token: string): Promise<void> {
  return request<void>("/api/v1/storage/reveal", { method: "POST", token });
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
