"use client";

import type { CalendarEditScope } from "@orbit/contracts";
import { type ReactNode, useCallback, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/utils/common";

const SCOPES: readonly { value: CalendarEditScope; label: string; description: string }[] = [
  { value: "this", label: "This event", description: "Only this occurrence changes." },
  {
    value: "following",
    label: "This and following events",
    description: "The series continues from here with the change.",
  },
  { value: "series", label: "All events", description: "Every occurrence in the series changes." },
];

type ScopeRequest = {
  action: "change" | "delete";
  resolve: (scope: CalendarEditScope | null) => void;
};

function ScopeDialog({
  action,
  onClose,
}: {
  action: "change" | "delete";
  onClose: (scope: CalendarEditScope | null) => void;
}) {
  const id = useId();
  const [scope, setScope] = useState<CalendarEditScope>("this");
  const chosen = useRef<CalendarEditScope | null>(null);
  const { close, dialogProps } = useModalDialog({ onClose: () => onClose(chosen.current) });
  const verb = action === "delete" ? "Delete" : "Change";

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-title`}
      className="dialog-motion dialog-pop m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          chosen.current = scope;
          close();
        }}
      >
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {verb} a repeating event
        </h2>
        <fieldset className="space-y-2">
          <legend className="sr-only">Which events</legend>
          {SCOPES.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors duration-150 has-focus-visible:ring-2 has-focus-visible:ring-ring",
                scope === option.value ? "border-brand bg-brand-subtle" : "hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name={`${id}-scope`}
                value={option.value}
                checked={scope === option.value}
                onChange={() => setScope(option.value)}
                className="mt-0.5 accent-[var(--brand)]"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant={action === "delete" ? "destructive" : "default"}>
            {verb}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Ask which occurrences of a repeating event a change or deletion applies to. `await
 * askScope("change")` resolves with the scope, or `null` when cancelled. Render `scopeDialog`.
 */
export function useScopePrompt(): {
  askScope: (action: "change" | "delete") => Promise<CalendarEditScope | null>;
  scopeDialog: ReactNode;
} {
  const [pending, setPending] = useState<ScopeRequest | null>(null);
  const askScope = useCallback(
    (action: "change" | "delete") =>
      new Promise<CalendarEditScope | null>((resolve) => setPending({ action, resolve })),
    [],
  );
  const scopeDialog = pending ? (
    <ScopeDialog
      action={pending.action}
      onClose={(scope) => {
        setPending(null);
        pending.resolve(scope);
      }}
    />
  ) : null;
  return { askScope, scopeDialog };
}
