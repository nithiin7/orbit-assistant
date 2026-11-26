import type { ReactNode } from "react";

import { PageTransition } from "@/components/page-transition";

/** Remounts on navigation, so moving between modules crossfades the page content. */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
