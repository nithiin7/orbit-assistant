import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { StorageStatusCard } from "@/components/storage/storage-indicator";

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

      <section
        aria-labelledby="storage-heading"
        className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8"
      >
        <div className="space-y-1">
          <h2 id="storage-heading" className="text-base font-semibold">
            Storage
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            Where the Orbit API keeps your data. Set by the server, not this browser.
          </p>
        </div>
        <div className="space-y-4">
          <StorageStatusCard />
          <div className="space-y-2 text-sm text-muted-foreground">
            <h3 className="font-medium text-foreground">Switching storage</h3>
            <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
              <li>
                In <code className="font-mono text-xs">apps/api/.env</code>, set{" "}
                <code className="font-mono text-xs">ORBIT_STORAGE_MODE</code> to{" "}
                <code className="font-mono text-xs">local</code> or{" "}
                <code className="font-mono text-xs">cloud</code>. Cloud also needs{" "}
                <code className="font-mono text-xs">ORBIT_DATABASE_URL</code>, your Supabase
                connection string.
              </li>
              <li>
                Run <code className="font-mono text-xs">pnpm db:migrate</code>, then restart the
                API.
              </li>
            </ol>
            <p className="text-pretty">
              Switching doesn’t move data. The other database starts empty, and your current data
              stays where it is. Database credentials are never entered or shown in the browser.
            </p>
          </div>
        </div>
      </section>

      <p className="border-t pt-6 text-sm text-muted-foreground">
        More settings will appear here as Orbit’s features are built.
      </p>
    </div>
  );
}
