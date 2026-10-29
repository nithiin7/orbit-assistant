"use client";

import { useEffect, useState } from "react";

import { fetchStorageStatus, type StorageStatus } from "@/lib/storage";

/** Fetch the API's storage mode once on mount. Starts as `loading`. */
export function useStorageStatus(): StorageStatus {
  const [status, setStatus] = useState<StorageStatus>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchStorageStatus(controller.signal).then(setStatus, () => {
      // Only an abort rejects, and that happens on unmount, when there is nothing to update.
    });
    return () => controller.abort();
  }, []);

  return status;
}
