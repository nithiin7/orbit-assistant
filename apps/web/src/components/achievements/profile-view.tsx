"use client";

import { useSearchParams } from "next/navigation";

import { AchievementsGrid } from "@/components/achievements/achievements-grid";
import { OverviewView } from "@/components/achievements/overview-view";
import { ProfileHero } from "@/components/achievements/profile-hero";
import { ProfileNav, VIEW_ICONS } from "@/components/achievements/profile-nav";
import { RewardShelf } from "@/components/achievements/reward-shelf";
import { LoadError } from "@/components/finance/panel";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useAchievements } from "@/hooks/use-achievements";
import { isUnlocked, parseProfileView, PROFILE_VIEWS } from "@/lib/achievements";

/** The profile: a hero with level and XP, then a side rail of views. The view is in the URL. */
export function ProfilePanel() {
  const view = parseProfileView(useSearchParams());
  const { state, retry } = useAchievements();
  const ViewIcon = VIEW_ICONS[view];

  if (state.status === "loading") {
    // The same hero, rail, and view heading as the loaded page, so it fills in without moving.
    return (
      <div
        className="@container/profile space-y-8"
        aria-busy="true"
        aria-label="Loading your profile"
      >
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-2xl border bg-card shadow-elevation-1"
        >
          <Skeleton className="h-32 rounded-none @3xl/profile:h-44" />
          <div className="relative px-5 pb-6 @3xl/profile:px-8">
            <div className="-mt-12 flex flex-wrap items-end gap-x-5 gap-y-3 @3xl/profile:-mt-14">
              <span className="rounded-full bg-card p-1 shadow-elevation-2">
                <Skeleton className="size-[7.625rem] rounded-full" />
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <SkeletonText className="w-48 text-2xl @3xl/profile:text-3xl" />
                <SkeletonText className="mt-0.5 w-72 text-sm" />
              </div>
            </div>
            <div className="mt-6 space-y-2">
              <SkeletonText className="w-24 text-sm" />
              <Skeleton className="h-3 rounded-full" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 @3xl/profile:grid-cols-4">
              {[0, 1, 2, 3].map((tile) => (
                <div key={tile} className="rounded-xl border p-4">
                  <SkeletonText className="w-16 text-xs" />
                  <SkeletonText className="mt-1 w-10 text-2xl leading-tight" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-6 @5xl/profile:grid-cols-[13rem_minmax(0,1fr)] @5xl/profile:gap-8 @7xl/profile:grid-cols-[15rem_minmax(0,1fr)] @7xl/profile:gap-12">
          <aside className="min-w-0 @5xl/profile:sticky @5xl/profile:top-6 @5xl/profile:self-start">
            <ProfileNav view={view} />
          </aside>
          <div key={view} className="@container min-w-0 animate-page-in space-y-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <ViewIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {PROFILE_VIEWS.find((option) => option.value === view)?.label}
            </h2>
            <div
              aria-hidden="true"
              className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4"
            >
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-44 rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <LoadError message={state.message} onRetry={retry} />
      </div>
    );
  }

  const profile = state.data;
  const unlocked = profile.achievements.filter(isUnlocked).length;
  const owned = profile.store.filter((item) => item.owned).length;

  return (
    // Layout follows the space the page gets (which depends on the app sidebar), not the screen.
    <div className="@container/profile space-y-8">
      <ProfileHero profile={profile} />
      <div className="grid gap-6 @5xl/profile:grid-cols-[13rem_minmax(0,1fr)] @5xl/profile:gap-8 @7xl/profile:grid-cols-[15rem_minmax(0,1fr)] @7xl/profile:gap-12">
        <aside className="min-w-0 @5xl/profile:sticky @5xl/profile:top-6 @5xl/profile:self-start">
          <ProfileNav
            view={view}
            counts={{
              achievements: `${unlocked}/${profile.achievements.length}`,
              collection: owned > 0 ? String(owned) : undefined,
            }}
          />
        </aside>
        <div key={view} className="@container min-w-0 animate-page-in space-y-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ViewIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {PROFILE_VIEWS.find((option) => option.value === view)?.label}
          </h2>
          {view === "overview" ? <OverviewView profile={profile} /> : null}
          {view === "achievements" ? <AchievementsGrid profile={profile} /> : null}
          {view === "store" ? <RewardShelf profile={profile} mode="store" /> : null}
          {view === "collection" ? <RewardShelf profile={profile} mode="collection" /> : null}
        </div>
      </div>
    </div>
  );
}
