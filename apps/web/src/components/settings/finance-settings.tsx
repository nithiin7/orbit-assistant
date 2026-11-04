"use client";

import { LineChart } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useMarketData } from "@/hooks/use-investments";
import { settingsSectionsClassName } from "@/lib/settings";

/** Finance settings for the open workspace: whether investment prices update themselves. */
export function FinanceSettings() {
  const workspaceId = useActiveWorkspaceId();
  const { data, isPending, isError, update } = useMarketData(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  if (isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">Loading finance settings…</span>
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }
  if (isError || !data) {
    return <FormAlert message="Couldn’t load finance settings. Refresh to try again." />;
  }

  async function change(enabled: boolean) {
    setError(null);
    try {
      await update.mutateAsync(enabled);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t save. Try again."));
    }
  }

  return (
    <div className={settingsSectionsClassName}>
      <section
        aria-labelledby={`${id}-title`}
        className="rounded-2xl border bg-card shadow-elevation-1"
      >
        <header className="flex items-start gap-3 border-b px-4 py-4 sm:px-5">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
          >
            <LineChart className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h2 id={`${id}-title`} className="text-base font-semibold">
              Investments
            </h2>
            <p className="text-sm text-pretty text-muted-foreground">For this workspace.</p>
          </div>
        </header>
        <div className="space-y-4 px-4 py-5 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <label htmlFor={`${id}-live`} className="text-sm font-medium">
                Live prices
              </label>
              <p
                id={`${id}-live-description`}
                className="text-xs text-pretty text-muted-foreground"
              >
                {data.available
                  ? "Updates fund NAVs and stock prices, and lets you search funds by name. Only scheme codes and tickers are sent to mfapi.in and Yahoo Finance."
                  : "Turned off on this server."}
              </p>
            </div>
            <Switch
              id={`${id}-live`}
              checked={data.enabled}
              disabled={!data.available || update.isPending}
              onCheckedChange={(checked) => void change(checked)}
              aria-describedby={`${id}-live-description`}
            />
          </div>
          <FormAlert message={error} />
        </div>
      </section>
    </div>
  );
}
