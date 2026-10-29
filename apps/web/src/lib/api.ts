import type {
  AuthConfig,
  BulkChangeResponse,
  CreateShoppingItemRequest,
  CreateTaskRequest,
  CreateWorkspaceRequest,
  DashboardLayout,
  DashboardLayoutRequest,
  DatabaseHealthResponse,
  HealthResponse,
  LocalSessionResponse,
  LocalSignInRequest,
  LocalSignUpRequest,
  ShoppingItem,
  ShoppingItems,
  ShoppingList,
  ShoppingListRequest,
  ShoppingLists,
  StorageLocation,
  Task,
  TaskList,
  TaskListQuery,
  TaskSummary,
  TaskSummaryQuery,
  UpdateProfileRequest,
  UpdateShoppingItemRequest,
  UpdateTaskRequest,
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

/** The signed-in user's saved dashboard layout, or `null` when they haven't arranged it. */
export async function getMyDashboard(
  token: string,
  { signal }: Signal = {},
): Promise<DashboardLayout | null> {
  const layout = await request<DashboardLayout | undefined>("/api/v1/me/dashboard", {
    token,
    signal,
  });
  return layout ?? null;
}

export function putMyDashboard(
  token: string,
  body: DashboardLayoutRequest,
): Promise<DashboardLayout> {
  return request<DashboardLayout>("/api/v1/me/dashboard", { method: "PUT", body, token });
}

/** Forget the saved layout, so the default dashboard shows. */
export function deleteMyDashboard(token: string): Promise<void> {
  return request<void>("/api/v1/me/dashboard", { method: "DELETE", token });
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

type QueryValue = string | number | readonly string[] | null | undefined;

/** `?a=1&b=x&b=y` from defined values; arrays repeat their key. */
function toQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number") search.append(key, String(value));
    else for (const item of value) search.append(key, item);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function tasksPath(workspaceId: string, suffix = ""): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tasks${suffix}`;
}

function taskPath(workspaceId: string, taskId: string, suffix = ""): string {
  return tasksPath(workspaceId, `/${encodeURIComponent(taskId)}${suffix}`);
}

export function listTasks(
  token: string,
  workspaceId: string,
  query: TaskListQuery = {},
  { signal }: Signal = {},
): Promise<TaskList> {
  return request<TaskList>(`${tasksPath(workspaceId)}${toQueryString(query)}`, { token, signal });
}

/** Task counts; `today` (the user's local date) decides what is overdue or due today. */
export function getTaskSummary(
  token: string,
  workspaceId: string,
  query: TaskSummaryQuery = {},
  { signal }: Signal = {},
): Promise<TaskSummary> {
  return request<TaskSummary>(`${tasksPath(workspaceId, "/summary")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function createTask(
  token: string,
  workspaceId: string,
  body: CreateTaskRequest,
): Promise<Task> {
  return request<Task>(tasksPath(workspaceId), { method: "POST", body, token });
}

export function updateTask(
  token: string,
  workspaceId: string,
  taskId: string,
  body: UpdateTaskRequest,
): Promise<Task> {
  return request<Task>(taskPath(workspaceId, taskId), { method: "PATCH", body, token });
}

export function completeTask(token: string, workspaceId: string, taskId: string): Promise<Task> {
  return request<Task>(taskPath(workspaceId, taskId, "/complete"), { method: "POST", token });
}

export function reopenTask(token: string, workspaceId: string, taskId: string): Promise<Task> {
  return request<Task>(taskPath(workspaceId, taskId, "/reopen"), { method: "POST", token });
}

export function deleteTask(token: string, workspaceId: string, taskId: string): Promise<void> {
  return request<void>(taskPath(workspaceId, taskId), { method: "DELETE", token });
}

function shoppingPath(workspaceId: string, suffix: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/shopping${suffix}`;
}

function shoppingListPath(workspaceId: string, listId: string, suffix = ""): string {
  return shoppingPath(workspaceId, `/lists/${encodeURIComponent(listId)}${suffix}`);
}

function shoppingItemPath(workspaceId: string, itemId: string, suffix = ""): string {
  return shoppingPath(workspaceId, `/items/${encodeURIComponent(itemId)}${suffix}`);
}

/** Every list with its item counts. The API creates the default Groceries list on first read. */
export function listShoppingLists(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<ShoppingLists> {
  return request<ShoppingLists>(shoppingPath(workspaceId, "/lists"), { token, signal });
}

export function createShoppingList(
  token: string,
  workspaceId: string,
  body: ShoppingListRequest,
): Promise<ShoppingList> {
  return request<ShoppingList>(shoppingPath(workspaceId, "/lists"), {
    method: "POST",
    body,
    token,
  });
}

export function renameShoppingList(
  token: string,
  workspaceId: string,
  listId: string,
  body: ShoppingListRequest,
): Promise<ShoppingList> {
  return request<ShoppingList>(shoppingListPath(workspaceId, listId), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteShoppingList(
  token: string,
  workspaceId: string,
  listId: string,
): Promise<void> {
  return request<void>(shoppingListPath(workspaceId, listId), { method: "DELETE", token });
}

/** Mark every purchased item in the list as needed again. */
export function restockShoppingList(
  token: string,
  workspaceId: string,
  listId: string,
): Promise<BulkChangeResponse> {
  return request<BulkChangeResponse>(shoppingListPath(workspaceId, listId, "/restock"), {
    method: "POST",
    token,
  });
}

/** Permanently delete the list's purchased items. */
export function clearPurchasedItems(
  token: string,
  workspaceId: string,
  listId: string,
): Promise<BulkChangeResponse> {
  return request<BulkChangeResponse>(shoppingListPath(workspaceId, listId, "/clear-purchased"), {
    method: "POST",
    token,
  });
}

export function listShoppingItems(
  token: string,
  workspaceId: string,
  listId: string,
  { signal }: Signal = {},
): Promise<ShoppingItems> {
  return request<ShoppingItems>(shoppingListPath(workspaceId, listId, "/items"), {
    token,
    signal,
  });
}

export function addShoppingItem(
  token: string,
  workspaceId: string,
  listId: string,
  body: CreateShoppingItemRequest,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingListPath(workspaceId, listId, "/items"), {
    method: "POST",
    body,
    token,
  });
}

export function updateShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
  body: UpdateShoppingItemRequest,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingItemPath(workspaceId, itemId), {
    method: "PATCH",
    body,
    token,
  });
}

export function purchaseShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingItemPath(workspaceId, itemId, "/purchase"), {
    method: "POST",
    token,
  });
}

export function restockShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingItemPath(workspaceId, itemId, "/restock"), {
    method: "POST",
    token,
  });
}

export function deleteShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
): Promise<void> {
  return request<void>(shoppingItemPath(workspaceId, itemId), { method: "DELETE", token });
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
