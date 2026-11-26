import type { RecordFocusSessionRequest } from "@orbit/contracts";

import { localDateString } from "@/utils/dates";

import type { FocusSettings } from "./settings";

/**
 * The focus timer: by default 25 minutes of focus on one task, then a 5-minute break, with a
 * 15-minute break after every fourth session (see `FocusSettings`). The state is plain data with times in epoch milliseconds,
 * so it can be saved in localStorage and picked up after a reload. Every function here is pure:
 * the caller passes the current time.
 */
export type FocusPhase = "focus" | "short_break" | "long_break";

/** The lengths a timer runs with, fixed when it starts. */
export type FocusLengths = {
  /** Each phase's length in milliseconds. */
  phases: Record<FocusPhase, number>;
  sessionsPerLongBreak: number;
};

export const DEFAULT_FOCUS_LENGTHS: FocusLengths = {
  phases: { focus: 25 * 60_000, short_break: 5 * 60_000, long_break: 15 * 60_000 },
  sessionsPerLongBreak: 4,
};

export function lengthsFrom(settings: FocusSettings): FocusLengths {
  return {
    phases: {
      focus: settings.focusMinutes * 60_000,
      short_break: settings.shortBreakMinutes * 60_000,
      long_break: settings.longBreakMinutes * 60_000,
    },
    sessionsPerLongBreak: settings.sessionsPerLongBreak,
  };
}
/** Shorter than this is a false start, not focus; the API agrees. */
export const MIN_RECORDED_MS = 60_000;

export type FocusTimerState = {
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  lengths: FocusLengths;
  phase: FocusPhase;
  /** Focus sessions finished in this run, which decides when the long break comes. */
  finished: number;
  /** When the current phase first started. */
  phaseStartedAt: number;
  /** Time counted in this phase before `runningSince`. */
  elapsedMs: number;
  /** When the timer last started or resumed; null while paused or waiting to start. */
  runningSince: number | null;
};

/** A session for the API, and the workspace it belongs to. */
export type FocusRecord = {
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  body: RecordFocusSessionRequest;
};

export function startFocus(
  task: { workspaceId: string; taskId: string; taskTitle: string },
  now: number,
  lengths: FocusLengths = DEFAULT_FOCUS_LENGTHS,
): FocusTimerState {
  return {
    ...task,
    lengths,
    phase: "focus",
    finished: 0,
    phaseStartedAt: now,
    elapsedMs: 0,
    runningSince: now,
  };
}

export function phaseLengthMs(state: FocusTimerState): number {
  return state.lengths.phases[state.phase];
}

export function elapsedMs(state: FocusTimerState, now: number): number {
  const running = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince);
  return Math.min(phaseLengthMs(state), state.elapsedMs + running);
}

export function remainingMs(state: FocusTimerState, now: number): number {
  return phaseLengthMs(state) - elapsedMs(state, now);
}

export function pause(state: FocusTimerState, now: number): FocusTimerState {
  if (state.runningSince === null) return state;
  return { ...state, elapsedMs: elapsedMs(state, now), runningSince: null };
}

export function resume(state: FocusTimerState, now: number): FocusTimerState {
  if (state.runningSince !== null) return state;
  // A phase waiting to start begins now, so its recorded start leaves out the wait.
  const phaseStartedAt = state.elapsedMs === 0 ? now : state.phaseStartedAt;
  return { ...state, phaseStartedAt, runningSince: now };
}

