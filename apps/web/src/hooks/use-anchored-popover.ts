"use client";

import { type RefObject, useLayoutEffect } from "react";

/**
 * The `popover` attribute for an anchored popup: `"manual"` where the Popover API exists. Where
 * it doesn't, the attribute is left off, so the popup isn't hidden and is positioned in place.
 */
export const POPOVER_MODE: "manual" | undefined =
  typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype
    ? "manual"
    : undefined;

const GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * Keeps a `popover={POPOVER_MODE}` element open beside its anchor while `open`. The Popover API puts
 * it in the top layer, above modal `<dialog>`s and outside any scrolling container that would
 * clip it, while it stays in the dialog's DOM so it isn't inert. It opens below the anchor, or
 * above when there's more room there, and follows the anchor as the page scrolls or resizes.
 *
 * The room left on the chosen side is exposed as `--available-height` for scrollable popups.
 */
export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  { matchWidth = false }: { matchWidth?: boolean } = {},
): void {
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!open || !anchor || !popup) return;
    const supported = POPOVER_MODE !== undefined;
    if (supported && !popup.matches(":popover-open")) popup.showPopover();

    function place() {
      if (!anchor || !popup) return;
      const rect = anchor.getBoundingClientRect();
      if (matchWidth) popup.style.minWidth = `${rect.width}px`;
      const below = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
      const above = rect.top - GAP - VIEWPORT_MARGIN;
      const height = popup.offsetHeight;
      const placeBelow = height <= below || below >= above;
      popup.style.setProperty("--available-height", `${placeBelow ? below : above}px`);
      // Measured again: a scrollable popup may have shrunk to fit the room.
      const top = placeBelow ? rect.bottom + GAP : rect.top - GAP - popup.offsetHeight;
      const maxLeft = window.innerWidth - popup.offsetWidth - VIEWPORT_MARGIN;
      popup.style.top = `${Math.max(VIEWPORT_MARGIN, top)}px`;
      popup.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))}px`;
    }

    function onScroll(event: Event) {
      // Scrolling inside the popup (a long list) doesn't move the anchor.
      if (event.target instanceof Node && popup?.contains(event.target)) return;
      place();
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      if (supported && popup.isConnected && popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [open, anchorRef, popupRef, matchWidth]);
}
