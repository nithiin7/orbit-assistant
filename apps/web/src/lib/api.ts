import type {
  AuthConfig,
  CreateWorkspaceRequest,
  DatabaseHealthResponse,
  HealthResponse,
  LocalSessionResponse,
  LocalSignInRequest,
  LocalSignUpRequest,
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
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Session or access token, sent as `Authorization: Bearer`. */
  token?: string;
  signal?: AbortSignal;
};

/** Call the Orbit API. Response types come from the shared API contract. */
async function request<T>(path: string, { method, body, token, signal }: RequestOptions = {}) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${publicEnv.apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, path, await readDetail(response));
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

/** A message for a failed request, suitable for showing to the user. */
export function describeApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.detail) return error.detail;
    if (error.status === 503) return "Orbit’s database is unavailable. Try again shortly.";
    return fallback;
  }
  return "Can’t reach the Orbit API. Check that it’s running, then try again.";
}
