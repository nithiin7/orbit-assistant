import type { Option } from "@/utils/common";

/** How long Orbit may sit idle before it locks, in minutes (the API allows 1 to 1,440). */
export const LOCK_AFTER_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440] as const;

/** How long a session may sit idle before it is signed out, in minutes (up to 30 days). */
export const SIGN_OUT_AFTER_CHOICES = [30, 60, 240, 480, 1440, 4320, 10080, 43200] as const;

export const NEVER = "never";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** "1 minute", "2 hours", "3 days". */
export function durationLabel(minutes: number): string {
  const [amount, unit] =
    minutes % MINUTES_PER_DAY === 0
      ? [minutes / MINUTES_PER_DAY, "day"]
      : minutes % MINUTES_PER_HOUR === 0
        ? [minutes / MINUTES_PER_HOUR, "hour"]
        : [minutes, "minute"];
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

/** The lock delay choices, including a custom value set elsewhere. */
export function lockAfterOptions(current: number): Option<string>[] {
  const choices = new Set<number>([...LOCK_AFTER_CHOICES, current]);
  return [...choices]
    .sort((a, b) => a - b)
    .map((minutes) => ({ value: String(minutes), label: `After ${durationLabel(minutes)}` }));
}

/** Sign-out choices longer than the lock delay, and Never. */
export function signOutAfterOptions(lockAfter: number, current: number | null): Option<string>[] {
  const choices = new Set<number>(SIGN_OUT_AFTER_CHOICES);
  if (current !== null) choices.add(current);
  return [
    { value: NEVER, label: "Never" },
    ...[...choices]
      .filter((minutes) => minutes > lockAfter)
      .sort((a, b) => a - b)
      .map((minutes) => ({ value: String(minutes), label: `After ${durationLabel(minutes)}` })),
  ];
}

/** The sign-out delay to keep when the lock delay changes: it must stay longer. */
export function signOutAfterFor(lockAfter: number, signOutAfter: number | null): number | null {
  if (signOutAfter === null || signOutAfter > lockAfter) return signOutAfter;
  return SIGN_OUT_AFTER_CHOICES.find((minutes) => minutes > lockAfter) ?? null;
}
