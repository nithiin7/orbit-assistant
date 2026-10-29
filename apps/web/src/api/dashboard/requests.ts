import type { DashboardLayout, DashboardLayoutRequest } from "@orbit/contracts";

import { request, type Signal } from "../client";

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
