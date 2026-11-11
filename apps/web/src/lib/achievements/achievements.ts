/** Profile views, achievement progress, and XP store rules. The API owns unlocking and prices;
 * these only arrange and describe what it returns. */

import type {
  Achievement,
  AchievementArea,
  AchievementProfile,
  AchievementTier,
  RewardItem,
  RewardSlot,
} from "@orbit/contracts";

import { type Option } from "@/utils/common";

// Views

export type ProfileView = "overview" | "achievements" | "store" | "collection";

export const PROFILE_VIEWS: readonly Option<ProfileView>[] = [
  { value: "overview", label: "Overview" },
  { value: "achievements", label: "Achievements" },
  { value: "store", label: "XP store" },
  { value: "collection", label: "Collection" },
];

export function parseProfileView(params: URLSearchParams): ProfileView {
  const view = params.get("view");
  return PROFILE_VIEWS.find((option) => option.value === view)?.value ?? "overview";
}

export function profileHref(view: ProfileView = "overview"): string {
  return view === "overview" ? "/profile" : `/profile?view=${view}`;
}

// Tiers and areas

export const TIERS: readonly AchievementTier[] = ["easy", "medium", "hard", "legendary"];

export const TIER_LABELS: Record<AchievementTier, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  legendary: "Legendary",
};

export const AREA_LABELS: Record<AchievementArea, string> = {
  tasks: "Tasks",
  habits: "Habits",
  notes: "Notes",
  shopping: "Shopping",
  reminders: "Reminders",
  calendar: "Calendar",
  documents: "Documents",
  places: "Places",
  watchlist: "Watchlist",
  saved: "Saved",
  finance: "Finance",
  health: "Health",
  orbit: "Across Orbit",
};

/** Areas in the order the grid shows them. */
export const AREAS = Object.keys(AREA_LABELS) as AchievementArea[];

// Progress

export function isUnlocked(achievement: Achievement): boolean {
  return achievement.unlocked_at !== null;
}

/** 0 to 100. */
export function progressPercent(achievement: Achievement): number {
  if (isUnlocked(achievement)) return 100;
  return Math.min(100, Math.round((achievement.current / achievement.target) * 100));
}

/** Locked achievements closest to unlocking: furthest along first, then the cheapest. Secrets
 * stay out, since their progress is hidden. */
export function nextUp(achievements: readonly Achievement[], limit = 4): Achievement[] {
  return achievements
    .filter((achievement) => !isUnlocked(achievement) && !achievement.secret)
    .sort(
      (a, b) =>
        progressPercent(b) - progressPercent(a) ||
        TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) ||
        a.xp - b.xp,
    )
    .slice(0, limit);
}

/** Unlocked achievements, newest first. */
export function recentUnlocks(achievements: readonly Achievement[], limit = 6): Achievement[] {
  return achievements
    .filter(isUnlocked)
    .sort((a, b) => (b.unlocked_at ?? "").localeCompare(a.unlocked_at ?? ""))
    .slice(0, limit);
}

export type TierCount = { tier: AchievementTier; unlocked: number; total: number };

export function tierCounts(achievements: readonly Achievement[]): TierCount[] {
  return TIERS.map((tier) => {
    const inTier = achievements.filter((achievement) => achievement.tier === tier);
    return { tier, unlocked: inTier.filter(isUnlocked).length, total: inTier.length };
  });
}

/** How far through the current level, 0 to 100. */
export function levelPercent(profile: AchievementProfile): number {
  const { floor_xp, next_xp } = profile.level;
  const span = next_xp - floor_xp;
  return span <= 0 ? 100 : Math.round(((profile.earned_xp - floor_xp) / span) * 100);
}

export type StatusFilter = "all" | "unlocked" | "locked";

export const STATUS_FILTERS: readonly Option<StatusFilter>[] = [
  { value: "all", label: "All" },
  { value: "unlocked", label: "Unlocked" },
  { value: "locked", label: "Locked" },
];

export type AchievementFilter = { tier: AchievementTier | "all"; status: StatusFilter };

export function filterAchievements(
  achievements: readonly Achievement[],
  { tier, status }: AchievementFilter,
): Achievement[] {
  return achievements.filter(
    (achievement) =>
      (tier === "all" || achievement.tier === tier) &&
      (status === "all" || (status === "unlocked") === isUnlocked(achievement)),
  );
}

export function groupByArea(
  achievements: readonly Achievement[],
): { area: AchievementArea; achievements: Achievement[] }[] {
  return AREAS.map((area) => ({
    area,
    achievements: achievements.filter((achievement) => achievement.area === area),
  })).filter((group) => group.achievements.length > 0);
}

/** A toast for what a check just unlocked, or `null` when nothing did. */
export function unlockCheer(
  profile: AchievementProfile,
): { title: string; message: string; xp: number; big: boolean } | null {
  const unlocked = profile.achievements.filter((a) => profile.new_unlocks.includes(a.key));
  const [first] = unlocked;
  if (!first) return null;
  const xp = unlocked.reduce((sum, achievement) => sum + (achievement.earned_xp ?? 0), 0);
  const big = unlocked.some((a) => a.tier === "hard" || a.tier === "legendary");
  if (unlocked.length === 1) {
    return { title: `Achievement unlocked: ${first.title}`, message: first.description, xp, big };
  }
  return {
    title: `${unlocked.length} achievements unlocked`,
    message: `${first.title} and ${unlocked.length - 1} more.`,
    xp,
    big,
  };
}

export function formatUnlockedOn(at: string): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// The store

export const SLOTS: readonly RewardSlot[] = ["frame", "banner", "title", "confetti"];

export const SLOT_LABELS: Record<RewardSlot, { label: string; description: string }> = {
  frame: { label: "Avatar frames", description: "A ring around your photo, everywhere it shows." },
  banner: { label: "Profile banners", description: "The backdrop at the top of your profile." },
  title: { label: "Titles", description: "A title under your name." },
  confetti: { label: "Confetti", description: "How unlocks and finished habits celebrate." },
};

export type RewardState = "equipped" | "owned" | "locked" | "short" | "available";

/** What the store can do with an item for this profile. */
export function rewardState(item: RewardItem, profile: AchievementProfile): RewardState {
  if (item.equipped) return "equipped";
  if (item.owned) return "owned";
  if (profile.level.level < item.min_level) return "locked";
  if (profile.balance < item.cost) return "short";
  return "available";
}

export function rewardName(profile: AchievementProfile | undefined, key: string | null) {
  return key ? (profile?.store.find((item) => item.key === key)?.name ?? null) : null;
}
