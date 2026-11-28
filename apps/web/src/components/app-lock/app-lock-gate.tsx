"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useEffectEvent } from "react";

import { recordAppLockActivity } from "@/api/app-lock";
import {
  clearPrivateData,
  LOCK_SHORTCUT_KEY,
  useAppLockQuery,
  useLockNow,
} from "@/hooks/use-app-lock";
import { useIdleLock } from "@/hooks/use-idle-lock";
import { EVENT_KEY, parseLockEvent } from "@/lib/app-lock";
import { useAuth, useCurrentUser } from "@/providers/auth";
import { isMacPlatform, matchesModShiftShortcut } from "@/utils/keyboard";

import { LockScreen } from "./lock-screen";

/**
 * App lock for everything signed in. With the lock on, it tracks the person's activity across
 * tabs and locks after the chosen idle time; the API locks the session too, so a closed or
 * sleeping browser comes back locked. While locked, the app is unmounted and its cached data
 * dropped, and the lock screen shows instead. Cmd+Shift+L (Ctrl+Shift+L elsewhere) locks at once.
 *
 * With the lock off (most people), this only loads the lock state once.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { appLocked, setAppLocked, withToken } = useAuth();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const query = useAppLockQuery();
  const lockNow = useLockNow();
  const status = query.data;
  const locked = appLocked || status?.locked === true;
  const enabled = status?.enabled === true;

  useIdleLock({
    active: enabled && !locked,
    lockAfterMinutes: status?.lock_after_minutes ?? 5,
    onIdle: () => lockNow?.(),
    onHeartbeat: () => {
      // A 423 here (the API locked first) sets `appLocked` through `withToken`.
      withToken((token) => recordAppLockActivity(token)).catch(() => undefined);
    },
  });

  // The lock shortcut works anywhere in the app, text fields included: it's a deliberate chord.
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!lockNow || locked) return;
    if (!matchesModShiftShortcut(event, LOCK_SHORTCUT_KEY, isMacPlatform(navigator.userAgent))) {
      return;
    }
    event.preventDefault();
    lockNow();
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onShortcut(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Nothing private stays in memory while locked. The app's components are unmounted by then,
  // so nothing refetches.
  useEffect(() => {
    if (locked) clearPrivateData(queryClient);
  }, [locked, queryClient]);

  // The API reported this session locked: get the attempts left and timing for the lock screen.
  const refresh = useEffectEvent(() => void query.refetch());
  useEffect(() => {
    if (appLocked) refresh();
  }, [appLocked]);

  // Follow locking and unlocking in the person's other tabs.
  const onLockEvent = useEffectEvent((value: string | null) => {
    const event = parseLockEvent(value);
    if (event === "locked") {
      setAppLocked(true);
    } else if (event === "unlocked") {
      void query.refetch().then(({ data }) => {
        if (data && !data.locked) setAppLocked(false);
      });
    }
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === EVENT_KEY) onLockEvent(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (locked) return <LockScreen status={status} displayName={user.display_name} />;
  return children;
}
