import type { ReactNode } from "react";

import { SettingsMenu } from "@/components/settings/settings-menu";

/**
 * Small screens drill down: the menu, then one panel at a time with a back link. Large screens
 * split the view, keeping the menu beside the open panel; the panel takes all remaining width.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)] 2xl:gap-14 3xl:grid-cols-[24rem_minmax(0,1fr)] 3xl:gap-16">
      <aside className="hidden lg:sticky lg:top-10 lg:block lg:self-start 2xl:top-12">
        {/* The menu's accessible name already says "Settings"; this is the visual title. */}
        <p aria-hidden="true" className="mb-6 text-2xl font-semibold tracking-tight">
          Settings
        </p>
        <SettingsMenu activeFallback="account" />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
