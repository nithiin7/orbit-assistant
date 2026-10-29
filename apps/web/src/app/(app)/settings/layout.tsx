import type { ReactNode } from "react";

import { SettingsMenu } from "@/components/settings/settings-menu";

/**
 * Small screens drill down: the menu, then one panel at a time with a back link. Large screens
 * split the view, keeping the menu beside the open panel.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:gap-10 2xl:gap-14">
      <aside className="hidden lg:sticky lg:top-10 lg:block lg:self-start 2xl:top-12">
        {/* The menu's accessible name already says "Settings"; this is the visual title. */}
        <p aria-hidden="true" className="mb-6 text-2xl font-semibold tracking-tight">
          Settings
        </p>
        <SettingsMenu activeFallback="account" />
        <p className="mt-6 text-xs text-pretty text-muted-foreground">
          More settings will appear here as Orbit’s features are built.
        </p>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
