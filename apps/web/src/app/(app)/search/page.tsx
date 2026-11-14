import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchView } from "@/components/search/search-view";

export const metadata: Metadata = {
  title: "Search",
  description: "Search across your tasks, notes, events, money, and everything else in Orbit.",
};

/** The query, module tab, and filters live in the URL, read on the client. */
export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
