"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";

import { ConfettiBurst } from "@/components/achievements/cosmetics";
import { Button } from "@/components/ui/button";
import { useEquippedRewards } from "@/hooks/use-achievements";
import type { Cheer } from "@/lib/habits";
import { cn } from "@/utils/common";

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
  // The confetti style bought in the XP store, if any.
  const confetti = useEquippedRewards()?.confetti ?? null;
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
          <ConfettiBurst style={confetti} big={shown.big} />
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
