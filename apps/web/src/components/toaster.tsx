"use client";

import { CircleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast";
import { cn } from "@/utils/common";

/**
 * Where `useToast().show` toasts appear: bottom centre, above page content. Render once in the
 * app layout. Hovering or focusing the toast pauses its timer.
 */
export function Toaster() {
  const { toast, close, hold } = useToast();
  return (
    // The live region stays mounted so screen readers announce each new toast. It has no role, so
    // it doesn't compete with a page's own status messages.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      {toast ? (
        <div
          key={toast.id}
          onPointerEnter={() => hold(true)}
          onPointerLeave={() => hold(false)}
          onFocus={() => hold(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) hold(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") close(toast.id);
          }}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-2 rounded-2xl border bg-card py-2 pr-2 pl-4 shadow-elevation-3",
            toast.tone === "error" && "border-destructive/40",
          )}
        >
          {toast.tone === "error" ? (
            <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
          ) : null}
          <p className="min-w-0 flex-1 py-1 text-sm text-pretty">{toast.message}</p>
          {toast.action ? (
            <Button variant="soft" size="sm" onClick={() => close(toast.id, true)}>
              {toast.action.label}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Dismiss"
            onClick={() => close(toast.id)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
