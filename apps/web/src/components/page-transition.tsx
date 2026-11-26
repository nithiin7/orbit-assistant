import { type ReactNode, ViewTransition } from "react";

/**
 * Animates page content during a route change with the browser's View Transitions API: the old
 * page fades out and the new one fades in, so a navigation never shows a blank frame. Put it in a
 * `template.tsx` (templates remount on navigation, which gives React the exit and enter). Updates
 * inside a page do not animate. Without browser support, pages swap instantly as before.
 * Keyframes live in `styles/motion.css`.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
