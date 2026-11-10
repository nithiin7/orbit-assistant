"use client";

import {
  resetNavPreference,
  setNavItemHidden,
  useNavPreference,
} from "@/components/app-shell/sidebar-state";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { canHideNavItem, navItemKey, sidebarSections } from "@/lib/navigation";

/** A switch per sidebar link, grouped like the sidebar. Saved in this browser only. */
export function SidebarSettings() {
  const { hidden, folded } = useNavPreference();
  const sections = sidebarSections
    .map((section) => ({ ...section, items: section.items.filter(canHideNavItem) }))
    .filter((section) => section.items.length > 0);
  const changed = hidden.length > 0 || folded.length > 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map(({ id, label, items }) => (
          <fieldset key={id} className="rounded-lg border bg-card p-1.5 shadow-elevation-1">
            <legend className="sr-only">{label}</legend>
            <p
              aria-hidden="true"
              className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground"
            >
              {label}
            </p>
            <ul className="divide-y divide-border/60">
              {items.map(({ title, href, description, icon: Icon }) => {
                const key = navItemKey({ href });
                const shown = !hidden.includes(key);
                const labelId = `sidebar-setting-${key}`;
                return (
                  <li key={href} className="flex items-center gap-3 px-2.5 py-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span id={labelId} className="block text-sm font-medium">
                        {title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {description}
                      </span>
                    </span>
                    <Switch
                      checked={shown}
                      onCheckedChange={(next) => setNavItemHidden(key, !next)}
                      aria-labelledby={labelId}
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          The dashboard always stays. Click a section name in the sidebar to fold it.
        </p>
        {changed ? (
          <Button variant="ghost" size="sm" onClick={resetNavPreference}>
            Show everything
          </Button>
        ) : null}
      </div>
    </div>
  );
}
