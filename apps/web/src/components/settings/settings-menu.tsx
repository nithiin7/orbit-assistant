"use client";

import { ChevronRight, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { useUpdateAvailable } from "@/hooks/use-system";
import {
  matchesSettingsQuery,
  settingsHref,
  type SettingsPanel,
  settingsPanels,
  settingsSections,
} from "@/lib/settings";
import { cn } from "@/utils/common";

import { ProfileLink } from "./profile-link";

type SettingsMenuProps = {
  /** Panel shown at `/settings` itself, as in the large-screen split view. */
  activeFallback?: string;
  /**
   * `rail`: compact rows beside the open panel on wide screens. `list`: the small-screen index,
   * grouped cards whose rows also say what each page is for.
   */
  variant?: "rail" | "list";
};

/**
 * The settings menu: a profile row that opens account settings, a search box, then the panels
 * in labelled groups. The open panel's row is marked as current.
 */
export function SettingsMenu({ activeFallback, variant = "list" }: SettingsMenuProps) {
  const pathname = usePathname();
  const activeSlug =
    pathname === "/settings" ? activeFallback : pathname.slice("/settings/".length);
  const [query, setQuery] = useState("");
  const idPrefix = useId();
  const updateAvailable = useUpdateAvailable();

  const groups = settingsSections
    .map((section) => ({
      ...section,
      panels: settingsPanels.filter(
        (panel) => panel.section === section.value && matchesSettingsQuery(panel, query),
      ),
    }))
    .filter((group) => group.panels.length > 0);
  const shown = groups.reduce((count, group) => count + group.panels.length, 0);
  const rail = variant === "rail";

  return (
    <nav aria-label="Settings" className={cn(rail ? "space-y-5" : "space-y-6")}>
      <ProfileLink active={activeSlug === "account"} />
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 rounded-full bg-card pl-9 shadow-elevation-1"
        />
      </div>
      {query.trim() ? (
        <p className="sr-only" aria-live="polite">
          {shown === 1 ? "1 setting" : `${shown} settings`}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center">
          <SearchX className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No settings match “{query.trim()}”</p>
          <p className="text-xs text-muted-foreground">Try a word like “theme” or “backup”.</p>
        </div>
      ) : (
        <div className={cn(rail ? "space-y-5" : "space-y-6")}>
          {groups.map((group) => {
            const labelId = `${idPrefix}-${group.value}`;
            return (
              <div key={group.value} className="space-y-2">
                <p
                  id={labelId}
                  className="px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
                >
                  {group.label}
                </p>
                <ul
                  aria-labelledby={labelId}
                  className={cn(
                    rail
                      ? "space-y-0.5"
                      : "divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1",
                  )}
                >
                  {group.panels.map((panel) => (
                    <li key={panel.slug}>
                      {rail ? (
                        <RailRow
                          panel={panel}
                          active={activeSlug === panel.slug}
                          badge={panel.slug === "system" && updateAvailable ? "Update" : null}
                        />
                      ) : (
                        <ListRow
                          panel={panel}
                          active={activeSlug === panel.slug}
                          badge={panel.slug === "system" && updateAvailable ? "Update" : null}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}

type RowProps = {
  panel: SettingsPanel;
  active: boolean;
  /** A short notice on the row, such as "Update" when a new release is out. */
  badge: string | null;
};

/** A compact rail row: the open panel's row lifts onto a card with a brand marker. */
function RailRow({ panel, active, badge }: RowProps) {
  return (
    <Link
      href={settingsHref(panel.slug)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card text-foreground shadow-elevation-1 ring-1 ring-border"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-1/2 -left-px h-5 w-1 -translate-y-1/2 rounded-full bg-brand"
        />
      ) : null}
      <IconChip
        icon={panel.icon}
        tone={panel.tone}
        className={cn(
          "transition-transform duration-150 motion-safe:group-hover:scale-105",
          !active && "opacity-90",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{panel.title}</span>
      {badge ? <Badge variant="brand">{badge}</Badge> : null}
    </Link>
  );
}

/** A small-screen row: icon, title, and one line on what the page holds. */
function ListRow({ panel, active, badge }: RowProps) {
  return (
    <Link
      href={settingsHref(panel.slug)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors duration-150 outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active && "bg-accent",
      )}
    >
      <IconChip icon={panel.icon} tone={panel.tone} className="size-9" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{panel.title}</span>
        <span className="truncate text-xs text-muted-foreground">{panel.description}</span>
      </span>
      {badge ? <Badge variant="brand">{badge}</Badge> : null}
      <ChevronRight
        className={cn("size-4 shrink-0 text-muted-foreground", active && "text-brand")}
        aria-hidden="true"
      />
    </Link>
  );
}
