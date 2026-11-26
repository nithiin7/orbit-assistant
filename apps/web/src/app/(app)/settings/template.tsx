import type { ReactNode } from "react";

import { PageTransition } from "@/components/page-transition";

/**
 * Settings panels share one segment, so the app template stays mounted between them. This one
 * remounts per panel: the open panel crossfades while the settings menu beside it holds still.
 */
export default function SettingsTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
