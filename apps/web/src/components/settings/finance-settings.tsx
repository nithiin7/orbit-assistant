"use client";

import { LineChart } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { SettingsCard, SettingsLoading, SettingsSwitch } from "@/components/settings/settings-card";
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
    return <SettingsLoading label="Loading finance settings…" className="h-32" />;
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
      <SettingsCard
        titleId={`${id}-title`}
        icon={LineChart}
        title="Investments"
        description="For this workspace."
        bodyClassName="space-y-4"
      >
        <SettingsSwitch
          label="Live prices"
          hint={
            data.available
              ? "Updates fund NAVs and stock prices, and lets you search funds by name. Only scheme codes and tickers are sent to mfapi.in and Yahoo Finance."
              : "Turned off on this server."
          }
          checked={data.enabled}
          disabled={!data.available || update.isPending}
          onCheckedChange={(checked) => void change(checked)}
        />
        <FormAlert message={error} />
      </SettingsCard>
    </div>
  );
}
