import type { Metadata } from "next";
import { Suspense } from "react";

import { SavedPanel } from "@/components/bookmarks/saved-view";

export const metadata: Metadata = {
  title: "Saved",
  description: "Links you've saved to read, watch, or come back to later.",
};

/** The view lives in the URL, read on the client. The header lives in the panel, whose actions
 * open the page's dialogs. */
export default function SavedPage() {
  return (
    <Suspense>
      <SavedPanel />
    </Suspense>
  );
}
