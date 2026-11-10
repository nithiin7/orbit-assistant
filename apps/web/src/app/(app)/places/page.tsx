import type { Metadata } from "next";
import { Suspense } from "react";

import { PlacesPanel } from "@/components/places/places-view";

export const metadata: Metadata = { title: "Places" };

/** The view lives in the URL, read on the client. The header lives in the panel, whose action
 * opens the page's dialog. */
export default function PlacesPage() {
  return (
    <Suspense>
      <PlacesPanel />
    </Suspense>
  );
}
