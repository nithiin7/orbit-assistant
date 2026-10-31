"use client";

import { type LucideIcon, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { cn } from "@/utils/common";

export type ConfirmChoice = {
  label: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
};

export type RowAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Hide the action without reshuffling the list where it's built. */
  hidden?: boolean;
} & (
  | { onSelect: () => void; confirm?: undefined }
  /** Ask first: the row's actions turn into these choices and a Cancel. */
  | { confirm: { prompt: string; choices: ConfirmChoice[] }; onSelect?: undefined }
);

/**
 * A row's actions: at most one visible action, then everything else in a "More actions" menu.
 * Actions that are hard to undo ask first, in place of the row's buttons; Escape cancels.
 */
export function RowActions({
  name,
  primary,
  actions,
  disabled = false,
  className,
}: {
  /** What the row is, for the menu's accessible name: "More actions for “Netflix”". */
  name: string;
  /** The row's one visible action, such as "Record payment". */
  primary?: ReactNode;
  actions: readonly RowAction[];
  disabled?: boolean;
  className?: string;
}) {
  const [confirming, setConfirming] = useState<RowAction | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const shown = actions.filter((action) => !action.hidden);

  const restoreFocus = useRef(false);

  useEffect(() => {
    if (confirming) {
      firstChoiceRef.current?.focus();
    } else if (restoreFocus.current) {
      // The menu button is back; put focus on it, where the user started.
      restoreFocus.current = false;
      containerRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")?.focus();
    }
  }, [confirming]);

  const cancel = () => {
    restoreFocus.current = true;
    setConfirming(null);
  };

  if (confirming?.confirm) {
    return (
      <div
        // Distinct keys, so the confirmation and the buttons are separate elements.
        key="confirm"
        ref={containerRef}
        role="group"
        aria-label={confirming.confirm.prompt}
        className={cn("flex flex-wrap items-center gap-1", className)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            cancel();
          }
        }}
      >
        <p className="mr-1 text-xs text-muted-foreground" aria-hidden="true">
          {confirming.confirm.prompt}
        </p>
        {confirming.confirm.choices.map((choice, index) => (
          <Button
            key={choice.label}
            ref={index === 0 ? firstChoiceRef : undefined}
            variant={choice.destructive ? "destructive" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void choice.onConfirm().finally(() => {
                setBusy(false);
                setConfirming(null);
              });
            }}
          >
            {choice.label}
          </Button>
        ))}
        <Button variant="ghost" size="sm" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div
      key="actions"
      ref={containerRef}
      className={cn("flex shrink-0 items-center gap-1", className)}
    >
      {primary}
      {shown.length > 0 ? (
        <Menu
          align="end"
          variant="ghost"
          size="icon"
          chevron={false}
          aria-label={`More actions for “${name}”`}
          className="size-8 text-muted-foreground"
          items={shown.map((action) => ({
            id: action.id,
            label: action.label,
            icon: action.icon,
            description: action.description,
            destructive: action.destructive,
            disabled: disabled || action.disabled,
            onSelect: () => {
              if (action.confirm) setConfirming(action);
              else action.onSelect();
            },
          }))}
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      ) : null}
    </div>
  );
}
