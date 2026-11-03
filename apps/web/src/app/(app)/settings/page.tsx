import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { SettingsMenu } from "@/components/settings/settings-menu";
import { SettingsPanelView } from "@/components/settings/settings-panel-view";
import { findSettingsPanel } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings" };

const accountPanel = findSettingsPanel("account");

export default function SettingsPage() {
  return (
    <>
      {/* Small screens: the menu on its own. */}
      <div className="space-y-8 lg:hidden">
        <PageHeader title="Settings" />
        <SettingsMenu />
      </div>
      {/* Large screens: the layout shows the menu, so open the first panel beside it. */}
      {accountPanel ? (
        <div className="hidden lg:block">
          <SettingsPanelView panel={accountPanel} />
        </div>
      ) : null}
    </>
  );
}
