import {
  Archive,
  Bot,
  Database,
  Layers,
  LineChart,
  type LucideIcon,
  Palette,
  Plug,
  UserRound,
} from "lucide-react";

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
    description: "Profile, sign-in, and time zone.",
    icon: UserRound,
    group: "account",
  },
  {
    slug: "workspaces",
    title: "Workspaces",
    description: "Switch, rename, or create workspaces.",
    icon: Layers,
    group: "general",
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Mode, colors, and font for this browser.",
    icon: Palette,
    group: "general",
  },
  {
    slug: "finance",
    title: "Finance",
    description: "Live prices for your investments.",
    icon: LineChart,
    group: "general",
  },
  {
    slug: "ai",
    title: "AI",
    description: "Providers, models, and privacy.",
    icon: Bot,
    group: "general",
  },
  {
    slug: "integrations",
    title: "Integrations",
    description: "Google and Microsoft calendars, mail, and files.",
    icon: Plug,
    group: "general",
  },
  {
    slug: "backup",
    title: "Backup & restore",
    description: "Back up, restore, and export your data.",
    icon: Archive,
    group: "general",
  },
  {
    slug: "storage",
    title: "Storage",
    description: "Where your data is stored.",
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

/**
 * A panel's stack of sections. Narrow panels stack them; as the panel's container widens they
 * flow into balanced columns, so wide screens are filled without stretching any one form.
 * Mark a section `[column-span:all]` to keep it full width.
 */
export const settingsSectionsClassName =
  "space-y-6 *:break-inside-avoid @5xl/panel:columns-2 @5xl/panel:gap-6 @min-[110rem]/panel:columns-3 @min-[110rem]/panel:gap-8";
