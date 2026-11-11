import { Gem, LayoutGrid, type LucideIcon, Store, Trophy } from "lucide-react";
import Link from "next/link";

import { PROFILE_VIEWS, profileHref, type ProfileView } from "@/lib/achievements";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<ProfileView, LucideIcon> = {
  overview: LayoutGrid,
  achievements: Trophy,
  store: Store,
  collection: Gem,
};

/**
 * The profile sections. A sticky side rail when the page is wide; below that, a row of chips
 * that scrolls sideways. `counts` adds a small number beside a view.
 */
export function ProfileNav({
  view,
  counts,
}: {
  view: ProfileView;
  counts?: Partial<Record<ProfileView, string>>;
}) {
  return (
    <nav aria-label="Profile views" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/profile:mx-0 @5xl/profile:flex-col @5xl/profile:overflow-visible @5xl/profile:px-0">
        {PROFILE_VIEWS.map((option) => {
          const Icon = VIEW_ICONS[option.value];
          const selected = view === option.value;
          const count = counts?.[option.value];
          return (
            <li key={option.value}>
              <Link
                href={profileHref(option.value)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/profile:w-full @5xl/profile:rounded-lg @5xl/profile:border-transparent",
                  selected
                    ? "border-transparent bg-brand-subtle text-brand"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/profile:bg-transparent",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1 text-left">{option.label}</span>
                {count ? (
                  <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
