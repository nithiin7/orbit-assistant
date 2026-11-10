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
      <details className="col-span-full space-y-2 text-sm text-muted-foreground">
        <summary className="cursor-pointer rounded-md font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          How to switch storage
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
          <li>
            In <code className="font-mono text-xs">apps/api/.env</code>, set{" "}
            <code className="font-mono text-xs">ORBIT_STORAGE_MODE</code> to{" "}
            <code className="font-mono text-xs">local</code> or{" "}
            <code className="font-mono text-xs">cloud</code>. Cloud also needs{" "}
            <code className="font-mono text-xs">ORBIT_DATABASE_URL</code>, your Supabase connection
            string.
          </li>
          <li>
            Run <code className="font-mono text-xs">pnpm db:migrate</code>, then restart the API.
          </li>
        </ol>
        <p className="text-pretty">
          Data isn’t moved. The other database starts empty, so you sign up again there.
        </p>
      </details>
    </div>
  );
}
