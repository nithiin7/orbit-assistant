import type { SystemSettingsRequest, SystemStatus, UpdateStatus } from "@orbit/contracts";

import { request, type Signal } from "../client";

export function getSystemStatus(token: string, { signal }: Signal = {}): Promise<SystemStatus> {
  return request<SystemStatus>("/api/v1/system/status", { token, signal });
}

export function getUpdateStatus(token: string, { signal }: Signal = {}): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/v1/system/update", { token, signal });
}

export function checkForUpdates(token: string): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/v1/system/update/check", { method: "POST", token });
}

export function updateSystemSettings(
  token: string,
  body: SystemSettingsRequest,
): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/v1/system/settings", { method: "PUT", token, body });
}
