import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ThemeSelector } from "@/components/settings/theme-selector";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-10">
      <PageHeader title="Settings" description="Configure Orbit to fit how you work." />

      <section
        aria-labelledby="appearance-heading"
        className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8"
      >
        <div className="space-y-1">
          <h2 id="appearance-heading" className="text-base font-semibold">
            Appearance
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            Choose how Orbit looks. Saved in this browser.
          </p>
        </div>
        <ThemeSelector />
      </section>

      <p className="border-t pt-6 text-sm text-muted-foreground">
        More settings will appear here as Orbit’s features are built.
      </p>
    </div>
  );
}
