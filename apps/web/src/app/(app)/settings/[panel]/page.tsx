import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPanelContent, SettingsPanelView } from "@/components/settings/settings-panel-view";
import { findSettingsPanel, settingsPanels } from "@/lib/settings";

// Only the panels defined in `settingsPanels` exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return settingsPanels.map((panel) => ({ panel: panel.slug }));
}

export async function generateMetadata(props: PageProps<"/settings/[panel]">): Promise<Metadata> {
  const { panel } = await props.params;
  const title = findSettingsPanel(panel)?.title;
  return { title: title ? `${title} settings` : undefined };
}

export default async function SettingsPanelPage(props: PageProps<"/settings/[panel]">) {
  const { panel: slug } = await props.params;
  const panel = findSettingsPanel(slug);
  if (!panel || !hasPanelContent(slug)) notFound();

  return <SettingsPanelView panel={panel} />;
}
