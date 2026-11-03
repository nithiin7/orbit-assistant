import type { Metadata } from "next";
import { Suspense } from "react";

import { AutomationView } from "@/components/agent/automation-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Automation" };

/** The tab and any open run live in the URL, read on the client. */
export default function AutomationPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Automation"
        description="Your personal agent and workflows. It uses only the tools you allow, and asks before changing anything unless you’ve said otherwise."
      />
      <Suspense>
        <AutomationView />
      </Suspense>
    </div>
  );
}
