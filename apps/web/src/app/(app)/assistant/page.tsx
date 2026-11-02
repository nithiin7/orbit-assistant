import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistantView } from "@/components/assistant/assistant-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Assistant" };

/** The open conversation (and a question from the command palette) live in the URL. */
export default function AssistantPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Assistant"
        description="Ask about your own information. Answers cite the records they come from, and nothing changes without your approval."
      />
      <Suspense>
        <AssistantView />
      </Suspense>
    </div>
  );
}
