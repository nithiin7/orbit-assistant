"use client";

import type { AchievementProfile, AchievementTier } from "@orbit/contracts";
import { SearchX } from "lucide-react";
import { useState } from "react";

import { AchievementCard } from "@/components/achievements/achievement-card";
import { AREA_ICONS } from "@/components/achievements/cosmetics";
import {
  type AchievementFilter,
  AREA_LABELS,
  filterAchievements,
  groupByArea,
  isUnlocked,
  STATUS_FILTERS,
  TIER_LABELS,
  TIERS,
} from "@/lib/achievements";
import { cn } from "@/utils/common";

const TIER_FILTERS: readonly { value: AchievementTier | "all"; label: string }[] = [
  { value: "all", label: "All tiers" },
  ...TIERS.map((tier) => ({ value: tier, label: TIER_LABELS[tier] })),
];

/** Every achievement, grouped by where in Orbit it comes from, with tier and status filters. */
export function AchievementsGrid({ profile }: { profile: AchievementProfile }) {
  const [filter, setFilter] = useState<AchievementFilter>({ tier: "all", status: "all" });
  const shown = filterAchievements(profile.achievements, filter);
  const groups = groupByArea(shown);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterGroup
          label="Difficulty"
          options={TIER_FILTERS}
          value={filter.tier}
          onChange={(tier) => setFilter({ ...filter, tier })}
        />
        <FilterGroup
          label="Status"
          options={STATUS_FILTERS}
          value={filter.status}
          onChange={(status) => setFilter({ ...filter, status })}
        />
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
          <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No achievements match these filters.</p>
        </div>
      ) : (
        groups.map(({ area, achievements }) => {
          const Icon = AREA_ICONS[area];
          const unlocked = achievements.filter(isUnlocked).length;
          return (
            <section key={area} aria-labelledby={`area-${area}`} className="space-y-3">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 id={`area-${area}`} className="font-semibold">
                  {AREA_LABELS[area]}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {unlocked} / {achievements.length}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
                {achievements.map((achievement) => (
                  <AchievementCard key={achievement.key} achievement={achievement} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-full border bg-card p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-full px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value
              ? "bg-brand-subtle text-brand"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
