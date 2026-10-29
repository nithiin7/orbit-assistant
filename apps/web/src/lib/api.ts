import type { DatabaseHealthResponse, HealthResponse } from "@orbit/contracts";

import { publicEnv } from "./env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Request to ${path} failed with status ${status}.`);
    this.name = "ApiError";
  }
}

/** Fetch JSON from the Orbit API. Response types come from the shared API contract. */
async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${publicEnv.apiUrl}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  if (!response.ok) throw new ApiError(response.status, path);
  return (await response.json()) as T;
}

export function getHealth(init?: RequestInit): Promise<HealthResponse> {
  return getJson<HealthResponse>("/api/v1/health", init);
}

/** Reports which storage mode the API uses. Responds 503 when the database is unreachable. */
export function getDatabaseHealth(init?: RequestInit): Promise<DatabaseHealthResponse> {
  return getJson<DatabaseHealthResponse>("/api/v1/health/database", init);
}
