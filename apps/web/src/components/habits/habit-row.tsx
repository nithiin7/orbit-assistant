"use client";

import type { HabitProgress, LogHabitRequest } from "@orbit/contracts";
import { Check, Flame, MoreHorizontal, Plus, SkipForward, Undo2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import {
  describeProgress,
  describeSchedule,
  describeStreak,
  describeTarget,
  habitsHref,
  progressFraction,
  STATE_LABELS,
} from "@/lib/habits";
import { cn } from "@/utils/common";

import { COLOR_STYLES, HabitTile, ProgressBar } from "./habit-icon";

type HabitRowProps = {
  item: HabitProgress;
  /** Record the day, or undo it (`null`). Rejections are shown in the row. */
  onLog: (body: LogHabitRequest | null) => Promise<unknown>;
};

/**
 * One habit on a day, with a one-tap check: done or undone for yes-or-no habits, or the whole
 * target for amounts and durations, which can also record partial progress inline.
 */
export function HabitRow({ item, onLog }: HabitRowProps) {
  const id = useId();
  const { habit, state, log } = item;
  const [recording, setRecording] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = state === "completed" || state === "bonus";
  const measured = habit.kind !== "boolean";
  const target = describeTarget(habit);

  async function run(body: LogHabitRequest | null) {
    setBusy(true);
    setError(null);
    try {
      await onLog(body);
      setRecording(false);
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function submitAmount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value < 0) {
      setError("Enter a number.");
      return;
    }
    void run({ status: "progress", value, note: log?.note ?? "" });
  }

  const subtitle = [
    measured && log && log.status !== "skipped" && !done
      ? describeProgress(habit, log.value)
      : target,
    describeSchedule(habit.schedule),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className={cn(
        "group/row rounded-lg border bg-card px-3 py-2.5 transition-colors duration-150",
        done && "bg-success/5",
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || state === "paused"}
          aria-pressed={done}
          aria-label={done ? `Undo ${habit.name}` : `Mark ${habit.name} done`}
          onClick={() =>
            void run(done ? null : { status: "completed", value: null, note: log?.note ?? "" })
          }
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color,scale] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-50",
            done
              ? cn("border-transparent text-white", COLOR_STYLES[habit.color].fill)
              : "border-input hover:border-brand/60",
          )}
        >
          <Check
            aria-hidden="true"
            strokeWidth={3}
            className={cn("size-4 transition-opacity", done ? "opacity-100" : "opacity-0")}
          />
        </button>
        <HabitTile icon={habit.icon} color={habit.color} className="hidden @md/rows:flex" />
        <div className="min-w-0 flex-1">
          <Link
            href={habitsHref({ kind: "habit", id: habit.id })}
            className="block truncate text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {habit.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span
          className={cn(
            "hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium @sm/rows:inline",
            done
              ? "bg-success/10 text-success"
              : state === "partial"
                ? "bg-brand-subtle text-brand"
                : "bg-muted text-muted-foreground",
          )}
        >
          {STATE_LABELS[state]}
        </span>
        {item.current_streak > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
            title={`Current streak: ${describeStreak(item.current_streak, item.streak_unit)}`}
          >
            <Flame className="size-3.5 text-event-orange" aria-hidden="true" />
            <span className="sr-only">Streak </span>
            {item.current_streak}
            <span className="sr-only"> {item.streak_unit}s</span>
          </span>
        ) : null}
        <Menu
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          aria-label={`More actions for ${habit.name}`}
          className="size-8"
          items={[
            ...(measured
              ? [
                  {
                    id: "record",
                    label: "Record progress",
                    icon: Plus,
                    onSelect: () => {
                      setAmount(log && log.status !== "skipped" ? String(log.value) : "");
                      setRecording(true);
                    },
                  },
                ]
              : []),
            {
              id: "skip",
              label: "Skip today",
              description: "Doesn’t break your streak.",
              icon: SkipForward,
              disabled: state === "skipped" || state === "paused",
              onSelect: () => void run({ status: "skipped", value: null, note: log?.note ?? "" }),
            },
            {
              id: "undo",
              label: "Clear today",
              icon: Undo2,
              disabled: log === null,
              onSelect: () => void run(null),
            },
          ]}
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </div>
      {measured && (state === "partial" || recording) && !done ? (
        <ProgressBar
          className="mt-2"
          value={progressFraction(item)}
          color={habit.color}
          label={`${habit.name} progress`}
        />
      ) : null}
      {recording ? (
        <form onSubmit={submitAmount} className="mt-2 flex items-center gap-2">
          <label htmlFor={`${id}-amount`} className="sr-only">
            {habit.kind === "duration" ? "Minutes" : habit.unit || "Amount"} for {habit.name}
          </label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={habit.kind === "duration" ? "Minutes" : habit.unit || "Amount"}
            className="h-8 w-28"
          />
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRecording(false)}>
            Cancel
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
