import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchView } from "@/components/search/search-view";

export const metadata: Metadata = { title: "Search" };

/** The query, module tab, and filters live in the URL, read on the client. */
export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
