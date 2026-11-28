"use client";

import type { AppLockStatus } from "@orbit/contracts";
import { Fingerprint, LockKeyhole, LogOut } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { ApiError, describeApiError } from "@/api/client";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCommitUnlock,
  useDeviceUnlockAvailable,
  useUnlockWithDevice,
  useUnlockWithPin,
} from "@/hooks/use-app-lock";
import { DeviceUnlockError, deviceUnlockName, ownDeviceIds } from "@/lib/app-lock";
import { useAuth } from "@/providers/auth";
import { cn } from "@/utils/common";

import { PinPad } from "./pin-pad";

/** How long the unlocked check shows before the app returns. */
const UNLOCK_ANIMATION_MS = 450;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((word) => word?.[0]?.toUpperCase() ?? "").join("") || "?";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

type LockScreenProps = {
  /** This session's lock state; `undefined` while it loads. */
  status: AppLockStatus | undefined;
  displayName: string;
};

/**
 * Shown in place of the app while this session is locked. Nothing private is on the page: the
 * gate unmounts the app and clears its cache before this appears. Unlocking takes the PIN, or
 * Touch ID or Windows Hello on a device that was set up for it.
 */
export function LockScreen({ status, displayName }: LockScreenProps) {
  const id = useId();
  const { signOut } = useAuth();
  const now = useNow();
  const pin = useUnlockWithPin();
  const device = useUnlockWithDevice();
  const commit = useCommitUnlock();
  const deviceAvailable = useDeviceUnlockAvailable();
  const [ownDevices] = useState(ownDeviceIds);
  const [rejection, setRejection] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const prompted = useRef(false);

  const deviceName = deviceUnlockName(navigator.userAgent);
  const canUseDevice =
    deviceAvailable &&
    (status?.devices.some((item) => ownDevices.includes(item.credential_id)) ?? false);
  const busy = pin.isPending || device.isPending;
  const firstName = displayName.trim().split(/\s+/)[0] || displayName;

  function finish(next: AppLockStatus) {
    setAccepted(true);
    setMessage(null);
    window.setTimeout(() => commit(next), prefersReducedMotion() ? 0 : UNLOCK_ANIMATION_MS);
  }

  function refused(reason: unknown, fallback: string) {
    // A 401 means the session was signed out; the app is already leaving this screen.
    if (reason instanceof ApiError && reason.status === 401) return;
    setRejection((count) => count + 1);
    setMessage(describeApiError(reason, fallback));
    navigator.vibrate?.(140);
  }

  function submitPin(value: string) {
    setMessage(null);
    pin.mutateAsync(value).then(finish, (reason: unknown) => {
      refused(reason, "Couldn’t check your PIN. Try again.");
    });
  }

  function unlockWithDevice() {
    device.mutateAsync(undefined).then(finish, (reason: unknown) => {
      if (reason instanceof DeviceUnlockError) {
        if (reason.reason !== "cancelled") setMessage(reason.message);
        return;
      }
      if (reason instanceof ApiError && reason.status === 401) return;
      setMessage(describeApiError(reason, `Couldn’t unlock with ${deviceName}. Use your PIN.`));
    });
  }

  // Offer Touch ID or Windows Hello straight away, once, while this window has focus.
  const promptDevice = useEffectEvent(() => {
    if (prompted.current || !document.hasFocus()) return;
    prompted.current = true;
    unlockWithDevice();
  });
  useEffect(() => {
    if (canUseDevice) promptDevice();
  }, [canUseDevice]);

  function signOutNow() {
    setSigningOut(true);
    signOut().catch(() => setSigningOut(false));
  }

  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    now,
  );
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  const instruction = accepted
    ? "Welcome back."
    : canUseDevice
      ? `Use ${deviceName} or enter your PIN`
      : status?.pin_length
        ? `Enter your ${status.pin_length}-digit PIN`
        : "Enter your PIN";
  // App lock was turned off from another session while this one showed the lock.
  const turnedOff = status !== undefined && !status.enabled && !status.locked;

  return (
    <main
      id="main"
      aria-labelledby={`${id}-title`}
      className={cn(
        "relative isolate flex min-h-dvh animate-lock-in flex-col items-center overflow-y-auto bg-background px-4 py-6",
        accepted && "animate-unlock-out [animation-delay:200ms]",
      )}
    >
      {/* A calm brand glow, like the setup guide's. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(52rem_36rem_at_50%_-10rem,var(--brand-subtle),transparent_70%)]"
      />
      <header className="flex w-full max-w-5xl items-center justify-between">
        <Logo />
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
          <LockKeyhole aria-hidden="true" className="size-3.5" />
          Locked
        </span>
      </header>

      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center py-8">
        <p className="text-5xl font-extralight tracking-tight tabular-nums sm:text-6xl">
          <time dateTime={now.toISOString()}>{time}</time>
        </p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{date}</p>

        {/* The avatar inside a slowly turning orbit. */}
        <div className="relative mt-8 grid size-28 place-items-center" aria-hidden="true">
          <div className="absolute inset-0 animate-spin-slow rounded-full border border-dashed border-brand/30">
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-brand shadow-[0_0_0_4px_var(--brand-subtle)]" />
          </div>
          <div className="grid size-20 place-items-center rounded-full bg-linear-to-br from-brand to-brand-2 text-2xl font-semibold text-brand-foreground shadow-elevation-2 ring-4 ring-card">
            {initials(displayName)}
          </div>
        </div>

        <h1 id={`${id}-title`} className="mt-5 text-xl font-semibold tracking-tight text-balance">
          Welcome back, {firstName}
        </h1>
        <p className="sr-only">Orbit is locked.</p>
        <p
          className={cn(
            "mt-1 min-h-5 text-center text-sm text-pretty",
            message ? "font-medium text-destructive" : "text-muted-foreground",
          )}
          role={message ? "alert" : undefined}
        >
          {message ?? instruction}
        </p>

        <div className="mt-8">
          {turnedOff ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">App lock was turned off.</p>
              <Button onClick={() => commit(status)}>Continue to Orbit</Button>
            </div>
          ) : status ? (
            <PinPad
              length={status.pin_length ?? 4}
              label="Enter your PIN"
              busy={busy}
              rejection={rejection}
              accepted={accepted}
              onComplete={submitPin}
              extraKey={
                canUseDevice ? (
                  <button
                    type="button"
                    aria-label={`Unlock with ${deviceName}`}
                    onClick={unlockWithDevice}
                    disabled={busy || accepted}
                    className="grid size-full place-items-center rounded-full text-brand transition-[background-color,scale] duration-150 outline-none hover:bg-brand-subtle/70 focus-visible:ring-2 focus-visible:ring-ring active:scale-92 disabled:opacity-40"
                  >
                    <Fingerprint aria-hidden="true" className="size-8" strokeWidth={1.5} />
                  </button>
                ) : null
              }
            />
          ) : (
            <div aria-busy="true" className="flex flex-col items-center gap-8">
              <span className="sr-only">Checking the lock…</span>
              <Skeleton className="h-4 w-32 rounded-full" />
              <Skeleton className="h-72 w-64 rounded-3xl" />
            </div>
          )}
        </div>

        {canUseDevice ? (
          <Button
            variant="soft"
            size="sm"
            className="mt-6 rounded-full"
            onClick={unlockWithDevice}
            disabled={busy || accepted}
          >
            <Fingerprint aria-hidden="true" />
            Unlock with {deviceName}
          </Button>
        ) : null}
      </div>

      <footer className="flex w-full max-w-sm flex-col items-center gap-3 pb-2">
        {helpOpen ? (
          <div
            id={`${id}-help`}
            className="w-full rounded-2xl border bg-card/80 p-4 text-sm text-pretty text-muted-foreground shadow-elevation-1 backdrop-blur-sm"
          >
            <p>
              Sign out, then sign back in with your password. For 10 minutes after you sign in, you
              can choose a new PIN in{" "}
              <span className="font-medium text-foreground">Settings → App lock</span> without the
              old one.
            </p>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={helpOpen}
            aria-controls={`${id}-help`}
            onClick={() => setHelpOpen((open) => !open)}
          >
            Forgot PIN?
          </Button>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <Button variant="ghost" size="sm" disabled={signingOut} onClick={signOutNow}>
            <LogOut aria-hidden="true" />
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </footer>
    </main>
  );
}
