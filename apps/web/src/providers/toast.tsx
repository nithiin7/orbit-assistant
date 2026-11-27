"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

/** How long a toast stays up. Undo windows need time to read and reach the button. */
export const TOAST_DURATION_MS = 6000;

export type ToastOptions = {
  message: string;
  tone?: "default" | "error";
  /** A button on the toast, such as Undo. Choosing it closes the toast without `onExpire`. */
  action?: { label: string; onAction: () => void };
  /**
   * Runs once when the toast goes away any other way: it times out, the user closes it, a newer
   * toast replaces it, or the page is being left. Deferred work (a delete waiting out its Undo
   * window) is committed here.
   */
  onExpire?: () => void;
};

export type Toast = Omit<ToastOptions, "tone"> & { id: number; tone: "default" | "error" };

type ToastContextValue = {
  toast: Toast | null;
  show: (options: ToastOptions) => void;
  /** Close the toast, running its action when `acted`, otherwise its `onExpire`. */
  close: (id: number, acted?: boolean) => void;
  /** Pause the timer while the toast is hovered or focused, so it can't vanish mid-reach. */
  hold: (held: boolean) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * One toast at a time, shown by `useToast().show` and rendered by `Toaster`. The timer lives
 * here, not in the view, so a deferred delete still commits after its view unmounts.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const current = useRef<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const deadline = useRef(0);
  const remaining = useRef(TOAST_DURATION_MS);
  const count = useRef(0);

  function settle(acted: boolean) {
    const shown = current.current;
    if (!shown) return;
    window.clearTimeout(timer.current);
    current.current = null;
    if (acted) shown.action?.onAction();
    else shown.onExpire?.();
  }

  function close(id: number, acted = false) {
    if (current.current?.id !== id) return;
    settle(acted);
    setToast(null);
  }

  function start(ms: number) {
    window.clearTimeout(timer.current);
    deadline.current = Date.now() + ms;
    remaining.current = ms;
    const id = current.current?.id;
    if (id !== undefined) timer.current = window.setTimeout(() => close(id), ms);
  }

  function show(options: ToastOptions) {
    // A newer toast replaces the one on screen, which commits whatever that one was holding.
    settle(false);
    count.current += 1;
    const next: Toast = { ...options, tone: options.tone ?? "default", id: count.current };
    current.current = next;
    setToast(next);
    start(TOAST_DURATION_MS);
  }

  function hold(held: boolean) {
    if (!current.current) return;
    if (held) {
      window.clearTimeout(timer.current);
      remaining.current = Math.max(0, deadline.current - Date.now());
    } else {
      start(Math.max(remaining.current, 1500));
    }
  }

  // Leaving the page or signing out commits pending work rather than dropping it.
  const onPageHide = useEffectEvent(() => settle(false));
  useEffect(() => {
    const listener = () => onPageHide();
    window.addEventListener("pagehide", listener);
    return () => {
      window.removeEventListener("pagehide", listener);
      onPageHide();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, show, close, hold }}>{children}</ToastContext.Provider>
  );
}

/** Show a toast. `toast`, `close`, and `hold` are for `Toaster`. */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider.");
  return value;
}
