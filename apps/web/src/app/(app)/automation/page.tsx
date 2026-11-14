import type { Metadata } from "next";
import { Suspense } from "react";

import { AutomationView } from "@/components/agent/automation-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Automation",
  description:
    "Workflows that run for you, and a personal agent that asks for approval before it changes anything.",
};

/** The section, an open run, or an opened template live in the URL, read on the client. */
export default function AutomationPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Automation"
        description="Workflows that run for you, and an agent that asks before it changes anything."
      />
      <Suspense>
        <AutomationView />
      </Suspense>
    </div>
  );
}
