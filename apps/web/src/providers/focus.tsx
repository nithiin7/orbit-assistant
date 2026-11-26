"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react";

import { recordFocusSession, taskKeys } from "@/api/tasks";
import {
  advance,
  type FocusRecord,
  type FocusSettings,
  type FocusTimerState,
  formatFocusTime,
  lengthsFrom,
  notifyInBackground,
  parseFocusSettings,
  parseFocusState,
  pause,
  playChime,
  resume,
  skipBreak,
  startFocus,
  stoppedRecord,
} from "@/lib/focus";
import { useAuth } from "@/providers/auth";
import { useToast } from "@/providers/toast";

/** The running timer is saved per browser, so it survives reloads and moving between pages. */
export const FOCUS_STORAGE_KEY = "orbit:focus";
/** Timer lengths and alerts, also per browser. */
export const FOCUS_SETTINGS_STORAGE_KEY = "orbit:focus-settings";
/** A phase that ended longer ago than this (the page was closed) ends without a sound. */
const ALERT_WINDOW_MS = 60_000;

/** The mutation key for recorded sessions, so tests and watchers can tell them apart. */
export const FOCUS_MUTATION_KEY = ["focus-session"] as const;

export type FocusTask = { workspaceId: string; taskId: string; taskTitle: string };

type FocusContextValue = {
  timer: FocusTimerState | null;
  settings: FocusSettings;
  /** Applies to timers started from now on; a running one keeps its lengths. */
  saveSettings: (settings: FocusSettings) => void;
  /** Start focusing on a task; a session already running on another task is stopped first. */
  start: (task: FocusTask) => void;
  pause: () => void;
  resume: () => void;
  skipBreak: () => void;
  /** End the timer, recording the focus so far when it's at least a minute. */
  stop: () => void;
};

const FocusContext = createContext<FocusContextValue | null>(null);

const noSubscription = () => () => {};

function readStored(): FocusTimerState | null {
  try {
    return parseFocusState(localStorage.getItem(FOCUS_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readSettings(): FocusSettings {
  try {
    return parseFocusSettings(localStorage.getItem(FOCUS_SETTINGS_STORAGE_KEY));
  } catch {
    return parseFocusSettings(null);
  }
}

function writeSettings(settings: FocusSettings) {
  try {
    localStorage.setItem(FOCUS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // As for the timer: without storage, settings last for this page view.
  }
}

function writeStored(state: FocusTimerState | null) {
  try {
    if (state) localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(FOCUS_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the timer then lasts only
    // for this page view.
  }
}

/**
 * The focus timer on tasks. The timer runs here, above every page, so it keeps going while the
 * user moves around; `FocusTimer` shows it. Finished and stopped sessions are recorded with the
 * API, which counts them towards focus achievements.
 */
export function FocusProvider({ children }: { children: ReactNode }) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const { show } = useToast();
  // False while rendering on the server and hydrating, true afterwards.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [timer, setTimer] = useState<FocusTimerState | null>(null);
  const [settings, setSettings] = useState<FocusSettings>(() => parseFocusSettings(null));
  const [loaded, setLoaded] = useState(false);

  // The saved timer and settings are read once the page has hydrated, so the server render
  // matches.
  if (hydrated && !loaded) {
    setLoaded(true);
    setTimer(readStored());
    setSettings(readSettings());
  }

  const recordSession = useMutation({
    mutationKey: FOCUS_MUTATION_KEY,
    mutationFn: ({ workspaceId, taskId, body }: FocusRecord) =>
      withToken((token) => recordFocusSession(token, workspaceId, taskId, body)),
    onSuccess: (_session, { workspaceId }) =>
      void queryClient.invalidateQueries({ queryKey: [...taskKeys.all(workspaceId), "focus"] }),
    onError: (_error, { taskTitle }) =>
      show({ message: `Couldn’t save your focus time on “${taskTitle}”.`, tone: "error" }),
  });

  function commit(next: FocusTimerState | null) {
    setTimer(next);
    writeStored(next);
  }

  const tick = useEffectEvent(() => {
    if (!timer) return;
    const now = Date.now();
    const result = advance(timer, now);
    const last = result.ended.at(-1);
    if (!last) return;
    commit(result.state);
    for (const record of result.records) recordSession.mutate(record);

    const { phases } = timer.lengths;
    const message =
      last === "focus"
        ? `Session done: ${formatFocusTime(phases.focus / 1000)} on “${timer.taskTitle}”. ` +
          `Take a ${phases[result.state.phase] / 60_000}-minute break.`
        : "Break’s over. Ready for the next session?";
    show({ message });
    // The next phase starts when the last one ended, so this says how long ago that was.
    if (now - result.state.phaseStartedAt > ALERT_WINDOW_MS) return;
    if (settings.sound) playChime();
    if (settings.notify) {
      notifyInBackground(last === "focus" ? "Focus session done" : "Break’s over", message);
    }
  });

  const running = timer?.runningSince != null;
  useEffect(() => {
    if (!running) return;
    // Checked often, so a phase ends on time even after the tab was in the background.
    const id = window.setInterval(() => tick(), 1000);
    const first = window.setTimeout(() => tick(), 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, [running]);

  const value: FocusContextValue = {
    timer,
    settings,
    saveSettings: (next) => {
      setSettings(next);
      writeSettings(next);
    },
    start: (task) => {
      const now = Date.now();
      const previous = timer ? stoppedRecord(timer, now) : null;
      if (previous) recordSession.mutate(previous);
      commit(startFocus(task, now, lengthsFrom(settings)));
    },
    pause: () => timer && commit(pause(timer, Date.now())),
    resume: () => timer && commit(resume(timer, Date.now())),
    skipBreak: () => timer && commit(skipBreak(timer, Date.now())),
    stop: () => {
      if (!timer) return;
      const record = stoppedRecord(timer, Date.now());
      if (record) recordSession.mutate(record);
      commit(null);
    },
  };

  return <FocusContext value={value}>{children}</FocusContext>;
}

export function useFocusTimer(): FocusContextValue {
  const context = useContext(FocusContext);
  if (!context) throw new Error("useFocusTimer must be used inside a FocusProvider.");
  return context;
}
