"use client";

import type { UpdateStatus } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  checkForUpdates,
  systemKeys,
  systemStatusOptions,
  updateStatusOptions,
  updateSystemSettings,
} from "@/api/system";
import { useAuth } from "@/providers/auth";

export function useSystemStatus() {
  const { withToken } = useAuth();
  return useQuery(systemStatusOptions(withToken));
}

/** The update notice, with turning checks on or off and checking now. */
export function useUpdateStatus() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery(updateStatusOptions(withToken));
  const store = (status: UpdateStatus) =>
    queryClient.setQueryData<UpdateStatus>(systemKeys.update(), status);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      withToken((token) => updateSystemSettings(token, { update_check_enabled: enabled })),
    onSuccess: store,
  });
  const check = useMutation({
    mutationFn: () => withToken((token) => checkForUpdates(token)),
    onSuccess: store,
  });
  return { query, toggle, check };
}

/** Whether a newer release is out, for a badge. `false` while loading, off, or on error. */
export function useUpdateAvailable(): boolean {
  const { withToken } = useAuth();
  const { data } = useQuery(updateStatusOptions(withToken));
  return data?.update_available ?? false;
}
