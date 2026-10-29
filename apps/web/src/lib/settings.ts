import { Database, Layers, type LucideIcon, Palette, UserRound } from "lucide-react";

export type SettingsPanel = {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** `account` panels open from the profile row; `general` panels are listed beneath it. */
  group: "account" | "general";
};

/** Settings sub-pages. The single source of truth for the settings menu and its routes. */
export const settingsPanels: readonly SettingsPanel[] = [
  {
    slug: "account",
    title: "Account",
    description: "Your profile and how you sign in to Orbit.",
    icon: UserRound,
    group: "account",
  },
  {
    slug: "workspaces",
    title: "Workspaces",
    description: "Each workspace keeps its data separate. Rename, switch, or create one.",
    icon: Layers,
    group: "general",
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Choose how Orbit looks. Saved in this browser.",
    icon: Palette,
    group: "general",
  },
  {
    slug: "storage",
    title: "Storage",
    description: "Where the Orbit API keeps your data. Set by the server, not this browser.",
    icon: Database,
    group: "general",
  },
];

export function settingsHref(slug: string): string {
  return `/settings/${slug}`;
}

export function findSettingsPanel(slug: string): SettingsPanel | undefined {
  return settingsPanels.find((panel) => panel.slug === slug);
}
