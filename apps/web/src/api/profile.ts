import type { UpdateProfileRequest, UserProfile } from "@orbit/contracts";

import { request, send, type Signal } from "./client";

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
