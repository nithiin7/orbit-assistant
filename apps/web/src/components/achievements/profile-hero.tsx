"use client";

import type { AchievementProfile } from "@orbit/contracts";
import { Gem, Sparkles, Trophy } from "lucide-react";

import { bannerStyle } from "@/components/achievements/cosmetics";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { isUnlocked, levelPercent, rewardName } from "@/lib/achievements";
import { useCurrentUser } from "@/providers/auth";
import { cn } from "@/utils/common";

/** The top of the profile: banner, framed photo, name and title, level, and XP. */
export function ProfileHero({ profile }: { profile: AchievementProfile }) {
  const user = useCurrentUser();
  const banner = bannerStyle(profile.equipped.banner);
  const title = rewardName(profile, profile.equipped.title);
  const unlocked = profile.achievements.filter(isUnlocked).length;
  const percent = levelPercent(profile);
  const toNext = profile.level.next_xp - profile.earned_xp;

  return (
    <section
      aria-labelledby="profile-name"
      className="overflow-hidden rounded-2xl border bg-card shadow-elevation-1"
    >
      <div
        aria-hidden="true"
        className={cn("relative h-32 @3xl/profile:h-44", banner.drift && "animate-drift")}
        style={banner.style}
      >
        <div className="absolute inset-0 bg-linear-to-t from-card/70 via-transparent to-transparent" />
      </div>

      <div className="relative px-5 pb-6 @3xl/profile:px-8">
        <div className="-mt-12 flex flex-wrap items-end gap-x-5 gap-y-3 @3xl/profile:-mt-14">
          <span className="rounded-full bg-card p-1 shadow-elevation-2">
            <UserAvatar size="xl" />
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <h1
              id="profile-name"
              className="truncate text-2xl font-semibold tracking-tight @3xl/profile:text-3xl"
            >
              {user.display_name}
            </h1>
            {title ? (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-2.5 py-0.5 text-sm font-medium text-brand">
                <Sparkles className="size-3.5" aria-hidden="true" />
                {title}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Unlock achievements by using Orbit, then spend XP in the store.
              </p>
            )}
          </div>
          <LevelBadge level={profile.level.level} />
        </div>

        <div className="mt-6 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">Level {profile.level.level}</span>
            <span className="text-muted-foreground tabular-nums">
              {toNext} XP to level {profile.level.level + 1}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Progress to the next level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-3 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="relative h-full overflow-hidden rounded-full bg-linear-to-r from-brand via-event-violet to-event-rose transition-[width] duration-700"
              style={{ width: `${Math.max(percent, 2)}%` }}
            >
              <span className="absolute inset-y-0 left-0 w-1/4 animate-shine bg-white/30" />
            </div>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 @3xl/profile:grid-cols-4">
          <Stat icon={Sparkles} label="XP earned" value={profile.earned_xp.toLocaleString()} />
          <Stat icon={Gem} label="XP to spend" value={profile.balance.toLocaleString()} accent />
          <Stat
            icon={Trophy}
            label="Unlocked"
            value={`${unlocked} / ${profile.achievements.length}`}
          />
          <Stat
            icon={Trophy}
            label="Legendary"
            value={String(
              profile.achievements.filter((a) => a.tier === "legendary" && isUnlocked(a)).length,
            )}
          />
        </dl>
      </div>
    </section>
  );
}

function LevelBadge({ level }: { level: number }) {
  return (
    <div
      aria-hidden="true"
      className="relative flex size-16 shrink-0 flex-col items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br from-brand to-event-violet text-white shadow-elevation-2"
    >
      <span className="text-[0.625rem] font-semibold tracking-widest uppercase opacity-80">
        Level
      </span>
      <span className="text-2xl leading-none font-bold tabular-nums">{level}</span>
      <span className="absolute inset-y-0 left-0 w-1/3 animate-shine bg-white/25" />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: typeof Gem;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        accent ? "border-brand/25 bg-brand-subtle" : "bg-background/60",
      )}
    >
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn("size-3.5", accent && "text-brand")} aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-xl font-semibold tracking-tight tabular-nums",
          accent && "text-brand",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
