import type { Achievement } from "@orbit/contracts";
import { CircleCheck, Lock, LockKeyhole } from "lucide-react";

import { AREA_ICONS, TIER_STYLES } from "@/components/achievements/cosmetics";
import { formatUnlockedOn, isUnlocked, progressPercent, TIER_LABELS } from "@/lib/achievements";
import { cn } from "@/utils/common";

/** The round badge for an achievement: colored by tier, grey until unlocked. */
export function AchievementMedal({
  achievement,
  size = "md",
}: {
  achievement: Achievement;
  size?: "sm" | "md";
}) {
  const unlocked = isUnlocked(achievement);
  const mystery = achievement.secret && !unlocked;
  const Icon = mystery ? LockKeyhole : AREA_ICONS[achievement.area];
  const tier = TIER_STYLES[achievement.tier];
  const rare = achievement.tier === "hard" || achievement.tier === "legendary";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1",
        size === "md" ? "size-14" : "size-10",
        unlocked ? [tier.medal, tier.glow] : "bg-muted text-muted-foreground ring-border",
      )}
    >
      <Icon className={size === "md" ? "size-6" : "size-4.5"} />
      {unlocked && rare ? (
        <span className="absolute inset-y-0 left-0 w-1/3 animate-shine bg-white/35" />
      ) : null}
      {!unlocked && !mystery ? (
        <span className="absolute right-0.5 bottom-0.5 flex size-4.5 items-center justify-center rounded-full bg-card ring-1 ring-border">
          <Lock className="size-2.5" />
        </span>
      ) : null}
    </span>
  );
}

/** One achievement: what it asks, its tier and XP, and how close it is. */
export function AchievementCard({ achievement }: { achievement: Achievement }) {
  const unlocked = isUnlocked(achievement);
  const percent = progressPercent(achievement);
  const tier = TIER_STYLES[achievement.tier];

  return (
    <article
      aria-label={`${achievement.title}, ${unlocked ? "unlocked" : "locked"}`}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2",
        unlocked && achievement.tier === "legendary" && "border-event-violet/40",
        unlocked && achievement.tier === "hard" && "border-event-amber/40",
      )}
    >
      <div className="flex items-start gap-3">
        <AchievementMedal achievement={achievement} />
        <div className="ml-auto flex flex-col items-end gap-1">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tier.chip)}>
            {TIER_LABELS[achievement.tier]}
          </span>
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
            {unlocked ? `+${achievement.earned_xp ?? achievement.xp}` : achievement.xp} XP
          </span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <h3 className={cn("font-semibold text-pretty", !unlocked && "text-foreground/80")}>
          {achievement.title}
        </h3>
        <p className="text-sm text-pretty text-muted-foreground">{achievement.description}</p>
      </div>

      {unlocked && achievement.unlocked_at ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
          <CircleCheck className="size-3.5" aria-hidden="true" />
          Unlocked {formatUnlockedOn(achievement.unlocked_at)}
        </p>
      ) : achievement.secret ? (
        <p className="text-xs text-muted-foreground">Hidden until you find it</p>
      ) : (
        <div className="space-y-1.5">
          <div
            role="progressbar"
            aria-label={`${achievement.title} progress`}
            aria-valuemin={0}
            aria-valuemax={achievement.target}
            aria-valuenow={achievement.current}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", tier.bar)}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {achievement.current.toLocaleString()} / {achievement.target.toLocaleString()}
          </p>
        </div>
      )}
    </article>
  );
}
