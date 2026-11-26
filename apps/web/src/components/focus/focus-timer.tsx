"use client";

import { Coffee, Pause, Play, Settings2, SkipForward, Square, Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type FocusTimerState,
  formatCountdown,
  PHASE_LABELS,
  phaseLengthMs,
  remainingMs,
} from "@/lib/focus";
import { useFocusTimer } from "@/providers/focus";
import { cn } from "@/utils/common";

import { FocusSettingsDialog } from "./focus-settings-dialog";

const RING_RADIUS = 20;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** What a timer shows right now, re-rendered every second while it runs. */
export function useFocusClock(timer: FocusTimerState | null) {
  const [now, setNow] = useState(() => Date.now());
  const running = timer?.runningSince != null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (!timer) return null;
  // `now` can trail a timer that was just started or resumed; it never reads before that.
  const left = remainingMs(timer, running ? Math.max(now, timer.runningSince ?? 0) : now);
  const onBreak = timer.phase !== "focus";
  const perLongBreak = timer.lengths.sessionsPerLongBreak;
  return {
    left,
    length: phaseLengthMs(timer),
    running,
    onBreak,
    waiting: !running && timer.elapsedMs === 0,
    round: (timer.finished % perLongBreak) + (onBreak ? 0 : 1),
    perLongBreak,
  };
}

/** The phase's progress as a ring, with a timer or coffee cup in the middle. */
export function FocusRing({
  left,
  length,
  onBreak,
  className,
}: {
  left: number;
  length: number;
  onBreak: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative grid size-12 shrink-0 place-items-center", className)}>
      <svg viewBox="0 0 48 48" aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle
          cx="24"
          cy="24"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="4"
          className="stroke-muted"
        />
        <circle
          cx="24"
          cy="24"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (left / length)}
          className={cn(
            "transition-[stroke-dashoffset] duration-1000 ease-linear",
            onBreak ? "stroke-success" : "stroke-brand",
          )}
        />
      </svg>
      {onBreak ? (
        <Coffee aria-hidden="true" className="size-4 text-success" />
      ) : (
        <Timer aria-hidden="true" className="size-4 text-brand" />
      )}
    </div>
  );
}

/** Pause or resume, skip a break, and stop. */
export function FocusControls({
  running,
  waiting,
  onBreak,
}: {
  running: boolean;
  waiting: boolean;
  onBreak: boolean;
}) {
  const { pause, resume, skipBreak, stop } = useFocusTimer();
  return (
    <>
      {running ? (
        <Button variant="ghost" size="icon" aria-label="Pause" onClick={pause} className="size-8">
          <Pause aria-hidden="true" />
        </Button>
      ) : (
        <Button
          variant="soft"
          size="icon"
          aria-label={waiting ? "Start the next session" : "Resume"}
          onClick={resume}
          className="size-8"
        >
          <Play aria-hidden="true" />
        </Button>
      )}
      {onBreak ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Skip the break"
          onClick={skipBreak}
          className="size-8"
        >
          <SkipForward aria-hidden="true" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Stop the focus timer"
        onClick={stop}
        className="size-8 text-muted-foreground"
      >
        <Square aria-hidden="true" />
      </Button>
    </>
  );
}

/** Opens the focus timer settings. */
export function FocusSettingsButton({ className }: { className?: string }) {
  const { timer, settings, saveSettings } = useFocusTimer();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Focus timer settings"
        onClick={() => setOpen(true)}
        className={cn("size-8 text-muted-foreground", className)}
      >
        <Settings2 aria-hidden="true" />
      </Button>
      {open ? (
        <FocusSettingsDialog
          settings={settings}
          running={timer !== null}
          onSave={saveSettings}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** The phase, the session's place in the cycle, and whether it's paused. */
export function FocusStatus({
  timer,
  clock,
}: {
  timer: FocusTimerState;
  clock: NonNullable<ReturnType<typeof useFocusClock>>;
}) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{PHASE_LABELS[timer.phase]}</span>
      <span aria-hidden="true">·</span>
      <span>
        {clock.round} of {clock.perLongBreak}
      </span>
      {!clock.running && !clock.waiting ? <span>· Paused</span> : null}
    </p>
  );
}

/**
 * The running focus timer, in the corner of every page. Render once, inside `FocusProvider`;
 * it shows nothing while no timer is running.
 */
export function FocusTimer() {
  const { timer } = useFocusTimer();
  const clock = useFocusClock(timer);
  if (!timer || !clock) return null;

  return (
    <section
      aria-label="Focus timer"
      className="fixed right-4 bottom-20 z-40 flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl border bg-card p-3 shadow-elevation-3 sm:bottom-6"
    >
      <FocusRing left={clock.left} length={clock.length} onBreak={clock.onBreak} />
      <div className="min-w-0 flex-1">
        <FocusStatus timer={timer} clock={clock} />
        <p role="timer" className="text-xl font-semibold tabular-nums">
          {formatCountdown(clock.left)}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={timer.taskTitle}>
          {timer.taskTitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <FocusControls running={clock.running} waiting={clock.waiting} onBreak={clock.onBreak} />
        <FocusSettingsButton />
      </div>
    </section>
  );
}
