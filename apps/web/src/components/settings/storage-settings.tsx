import { ChevronDown } from "lucide-react";

import { StorageStatusCard } from "@/components/storage/storage-indicator";

import { DatabaseLocation } from "./database-location";

/**
 * A grid rather than the shared settings columns: columns rebalance when the help opens, which
 * moved the database card from one column to the other. Here the cards keep their places and the
 * help spans the full width below them.
 */
export function StorageSettings() {
  return (
    <div className="grid items-start gap-6 @5xl/panel:grid-cols-2">
      <StorageStatusCard />
      <DatabaseLocation />
      <details className="group col-span-full rounded-2xl border bg-card text-sm text-muted-foreground shadow-elevation-1">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3.5 font-medium text-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex-1">How to switch storage</span>
          <ChevronDown
            className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-2 border-t border-border/60 px-4 pt-3 pb-4 sm:px-5">
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
              Run <code className="font-mono text-xs">pnpm db:migrate</code>, then restart the API.
            </li>
          </ol>
          <p className="text-pretty">
            Data isn’t moved. The other database starts empty, so you sign up again there.
          </p>
        </div>
      </details>
    </div>
  );
}
