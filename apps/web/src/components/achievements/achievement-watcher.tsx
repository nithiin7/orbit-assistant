"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trophy, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ACHIEVEMENT_MUTATION_KEY } from "@/api/achievements";
import { ConfettiBurst } from "@/components/achievements/cosmetics";
import { Button } from "@/components/ui/button";
import { useAchievementCheck } from "@/hooks/use-achievements";
import { profileHref, unlockCheer } from "@/lib/achievements";
import { cn } from "@/utils/common";

/** Wait this long after a change before checking, so a burst of edits makes one check. */
export const CHECK_DELAY_MS = 1200;

type Cheer = NonNullable<ReturnType<typeof unlockCheer>> & { id: number; confetti: string | null };

function isAchievementMutation(key: readonly unknown[] | undefined): boolean {
  return ACHIEVEMENT_MUTATION_KEY.every((part, index) => key?.[index] === part);
}

/**
 * Checks achievements once the user is signed in and again shortly after anything they change
 * succeeds (a task done, a habit checked off, a place added), and celebrates what unlocks.
 * Render once, inside the signed-in app.
 */
export function AchievementWatcher() {
  const queryClient = useQueryClient();
  const check = useAchievementCheck();
  const [cheer, setCheer] = useState<Cheer | null>(null);
  const count = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);

  const runCheck = useEffectEvent(() => {
    check.mutate(undefined, {
      onSuccess: (profile) => {
        const next = unlockCheer(profile);
        if (!next) return;
        window.clearTimeout(hideTimer.current);
        count.current += 1;
        setCheer({ ...next, id: count.current, confetti: profile.equipped.confetti });
        hideTimer.current = window.setTimeout(() => setCheer(null), next.big ? 6500 : 5000);
      },
      // A failed check is quiet: the next change, or the next visit, checks again.
    });
  });

  useEffect(() => {
    runCheck();
    let timer: number | undefined;
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (isAchievementMutation(event.mutation.options.mutationKey)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(runCheck, CHECK_DELAY_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.clearTimeout(hideTimer.current);
    };
  }, [queryClient]);

  return (
    // The live region stays mounted so screen readers announce each unlock.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      {cheer ? (
        <div
          key={cheer.id}
          className={cn(
            "pointer-events-auto relative flex w-full max-w-md animate-celebrate-in items-center gap-3 overflow-hidden rounded-2xl border bg-card py-3 pr-2 pl-3 shadow-elevation-3",
            cheer.big && "border-event-amber/50",
          )}
        >
          <ConfettiBurst style={cheer.confetti} big={cheer.big} />
          <span
            aria-hidden="true"
            className={cn(
              "relative flex size-12 shrink-0 animate-check-pop items-center justify-center overflow-hidden rounded-full ring-1",
              cheer.big
                ? "bg-linear-to-br from-event-amber/30 to-event-orange/40 text-event-orange ring-event-amber/40"
                : "bg-linear-to-br from-brand-subtle to-event-violet/20 text-brand ring-brand/20",
            )}
          >
            <Trophy className="size-6" />
            <span className="absolute inset-y-0 left-0 w-1/3 animate-shine bg-white/40" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-pretty">{cheer.title}</p>
            <p className="text-sm text-pretty text-muted-foreground">
              {cheer.message} <span className="font-semibold text-brand">+{cheer.xp} XP</span>
            </p>
          </div>
          <Link
            href={profileHref("achievements")}
            onClick={() => setCheer(null)}
            className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-brand outline-none hover:bg-brand-subtle focus-visible:ring-2 focus-visible:ring-ring"
          >
            View
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 self-start"
            aria-label="Dismiss"
            onClick={() => setCheer(null)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
