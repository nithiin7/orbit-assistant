import type { ReactNode } from "react";

/** Remounts on navigation, giving page content a brief fade for continuity. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
