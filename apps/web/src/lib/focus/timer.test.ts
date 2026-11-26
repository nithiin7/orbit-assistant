import { describe, expect, it } from "vitest";

import { DEFAULT_FOCUS_SETTINGS, parseFocusSettings } from "./settings";
import {
  advance,
  DEFAULT_FOCUS_LENGTHS,
  formatCountdown,
  formatFocusTime,
  lengthsFrom,
  parseFocusState,
  pause,
  remainingMs,
  resume,
  skipBreak,
  startFocus,
  stoppedRecord,
} from "./timer";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 26, 9, 0);
const TASK = { workspaceId: "w1", taskId: "t1", taskTitle: "Write the report" };

describe("focus timer", () => {
  it("counts down and leaves pauses out of the focus time", () => {
    let state = startFocus(TASK, T0);
    expect(remainingMs(state, T0 + 10 * MINUTE)).toBe(15 * MINUTE);

    state = pause(state, T0 + 10 * MINUTE);
    expect(remainingMs(state, T0 + 40 * MINUTE)).toBe(15 * MINUTE);

    state = resume(state, T0 + 40 * MINUTE);
    const { state: next, records, ended } = advance(state, T0 + 55 * MINUTE);

    expect(ended).toEqual(["focus"]);
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toMatchObject({
      started_at: new Date(T0).toISOString(),
      ended_at: new Date(T0 + 55 * MINUTE).toISOString(),
      focused_seconds: 25 * 60,
      completed: true,
    });
    expect(next.phase).toBe("short_break");
    expect(next.runningSince).toBe(T0 + 55 * MINUTE);
  });

  it("does nothing before the phase runs out", () => {
    const state = startFocus(TASK, T0);
    expect(advance(state, T0 + 24 * MINUTE)).toEqual({ state, records: [], ended: [] });
  });

  it("catches up after the page was closed, then waits to start the next session", () => {
    const state = startFocus(TASK, T0);
    const { state: next, records, ended } = advance(state, T0 + 3 * 60 * MINUTE);

    expect(ended).toEqual(["focus", "short_break"]);
    expect(records).toHaveLength(1);
    expect(next).toMatchObject({ phase: "focus", finished: 1, runningSince: null, elapsedMs: 0 });
    expect(next.phaseStartedAt).toBe(T0 + 30 * MINUTE);

    // Starting it later records that start, not the moment the break ended.
    const started = resume(next, T0 + 4 * 60 * MINUTE);
    expect(started.phaseStartedAt).toBe(T0 + 4 * 60 * MINUTE);
  });

  it("takes a long break after every fourth session", () => {
    let state = startFocus(TASK, T0);
    let now = T0;
    for (let session = 1; session <= 4; session += 1) {
      now += 25 * MINUTE;
      state = advance(state, now).state;
      expect(state.phase).toBe(session === 4 ? "long_break" : "short_break");
      state = resume(skipBreak(state, now), now);
    }
    expect(state.finished).toBe(4);
  });

  it("records a stopped session only after a minute of focus", () => {
    const state = startFocus(TASK, T0);
    expect(stoppedRecord(state, T0 + 30_000)).toBeNull();
    expect(stoppedRecord(state, T0 + 12 * MINUTE)?.body).toMatchObject({
      focused_seconds: 12 * 60,
      completed: false,
    });
  });

  it("formats times", () => {
    expect(formatCountdown(25 * MINUTE)).toBe("25:00");
    expect(formatCountdown(61_500)).toBe("1:02");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatFocusTime(45 * 60)).toBe("45m");
    expect(formatFocusTime(2 * 3600)).toBe("2h");
    expect(formatFocusTime(2 * 3600 + 5 * 60)).toBe("2h 5m");
  });

  it("reads back only states it wrote", () => {
    const state = startFocus(TASK, T0);
    expect(parseFocusState(JSON.stringify(state))).toEqual(state);
    expect(parseFocusState(null)).toBeNull();
    expect(parseFocusState("not json")).toBeNull();
    expect(parseFocusState(JSON.stringify({ ...state, phase: "nap" }))).toBeNull();
  });

  it("runs with the lengths it started with", () => {
    const lengths = lengthsFrom({
      ...DEFAULT_FOCUS_SETTINGS,
      focusMinutes: 50,
      shortBreakMinutes: 10,
      sessionsPerLongBreak: 2,
    });
    let state = startFocus(TASK, T0, lengths);
    expect(remainingMs(state, T0)).toBe(50 * MINUTE);

    const first = advance(state, T0 + 50 * MINUTE);
    expect(first.records[0]?.body.focused_seconds).toBe(50 * 60);
    expect(first.state.phase).toBe("short_break");
    expect(remainingMs(first.state, T0 + 50 * MINUTE)).toBe(10 * MINUTE);

    state = resume(skipBreak(first.state, T0 + 50 * MINUTE), T0 + 50 * MINUTE);
    expect(advance(state, T0 + 100 * MINUTE).state.phase).toBe("long_break");
  });

  it("reads a timer saved before lengths could change with the defaults", () => {
    const { lengths: _lengths, ...old } = startFocus(TASK, T0);
    expect(parseFocusState(JSON.stringify(old))?.lengths).toEqual(DEFAULT_FOCUS_LENGTHS);
    const tooLong = {
      ...old,
      lengths: {
        ...DEFAULT_FOCUS_LENGTHS,
        phases: { focus: 5 * 60 * MINUTE, short_break: MINUTE, long_break: MINUTE },
      },
    };
    expect(parseFocusState(JSON.stringify(tooLong))).toBeNull();
  });
});

describe("focus settings", () => {
  it("keeps saved choices and falls back to defaults for anything else", () => {
    expect(parseFocusSettings(null)).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(parseFocusSettings("{")).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(
      parseFocusSettings(JSON.stringify({ focusMinutes: 50, shortBreakMinutes: 7, sound: false })),
    ).toEqual({ ...DEFAULT_FOCUS_SETTINGS, focusMinutes: 50, sound: false });
  });
});
