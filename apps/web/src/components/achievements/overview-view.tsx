import type { AchievementProfile } from "@orbit/contracts";
import { ArrowRight, Gem, Target, Trophy } from "lucide-react";
import Link from "next/link";

import { AchievementCard, AchievementMedal } from "@/components/achievements/achievement-card";
import { TIER_STYLES } from "@/components/achievements/cosmetics";
import {
  formatUnlockedOn,
  nextUp,
  profileHref,
  recentUnlocks,
  rewardState,
  TIER_LABELS,
  tierCounts,
} from "@/lib/achievements";
import { cn } from "@/utils/common";

/** What's close, what's new, and how each difficulty is going. */
export function OverviewView({ profile }: { profile: AchievementProfile }) {
  const upcoming = nextUp(profile.achievements);
  const recent = recentUnlocks(profile.achievements);
  const affordable = profile.store.filter((item) => rewardState(item, profile) === "available");

  return (
    <div className="space-y-8">
      {affordable.length > 0 ? (
        <Link
          href={profileHref("store")}
          className="group flex items-center gap-4 rounded-2xl border border-brand/25 bg-linear-to-r from-brand-subtle to-event-violet/10 p-4 outline-none hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground">
            <Gem className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              You can afford {affordable.length} {affordable.length === 1 ? "item" : "items"}
            </span>
            <span className="block text-sm text-muted-foreground">
              {profile.balance.toLocaleString()} XP to spend on frames, banners, and more.
            </span>
          </span>
          <ArrowRight
            className="size-4 text-brand transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      ) : null}

      <section aria-labelledby="next-up" className="space-y-3">
        <SectionHeading id="next-up" icon={Target} title="Closest to unlocking" />
        {upcoming.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            {upcoming.map((achievement) => (
              <AchievementCard key={achievement.key} achievement={achievement} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Every achievement you can see is unlocked. Impressive.
          </p>
        )}
      </section>

      <div className="grid gap-8 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="recent" className="space-y-3">
          <SectionHeading id="recent" icon={Trophy} title="Recently unlocked" />
          {recent.length > 0 ? (
            <ul className="divide-y rounded-2xl border bg-card">
              {recent.map((achievement) => (
                <li key={achievement.key} className="flex items-center gap-3 px-4 py-3">
                  <AchievementMedal achievement={achievement} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{achievement.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {achievement.unlocked_at ? formatUnlockedOn(achievement.unlocked_at) : null}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-brand tabular-nums">
                    +{achievement.earned_xp ?? achievement.xp} XP
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-pretty text-muted-foreground">
              Nothing yet. Finish a task, check off a habit, or pin a place you’ve been to unlock
              your first one.
            </p>
          )}
        </section>

        <section aria-labelledby="by-tier" className="space-y-3">
          <SectionHeading id="by-tier" icon={Trophy} title="By difficulty" />
          <ul className="space-y-4 rounded-2xl border bg-card p-4">
            {tierCounts(profile.achievements).map(({ tier, unlocked, total }) => (
              <li key={tier} className="space-y-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{TIER_LABELS[tier]}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {unlocked} / {total}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${TIER_LABELS[tier]} achievements unlocked`}
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={unlocked}
                  className="h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={cn("h-full rounded-full", TIER_STYLES[tier].bar)}
                    style={{ width: `${total ? (unlocked / total) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function SectionHeading({
  id,
  icon: Icon,
  title,
}: {
  id: string;
  icon: typeof Trophy;
  title: string;
}) {
  return (
    <h3 id={id} className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
      {title}
    </h3>
  );
}
