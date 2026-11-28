"use client";

import type { AppLockStatus, AppLockTimingRequest } from "@orbit/contracts";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addAppLockDevice,
  appLockKeys,
  appLockStatusOptions,
  disableAppLock,
  getAppLockDeviceOptions,
  getUnlockOptions,
  lockApp,
  removeAppLockDevice,
  setAppLockPin,
  unlockWithDevice,
  unlockWithPin,
  updateAppLockTiming,
} from "@/api/app-lock";
import { queryResource, type Resource } from "@/hooks/query-resource";
import {
  announceLockEvent,
  createDeviceCredential,
  deviceLabel,
  deviceUnlockAvailable,
  getDeviceAssertion,
  rememberOwnDevice,
} from "@/lib/app-lock";
import { useAuth } from "@/providers/auth";

export function useAppLockStatus(): Resource<AppLockStatus> {
  const { withToken } = useAuth();
  return queryResource(useQuery(appLockStatusOptions(withToken)), "Couldn’t load app lock.");
}

/** The status query itself, for the lock gate. */
export function useAppLockQuery() {
  const { withToken, appLocked } = useAuth();
  return useQuery({
    ...appLockStatusOptions(withToken),
    // While locked, check now and then so a session past its sign-out delay signs out.
    refetchInterval: (query) => (appLocked || query.state.data?.locked ? 60_000 : false),
    refetchOnWindowFocus: true,
  });
}

/** Whether this device has Touch ID, Windows Hello, or similar that the browser can use. */
export function useDeviceUnlockAvailable(): boolean {
  const { data } = useQuery({
    queryKey: [...appLockKeys.me(), "device-available"],
    queryFn: deviceUnlockAvailable,
    staleTime: Infinity,
  });
  return data === true;
}

function useSaveStatus() {
  const queryClient = useQueryClient();
  return (status: AppLockStatus) => queryClient.setQueryData(appLockKeys.status(), status);
}

export function useSetAppLockPin() {
  const { withToken } = useAuth();
  const save = useSaveStatus();
  return useMutation({
    mutationFn: (body: { pin: string; currentPin: string | null }) =>
      withToken((token) => setAppLockPin(token, { pin: body.pin, current_pin: body.currentPin })),
    onSuccess: save,
  });
}

export function useUpdateAppLockTiming() {
  const { withToken } = useAuth();
  const save = useSaveStatus();
  return useMutation({
    mutationFn: (body: AppLockTimingRequest) =>
      withToken((token) => updateAppLockTiming(token, body)),
    onSuccess: save,
  });
}

export function useDisableAppLock() {
  const { withToken } = useAuth();
  const save = useSaveStatus();
  return useMutation({
    mutationFn: (currentPin: string | null) =>
      withToken((token) => disableAppLock(token, { current_pin: currentPin })),
    onSuccess: save,
  });
}

/** Clear everything the app had loaded, keeping only the lock state the lock screen needs. */
export function clearPrivateData(queryClient: QueryClient) {
  const lockKey = appLockKeys.me();
  void queryClient.cancelQueries();
  queryClient.removeQueries({
    predicate: (query) => !lockKey.every((part, index) => query.queryKey[index] === part),
  });
}

/** Lock this session now: on the server, in this tab, and in the person's other tabs. */
export function useLockApp() {
  const { withToken, setAppLocked } = useAuth();
  const save = useSaveStatus();
  return useMutation({
    mutationFn: () => withToken((token) => lockApp(token)),
    onSuccess: (status) => {
      save(status);
      if (status.locked) {
        setAppLocked(true);
        announceLockEvent("locked");
      }
    },
  });
}

/** The key that locks Orbit with mod + Shift: Cmd+Shift+L on macOS, Ctrl+Shift+L elsewhere. */
export const LOCK_SHORTCUT_KEY = "l";

/**
 * Lock this session at once. The lock screen shows straight away, here and in other tabs; the
 * API is told in the background (an idle session is locked there by time anyway). Does nothing
 * when the lock is off.
 */
export function useLockNow(): (() => void) | null {
  const { withToken, setAppLocked } = useAuth();
  // The gate already loads this; it's shared from the cache.
  const { data } = useQuery(appLockStatusOptions(withToken));
  const lock = useLockApp();
  if (!data?.enabled) return null;
  return () => {
    setAppLocked(true);
    announceLockEvent("locked");
    if (!lock.isPending) lock.mutate();
  };
}

/** Apply an unlock the API confirmed: this tab and the person's other tabs open again. The lock
 * screen calls it once its success animation has played. */
export function useCommitUnlock() {
  const { setAppLocked } = useAuth();
  const save = useSaveStatus();
  return (status: AppLockStatus) => {
    save(status);
    if (!status.locked) {
      setAppLocked(false);
      announceLockEvent("unlocked");
    }
  };
}

/** Check the PIN; on success, pass the status to `useCommitUnlock`'s function. */
export function useUnlockWithPin() {
  const { withToken } = useAuth();
  return useMutation({
    mutationFn: (pin: string) => withToken((token) => unlockWithPin(token, { pin })),
  });
}

/** Unlock with Touch ID or Windows Hello; on success, pass the status to `useCommitUnlock`'s. */
export function useUnlockWithDevice() {
  const { withToken } = useAuth();
  return useMutation({
    mutationFn: async (signal?: AbortSignal) => {
      const { options } = await withToken((token) => getUnlockOptions(token));
      const credential = await getDeviceAssertion(options, signal);
      return withToken((token) => unlockWithDevice(token, { credential }));
    },
  });
}

/** Register this device's Touch ID or Windows Hello. */
export function useAddAppLockDevice() {
  const { withToken } = useAuth();
  const save = useSaveStatus();
  return useMutation({
    mutationFn: async () => {
      const { options } = await withToken((token) => getAppLockDeviceOptions(token));
      const credential = await createDeviceCredential(options);
      const status = await withToken((token) =>
        addAppLockDevice(token, { credential, label: deviceLabel(navigator.userAgent) }),
      );
      if (typeof credential.rawId === "string") rememberOwnDevice(credential.rawId);
      return status;
    },
    onSuccess: save,
  });
}

export function useRemoveAppLockDevice() {
  const { withToken } = useAuth();
  const save = useSaveStatus();
  return useMutation({
    mutationFn: (deviceId: string) => withToken((token) => removeAppLockDevice(token, deviceId)),
    onSuccess: save,
  });
}
