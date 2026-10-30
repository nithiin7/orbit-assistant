"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { settingsHref, settingsPanels } from "@/lib/settings";
import { cn } from "@/utils/common";

import { ProfileLink } from "./profile-link";

const generalPanels = settingsPanels.filter((panel) => panel.group === "general");

type SettingsMenuProps = {
  /** Panel shown at `/settings` itself, as in the large-screen split view. */
  activeFallback?: string;
};

/**
 * The settings menu: a profile row that opens account settings, then a grouped list where each
 * row opens its own settings page. The open panel's row is marked as current.
 */
export function SettingsMenu({ activeFallback }: SettingsMenuProps) {
  const pathname = usePathname();
  const activeSlug =
    pathname === "/settings" ? activeFallback : pathname.slice("/settings/".length);

  return (
    <nav aria-label="Settings" className="space-y-6">
      <ProfileLink active={activeSlug === "account"} />
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {generalPanels.map(({ slug, title, description, icon: Icon }) => {
          const active = activeSlug === slug;
          return (
            <li key={slug}>
              <Link
                href={settingsHref(slug)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 transition-colors duration-150 outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active && "bg-accent",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
                >
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{title}</span>
                  <span className="truncate text-xs text-muted-foreground">{description}</span>
                </span>
                <ChevronRight
                  className={cn("size-4 shrink-0 text-muted-foreground", active && "text-brand")}
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
