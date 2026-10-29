import type { DatabaseHealthResponse, HealthResponse } from "@orbit/contracts";

import { request, type Signal } from "../client";

export function getHealth({ signal }: Signal = {}): Promise<HealthResponse> {
  return request<HealthResponse>("/api/v1/health", { signal });
}

/** Reports which storage mode the API uses. Responds 503 when the database is unreachable. */
export function getDatabaseHealth({ signal }: Signal = {}): Promise<DatabaseHealthResponse> {
  return request<DatabaseHealthResponse>("/api/v1/health/database", { signal });
}
