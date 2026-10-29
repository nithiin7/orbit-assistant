"use client";

import { useQuery } from "@tanstack/react-query";

import { storageStatusOptions } from "@/api/storage";
import type { StorageStatus } from "@/lib/storage";

/** The API's storage mode, shared by every indicator on the page. Starts as `loading`. */
export function useStorageStatus(): StorageStatus {
  return useQuery(storageStatusOptions()).data ?? { state: "loading" };
}
