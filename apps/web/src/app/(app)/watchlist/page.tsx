import type { Metadata } from "next";
import { Suspense } from "react";

import { WatchlistPanel } from "@/components/watchlist/watchlist-view";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "Films and shows you want to watch, and what you're watching now.",
};

/** The view lives in the URL, read on the client. The header lives in the panel, whose actions
 * open the page's dialogs. */
export default function WatchlistPage() {
  return (
    <Suspense>
      <WatchlistPanel />
    </Suspense>
  );
}
