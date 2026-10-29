"use client";

import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

type Side = "right" | "top" | "bottom";

type TooltipProps = {
  /** Visual label. It must repeat the trigger's accessible name, so it is hidden from assistive tech. */
  label: string;
  /** Optional keyboard shortcut text, e.g. "⌘B". Pair it with `aria-keyshortcuts` on the trigger. */
  shortcut?: string;
  side?: Side;
  disabled?: boolean;
  children: ReactNode;
};

const GAP = 8;
const HOVER_DELAY_MS = 350;

function position(rect: DOMRect, side: Side): CSSProperties {
  switch (side) {
    case "right":
      return { left: rect.right + GAP, top: rect.top + rect.height / 2, translate: "0 -50%" };
    case "top":
      return { left: rect.left + rect.width / 2, top: rect.top - GAP, translate: "-50% -100%" };
    case "bottom":
      return { left: rect.left + rect.width / 2, top: rect.bottom + GAP, translate: "-50% 0" };
  }
}

/**
 * Lightweight tooltip for icon-only controls. Shows on hover (after a short delay) and on keyboard
 * focus, and hides on Escape, blur, pointer leave, or press. It is fixed-positioned so scrolling or
 * clipping containers such as the sidebar do not cut it off.
 */
export function Tooltip({
  label,
  shortcut,
  side = "right",
  disabled = false,
  children,
}: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setStyle(null);
  }, []);

  const show = useCallback(() => {
    const target = triggerRef.current?.firstElementChild;
    if (!target) return;
    setStyle(position(target.getBoundingClientRect(), side));
  }, [side]);

  useEffect(() => {
    if (!style) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
    };
  }, [style, hide]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const onFocus = (event: FocusEvent) => {
    // Only keyboard focus; a mouse click already shows the hover tooltip or needs none.
    if (event.target instanceof Element && event.target.matches(":focus-visible")) show();
  };

  return (
    <span
      ref={triggerRef}
      className="contents"
      onPointerEnter={(event) => {
        if (disabled || event.pointerType === "touch") return;
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(show, HOVER_DELAY_MS);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={disabled ? undefined : onFocus}
      onBlur={hide}
    >
      {children}
      {style && !disabled ? (
        <span
          aria-hidden="true"
          style={style}
          className={cn(
            "pointer-events-none fixed z-50 rounded-md bg-primary px-2 py-1 text-xs font-medium whitespace-nowrap text-primary-foreground shadow-elevation-2",
            "animate-tooltip-in",
          )}
        >
          {label}
          {shortcut ? <span className="ml-2 opacity-60">{shortcut}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
