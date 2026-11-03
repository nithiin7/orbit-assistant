"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Cheer } from "@/lib/habits";
import { cn } from "@/utils/common";

/** Where each piece flies, and its color. Written out in full so Tailwind sees every class. */
const CONFETTI = [
  "[--confetti-x:-72px] [--confetti-y:-64px] bg-event-rose",
  "[--confetti-x:-44px] [--confetti-y:-92px] bg-event-amber delay-75",
  "[--confetti-x:-12px] [--confetti-y:-104px] bg-event-blue",
  "[--confetti-x:20px] [--confetti-y:-96px] bg-event-green delay-75",
  "[--confetti-x:52px] [--confetti-y:-80px] bg-event-violet",
  "[--confetti-x:80px] [--confetti-y:-56px] bg-event-orange delay-100",
  "[--confetti-x:-96px] [--confetti-y:-28px] bg-event-teal delay-100",
  "[--confetti-x:100px] [--confetti-y:-24px] bg-event-rose delay-75",
] as const;

/** Extra pieces for big moments: a streak milestone or a finished day. */
const CONFETTI_BIG = [
  "[--confetti-x:-128px] [--confetti-y:-88px] bg-event-amber delay-150",
  "[--confetti-x:-84px] [--confetti-y:-128px] bg-event-green delay-200",
  "[--confetti-x:-32px] [--confetti-y:-140px] bg-event-rose delay-150",
  "[--confetti-x:36px] [--confetti-y:-136px] bg-event-violet delay-200",
  "[--confetti-x:88px] [--confetti-y:-120px] bg-event-blue delay-150",
  "[--confetti-x:132px] [--confetti-y:-80px] bg-event-teal delay-200",
  "[--confetti-x:-148px] [--confetti-y:-40px] bg-event-orange delay-300",
  "[--confetti-x:150px] [--confetti-y:-36px] bg-event-amber delay-300",
] as const;

type Shown = Cheer & { id: number };

/**
 * A short, cheerful toast when a habit's day is done. `celebrate` shows one (replacing any on
 * screen); render `celebration` once, anywhere in the view.
 */
export function useCelebration() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const count = useRef(0);

  function dismiss() {
    window.clearTimeout(timer.current);
    setShown(null);
  }

  function celebrate(cheer: Cheer) {
    window.clearTimeout(timer.current);
    count.current += 1;
    setShown({ ...cheer, id: count.current });
    timer.current = window.setTimeout(() => setShown(null), cheer.big ? 5000 : 3500);
  }

  return {
    celebrate,
    celebration: <CelebrationToast shown={shown} onDismiss={dismiss} />,
  };
}

function CelebrationToast({ shown, onDismiss }: { shown: Shown | null; onDismiss: () => void }) {
  return (
    // The live region stays mounted so screen readers announce each new cheer.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      {shown ? (
        <div
          key={shown.id}
          className={cn(
            "pointer-events-auto relative flex w-full max-w-sm animate-celebrate-in items-center gap-3 rounded-2xl border bg-card py-3 pr-2 pl-3 shadow-elevation-3",
            shown.big && "border-success/40",
          )}
        >
          <span aria-hidden="true" className="absolute top-1/2 left-1/2">
            {[...CONFETTI, ...(shown.big ? CONFETTI_BIG : [])].map((piece) => (
              <span
                key={piece}
                className={cn("absolute size-2 animate-confetti rounded-[2px]", piece)}
              />
            ))}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "flex size-11 shrink-0 animate-check-pop items-center justify-center rounded-full text-2xl",
              shown.big ? "bg-success/15" : "bg-brand-subtle",
            )}
          >
            {shown.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{shown.title}</p>
            <p className="text-sm text-pretty text-muted-foreground">{shown.message}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 self-start"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
