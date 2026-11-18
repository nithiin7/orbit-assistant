"use client";

import type { PushStatus, UpdatePushPreferencesRequest } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  pushKeys,
  pushStatusOptions,
  removePushSubscription,
  savePushSubscription,
  sendPushTest,
  updatePushPreferences,
} from "@/api/push";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { deviceEndpoint, isDeviceSubscribed, subscribeDevice, unsubscribeDevice } from "@/lib/push";
import { useAuth } from "@/providers/auth";

export function usePushStatus(): Resource<PushStatus> {
  const { withToken } = useAuth();
  return queryResource(
    useQuery(pushStatusOptions(withToken)),
    "Couldn’t load notification settings.",
  );
}

/** Whether this browser receives push notifications. */
export function useDevicePush(publicKey: string | null) {
  return useQuery({
    queryKey: pushKeys.device(publicKey),
    queryFn: () => (publicKey ? isDeviceSubscribed(publicKey) : false),
  });
}

export function useUpdatePushPreferences() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePushPreferencesRequest) =>
      withToken((token) => updatePushPreferences(token, body)),
    onSuccess: (status) => queryClient.setQueryData(pushKeys.status(), status),
  });
}

/** Turn push on or off for this browser, on both the browser's side and the server's. */
export function useToggleDevicePush(publicKey: string | null) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<PushStatus | null> => {
      if (enabled) {
        if (publicKey === null) return null;
        const subscription = await subscribeDevice(publicKey);
        try {
          return await withToken((token) => savePushSubscription(token, subscription));
        } catch (error) {
          // Don't leave the browser subscribed to something the server doesn't know about.
          await unsubscribeDevice();
          throw error;
        }
      }
      const endpoint = await deviceEndpoint();
      const status =
        endpoint === null
          ? null
          : await withToken((token) => removePushSubscription(token, endpoint));
      await unsubscribeDevice();
      return status;
    },
    onSuccess: (status, enabled) => {
      queryClient.setQueryData(pushKeys.device(publicKey), enabled);
      if (status) queryClient.setQueryData(pushKeys.status(), status);
    },
  });
}

export function useSendPushTest() {
  const { withToken } = useAuth();
  return useMutation({ mutationFn: () => withToken((token) => sendPushTest(token)) });
}