function record(state: FocusTimerState, endedAt: number, completed: boolean): FocusRecord {
  return {
    workspaceId: state.workspaceId,
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    body: {
      started_at: new Date(state.phaseStartedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      focused_seconds: Math.round(elapsedMs(state, endedAt) / 1000),
      day: localDateString(new Date(state.phaseStartedAt)),
      completed,
    },
  };
}

function nextPhase(state: FocusTimerState, at: number, running: boolean): FocusTimerState {
  if (state.phase === "focus") {
    const finished = state.finished + 1;
    return {
      ...state,
      phase: finished % state.lengths.sessionsPerLongBreak === 0 ? "long_break" : "short_break",
      finished,
      phaseStartedAt: at,
      elapsedMs: 0,
      runningSince: running ? at : null,
    };
  }
  return { ...state, phase: "focus", phaseStartedAt: at, elapsedMs: 0, runningSince: null };
}

/**
 * Moves past every phase that has run out by `now`: a finished focus session is recorded and its
 * break starts at once; a finished break waits for the user to start the next session. Also
 * catches up after the page was closed.
 */
export function advance(
  state: FocusTimerState,
  now: number,
): { state: FocusTimerState; records: FocusRecord[]; ended: FocusPhase[] } {
  const records: FocusRecord[] = [];
  const ended: FocusPhase[] = [];
  let current = state;
  while (current.runningSince !== null && remainingMs(current, now) <= 0) {
    const endedAt = current.runningSince + (phaseLengthMs(current) - current.elapsedMs);
    if (current.phase === "focus") records.push(record(current, endedAt, true));
    ended.push(current.phase);
    current = nextPhase(current, endedAt, true);
  }
  return { state: current, records, ended };
}

/** Ends a break early; the next focus session waits to be started. */
export function skipBreak(state: FocusTimerState, now: number): FocusTimerState {
  if (state.phase === "focus") return state;
  return nextPhase(state, now, false);
}

/** The session so far, when the user stops partway through focusing; null if too short. */
export function stoppedRecord(state: FocusTimerState, now: number): FocusRecord | null {
  if (state.phase !== "focus" || elapsedMs(state, now) < MIN_RECORDED_MS) return null;
  return record(state, now, false);
}

/** `mm:ss`, rounding up so the timer reads 0:00 only when it's done. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Focused time in words, such as "45m" or "2h 5m". */
export function formatFocusTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export const PHASE_LABELS: Record<FocusPhase, string> = {
  focus: "Focus",
  short_break: "Short break",
  long_break: "Long break",
};

const PHASES: readonly string[] = ["focus", "short_break", "long_break"];

function isLength(value: unknown): value is number {
  // The API records focus sessions of one minute to four hours.
  return typeof value === "number" && value >= 60_000 && value <= 4 * 60 * 60_000;
}

/** Saved lengths, or the defaults for a timer saved before lengths could change. */
function parseLengths(value: unknown): FocusLengths | null {
  if (value === undefined) return DEFAULT_FOCUS_LENGTHS;
  if (typeof value !== "object" || value === null) return null;
  const data: Record<string, unknown> = { ...value };
  const phases: unknown = data.phases;
  const sessions = data.sessionsPerLongBreak;
  if (typeof phases !== "object" || phases === null) return null;
  const lengths: Record<string, unknown> = { ...phases };
  const { focus, short_break, long_break } = lengths;
  if (!isLength(focus) || !isLength(short_break) || !isLength(long_break)) return null;
  if (typeof sessions !== "number" || !Number.isInteger(sessions) || sessions < 1) return null;
  return { phases: { focus, short_break, long_break }, sessionsPerLongBreak: sessions };
}

function isPhase(value: unknown): value is FocusPhase {
  return typeof value === "string" && PHASES.includes(value);
}

/** Reads a saved state back, or null if it's missing or not one this version wrote. */
export function parseFocusState(raw: string | null): FocusTimerState | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const data: Record<string, unknown> = { ...value };
  const {
    workspaceId,
    taskId,
    taskTitle,
    phase,
    finished,
    phaseStartedAt,
    elapsedMs,
    runningSince,
  } = data;
  const lengths = parseLengths(data.lengths);
  if (
    lengths === null ||
    typeof workspaceId !== "string" ||
    typeof taskId !== "string" ||
    typeof taskTitle !== "string" ||
    !isPhase(phase) ||
    typeof finished !== "number" ||
    typeof phaseStartedAt !== "number" ||
    typeof elapsedMs !== "number" ||
    (runningSince !== null && typeof runningSince !== "number")
  ) {
    return null;
  }
  return {
    workspaceId,
    taskId,
    taskTitle,
    lengths,
    phase,
    finished,
    phaseStartedAt,
    elapsedMs,
    runningSince,
  };
}
