import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BackupSettings } from "@/components/backups/backup-settings";
import { IntegrationsSettings } from "@/components/integrations/integrations-settings";
import { PageHeader } from "@/components/page-header";
import type { SettingsPanel } from "@/lib/settings";

import { AccountSettings } from "./account-settings";
import { AiSettingsPanel } from "./ai-settings";
import { AppearanceSettings } from "./appearance-settings";
import { FinanceSettings } from "./finance-settings";
import { StorageSettings } from "./storage-settings";
import { WorkspaceSettings } from "./workspace-settings";

const panelContent: Readonly<Record<string, ReactNode>> = {
  account: <AccountSettings />,
  workspaces: <WorkspaceSettings />,
  appearance: <AppearanceSettings />,
  finance: <FinanceSettings />,
  ai: <AiSettingsPanel />,
  integrations: <IntegrationsSettings />,
  backup: <BackupSettings />,
  storage: <StorageSettings />,
};

export function hasPanelContent(slug: string): boolean {
  return slug in panelContent;
}

/**
 * One settings panel. The back link serves the drill-down layout on small screens; on large
 * screens the settings menu stays beside the panel instead.
 */
export function SettingsPanelView({ panel }: { panel: SettingsPanel }) {
  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="-ml-1 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>
      <PageHeader title={panel.title} description={panel.description} />
      {/* Panels lay their sections out against this container's width, not the viewport's. */}
      <div className="@container/panel">{panelContent[panel.slug]}</div>
    </div>
  );
}
