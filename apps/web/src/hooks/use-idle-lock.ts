"use client";

import { useEffect, useEffectEvent, useRef } from "react";

import {
  HEARTBEAT_MS,
  IDLE_CHECK_MS,
  isIdle,
  readSharedActivity,
  SHARE_ACTIVITY_MS,
  shareActivity,
} from "@/lib/app-lock";

/** Input that counts as using Orbit. Background refreshes never do. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

type IdleLockOptions = {
  /** Track idle time only while the lock is on and this session is unlocked. */
  active: boolean;
  lockAfterMinutes: number;
  /** The person has been idle in every tab for `lockAfterMinutes`. */
  onIdle: () => void;
  /** Report activity to the API; called at most every `HEARTBEAT_MS`, trailing included. */
  onHeartbeat: () => void;
};

/**
 * Watches for input in this tab, shares it with the person's other tabs, and calls `onIdle`
 * once none of them has seen any for the lock delay. A tab that was hidden or asleep checks as
 * soon as it is visible again.
 */
export function useIdleLock({ active, lockAfterMinutes, onIdle, onHeartbeat }: IdleLockOptions) {
  const lastActive = useRef(0);
  const lastShared = useRef(0);
  const lastBeat = useRef(0);
  const idle = useEffectEvent(onIdle);
  const heartbeat = useEffectEvent(onHeartbeat);

  useEffect(() => {
    if (!active) return;
    let beatTimer: number | null = null;
    const start = Date.now();
    lastActive.current = start;
    lastShared.current = start;
    shareActivity(start);

    const beat = () => {
      beatTimer = null;
      lastBeat.current = Date.now();
      heartbeat();
    };
    const markActive = () => {
      const now = Date.now();
      lastActive.current = now;
      if (now - lastShared.current >= SHARE_ACTIVITY_MS) {
        lastShared.current = now;
        shareActivity(now);
      }
      const sinceBeat = now - lastBeat.current;
      if (sinceBeat >= HEARTBEAT_MS) beat();
      else beatTimer ??= window.setTimeout(beat, HEARTBEAT_MS - sinceBeat);
    };
    const check = () => {
      const last = Math.max(lastActive.current, readSharedActivity() ?? 0);
      if (isIdle(last, Date.now(), lockAfterMinutes)) idle();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, markActive, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const interval = window.setInterval(check, IDLE_CHECK_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, markActive, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.clearInterval(interval);
      if (beatTimer !== null) window.clearTimeout(beatTimer);
    };
  }, [active, lockAfterMinutes]);
}
