import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVITY_KEY } from "@/lib/app-lock";

import { useIdleLock } from "./use-idle-lock";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(active = true) {
  const onIdle = vi.fn();
  const onHeartbeat = vi.fn();
  const hook = renderHook(
    ({ on }: { on: boolean }) =>
      useIdleLock({ active: on, lockAfterMinutes: 1, onIdle, onHeartbeat }),
    { initialProps: { on: active } },
  );
  return { onIdle, onHeartbeat, ...hook };
}

describe("useIdleLock", () => {
  it("locks after the idle time without input", () => {
    const { onIdle } = setup();

    act(() => vi.advanceTimersByTime(55_000));
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10_000));

    expect(onIdle).toHaveBeenCalled();
  });

  it("input keeps it unlocked and reports activity, throttled", () => {
    const { onIdle, onHeartbeat } = setup();

    for (let second = 0; second < 90; second += 10) {
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        vi.advanceTimersByTime(10_000);
      });
    }

    expect(onIdle).not.toHaveBeenCalled();
    // One right away, then at most one every 15 seconds.
    expect(onHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(onHeartbeat.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it("counts activity in other tabs", () => {
    const { onIdle } = setup();

    act(() => vi.advanceTimersByTime(50_000));
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    act(() => vi.advanceTimersByTime(20_000));

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does nothing while inactive", () => {
    const { onIdle, onHeartbeat } = setup(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      vi.advanceTimersByTime(600_000);
    });

    expect(onIdle).not.toHaveBeenCalled();
    expect(onHeartbeat).not.toHaveBeenCalled();
  });
});
