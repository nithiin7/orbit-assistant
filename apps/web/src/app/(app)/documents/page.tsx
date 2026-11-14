import type { Metadata } from "next";
import { Suspense } from "react";

import { DocumentsPanel } from "@/components/documents/documents-view";

export const metadata: Metadata = {
  title: "Documents",
  description: "A private vault for your important documents, stored on your own Orbit server.",
};

/** The view, folder, category, search, and open document live in the URL, read on the client. */
export default function DocumentsPage() {
  return (
    <Suspense>
      <DocumentsPanel />
    </Suspense>
  );
}
