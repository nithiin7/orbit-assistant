import type { DatabaseHealthResponse } from "@orbit/contracts";

import { ApiError } from "@/api/client";
import { getDatabaseHealth } from "@/api/health";

export type StorageMode = DatabaseHealthResponse["storage_mode"];

/** What the web app knows about where the API stores data. */
export type StorageStatus =
  | { state: "loading" }
  | { state: "ready"; mode: StorageMode }
  | { state: "unavailable" } // The API is running, but its database is not reachable.
  | { state: "unreachable" }; // The API itself did not respond.

type StorageDescription = { label: string; detail: string };

export const storageModes: Record<StorageMode, StorageDescription> = {
  local: { label: "Local · SQLite", detail: "Data is stored in a database file on this computer." },
  cloud: {
    label: "Cloud · Supabase",
    detail: "Data is stored in your hosted Supabase PostgreSQL database.",
  },
};

/** Ask the API which database it uses. Resolves to a status; never rejects except on abort. */
export async function fetchStorageStatus(signal?: AbortSignal): Promise<StorageStatus> {
  try {
    const { storage_mode: mode } = await getDatabaseHealth({ signal });
    return { state: "ready", mode };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiError && error.status === 503) return { state: "unavailable" };
    return { state: "unreachable" };
  }
}

/** The name of the platform's file manager action, for the "show database" button. */
export function revealLabel(userAgent: string): string {
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Show in Finder";
  if (/Windows/.test(userAgent)) return "Show in File Explorer";
  return "Open folder";
}
