import type { StorageLocation } from "@orbit/contracts";

import { request, type Signal } from "./client";

export function getStorageLocation(
  token: string,
  { signal }: Signal = {},
): Promise<StorageLocation> {
  return request<StorageLocation>("/api/v1/storage", { token, signal });
}

export function revealStorageLocation(token: string): Promise<void> {
  return request<void>("/api/v1/storage/reveal", { method: "POST", token });
}
