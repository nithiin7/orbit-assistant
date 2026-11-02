import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistantView } from "@/components/assistant/assistant-view";

export const metadata: Metadata = { title: "Assistant" };

/**
 * A full-width chat, without the usual page header. The open conversation (and a question from
 * the command palette) live in the URL.
 */
export default function AssistantPage() {
  return (
    <>
      <h1 className="sr-only">Assistant</h1>
      <Suspense>
        <AssistantView />
      </Suspense>
    </>
  );
}
