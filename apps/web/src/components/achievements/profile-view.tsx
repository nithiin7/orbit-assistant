"use client";

import { useSearchParams } from "next/navigation";

import { AchievementsGrid } from "@/components/achievements/achievements-grid";
import { OverviewView } from "@/components/achievements/overview-view";
import { ProfileHero } from "@/components/achievements/profile-hero";
import { ProfileNav, VIEW_ICONS } from "@/components/achievements/profile-nav";
import { RewardShelf } from "@/components/achievements/reward-shelf";
import { LoadError } from "@/components/finance/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useAchievements } from "@/hooks/use-achievements";
import { isUnlocked, parseProfileView, PROFILE_VIEWS } from "@/lib/achievements";

/** The profile: a hero with level and XP, then a side rail of views. The view is in the URL. */
export function ProfilePanel() {
  const view = parseProfileView(useSearchParams());
  const { state, retry } = useAchievements();
  const ViewIcon = VIEW_ICONS[view];

  if (state.status === "loading") {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading your profile">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-44 rounded-2xl" />
          ))}
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
