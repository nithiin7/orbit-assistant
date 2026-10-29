import { StorageStatusCard } from "@/components/storage/storage-indicator";

import { DatabaseLocation } from "./database-location";

export function StorageSettings() {
  return (
    <div className="space-y-4">
      <StorageStatusCard />
      <DatabaseLocation />
      <div className="space-y-2 text-sm text-muted-foreground">
        <h2 className="font-medium text-foreground">Switching storage</h2>
        <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
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
          Switching doesn’t move data or accounts. The other database starts empty, so you create a
          new account there; your current data stays where it is. Database credentials are never
          entered or shown in the browser.
        </p>
      </div>
    </div>
  );
}
