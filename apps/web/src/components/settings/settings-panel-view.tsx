import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BackupSettings } from "@/components/backups/backup-settings";
import { IntegrationsSettings } from "@/components/integrations/integrations-settings";
import { IconChip } from "@/components/ui/icon-chip";
import { type SettingsPanel, settingsSectionLabel } from "@/lib/settings";

import { AccountSettings } from "./account-settings";
import { AiSettingsPanel } from "./ai-settings";
import { AppLockSettings } from "./app-lock-settings";
import { AppearanceSettings } from "./appearance-settings";
import { FinanceSettings } from "./finance-settings";
import { NotificationSettings } from "./notification-settings";
import { PlacesSettings } from "./places-settings";
import { SavedSettings } from "./saved-settings";
import { SettingsToneProvider } from "./settings-card";
import { StorageSettings } from "./storage-settings";
import { SystemSettings } from "./system-settings";
import { VoiceSettingsPanel } from "./voice-settings";
import { WatchlistSettings } from "./watchlist-settings";
import { WorkspaceSettings } from "./workspace-settings";

const panelContent: Readonly<Record<string, ReactNode>> = {
  account: <AccountSettings />,
  workspaces: <WorkspaceSettings />,
  appearance: <AppearanceSettings />,
  finance: <FinanceSettings />,
  watchlist: <WatchlistSettings />,
  saved: <SavedSettings />,
  places: <PlacesSettings />,
  ai: <AiSettingsPanel />,
  notifications: <NotificationSettings />,
  voice: <VoiceSettingsPanel />,
  integrations: <IntegrationsSettings />,
  "app-lock": <AppLockSettings />,
  backup: <BackupSettings />,
  storage: <StorageSettings />,
  system: <SystemSettings />,
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
      <PanelHeader panel={panel} />
      {/* Panels lay their sections out against this container's width, not the viewport's. */}
      <div className="@container/panel">
        <SettingsToneProvider tone={panel.tone}>{panelContent[panel.slug]}</SettingsToneProvider>
      </div>
    </div>
  );
}

/** The panel's title on a tinted card: its icon, the menu group it sits in, and what it holds. */
function PanelHeader({ panel }: { panel: SettingsPanel }) {
  const Icon = panel.icon;
  return (
    <header className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-5 shadow-elevation-1 sm:p-6">
      <Icon
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -right-6 size-40 -rotate-12 text-brand opacity-[0.06]"
      />
      <div className="relative flex items-center gap-4">
        <IconChip
          icon={panel.icon}
          tone={panel.tone}
          className="size-12 rounded-2xl ring-1 ring-border/60 [&>svg]:size-6"
        />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold tracking-wider text-brand uppercase">
            {settingsSectionLabel(panel.section)}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
            {panel.title}
          </h1>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            {panel.description}
          </p>
        </div>
      </div>
    </header>
  );
}
