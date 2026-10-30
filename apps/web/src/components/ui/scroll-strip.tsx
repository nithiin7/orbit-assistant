"use client";

import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/utils/common";

type ScrollStripProps = ComponentProps<"div"> & {
  /** Changes when the selection does, so the selected item (`aria-pressed="true"`) scrolls into view. */
  selected?: string;
  /** Classes for the inner row that scrolls. */
  contentClassName?: string;
};

/**
 * A single row that scrolls sideways when it doesn't fit, such as a strip of view tabs. It hides
 * the scrollbar, which would otherwise cover the items, and fades the edge where more is hidden.
 * A vertical mouse wheel scrolls it sideways, and the selected item is kept in view.
 */
function ScrollStrip({
  selected,
  className,
  contentClassName,
  children,
  ...props
}: ScrollStripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const row = ref.current;
    if (!row) return;
    const start = row.scrollLeft > 1;
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setOverflow((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    // Registered by hand: React's onWheel is passive, so it can't stop the page scrolling.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = row.scrollWidth - row.clientWidth;
      const canScroll = event.deltaY < 0 ? row.scrollLeft > 0 : row.scrollLeft < max;
      if (!canScroll) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const row = ref.current;
    const item = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !item) return;
    // Leave room for the edge fade, so the selected item is never half faded out.
    const margin = 24;
    const max = row.scrollWidth - row.clientWidth;
    if (item.offsetLeft - margin < row.scrollLeft) {
      row.scrollLeft = Math.max(0, item.offsetLeft - margin);
    } else if (item.offsetLeft + item.offsetWidth + margin > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.min(max, item.offsetLeft + item.offsetWidth + margin - row.clientWidth);
    }
    measure();
  }, [selected, measure]);

  return (
    <div className={cn("flex min-w-0", className)}>
      <div
        ref={ref}
        onScroll={measure}
        data-overflow-start={overflow.start ? "" : undefined}
        data-overflow-end={overflow.end ? "" : undefined}
        className={cn(
          "scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain scroll-fade-x",
          contentClassName,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export { ScrollStrip };
