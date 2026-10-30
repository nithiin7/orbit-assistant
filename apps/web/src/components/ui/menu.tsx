"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { POPOVER_MODE, useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { cn } from "@/utils/common";

import { Button, type ButtonProps } from "./button";
import { popupClassName } from "./select";

export type MenuItem = {
  id: string;
  label: string;
  /** A short line under the label saying what the item is for. */
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  onSelect: () => void;
};

type MenuProps = {
  /** The trigger's content, such as an icon and "Add". */
  children: ReactNode;
  items: readonly MenuItem[];
  /** The trigger's accessible name, when its content alone doesn't say enough. */
  "aria-label"?: string;
  variant?: ButtonProps["variant"];
  /** Which trigger edge the menu lines up with. */
  align?: "start" | "end";
  className?: string;
};

/**
 * A menu button (the ARIA menu button pattern): a button that opens a list of actions. Focus moves
 * into the menu, where `aria-activedescendant` marks the highlighted item. Arrow keys, Home, and End
 * move past disabled items; Enter or Space runs one; Escape closes and returns focus to the button.
 */
export function Menu({
  children,
  items,
  variant = "default",
  align = "start",
  className,
  ...aria
}: MenuProps) {
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;
  const itemId = (index: number) => `${baseId}-item-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useAnchoredPopover(open, triggerRef, popupRef, { align });

  useEffect(() => {
    if (open) menuRef.current?.focus();
  }, [open]);

  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  function openMenu(index: number) {
    setActive(index);
    setOpen(true);
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function run(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    close({ restoreFocus: true });
    item.onSelect();
  }

  /** The next enabled item after `from` in `step` direction, wrapping around. */
  function step(from: number, direction: 1 | -1): number {
    if (enabled.length === 0) return -1;
    const position = enabled.indexOf(from);
    if (position < 0) return direction === 1 ? (enabled[0] ?? -1) : (enabled.at(-1) ?? -1);
    return enabled[(position + direction + enabled.length) % enabled.length] ?? -1;
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open) return;
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu(enabled[0] ?? -1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(enabled.at(-1) ?? -1);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Partial<Record<string, number>> = {
      ArrowDown: step(active, 1),
      ArrowUp: step(active, -1),
      Home: enabled[0] ?? -1,
      End: enabled.at(-1) ?? -1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run(active);
    } else if (event.key === "Escape") {
      // Close only the menu, not a dialog around it.
      event.preventDefault();
      event.stopPropagation();
      close({ restoreFocus: true });
    } else if (event.key === "Tab") {
      close({ restoreFocus: false });
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        id={triggerId}
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn("group", className)}
        // While open, keep focus in the menu so pressing the trigger closes it instead of
        // blurring the menu first and then reopening it.
        onMouseDown={(event) => {
          if (open) event.preventDefault();
        }}
        onClick={() => (open ? close({ restoreFocus: true }) : openMenu(-1))}
        onKeyDown={onTriggerKeyDown}
        {...aria}
      >
        {children}
        <ChevronDown
          aria-hidden="true"
          className="-mr-1 opacity-70 transition-transform duration-150 group-aria-expanded:rotate-180"
        />
      </Button>
      {open ? (
        <div ref={popupRef} popover={POPOVER_MODE} className={cn(popupClassName, "w-64")}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            tabIndex={-1}
            aria-labelledby={triggerId}
            aria-activedescendant={active >= 0 ? itemId(active) : undefined}
            onKeyDown={onMenuKeyDown}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && popupRef.current?.contains(next)) return;
              close({ restoreFocus: false });
            }}
            className="outline-none"
          >
            {items.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  id={itemId(index)}
                  role="menuitem"
                  aria-disabled={item.disabled || undefined}
                  aria-labelledby={`${itemId(index)}-label`}
                  aria-describedby={item.description ? `${itemId(index)}-description` : undefined}
                  data-active={index === active ? "" : undefined}
                  onClick={() => run(index)}
                  onMouseMove={() => {
                    if (!item.disabled && index !== active) setActive(index);
                  }}
                  // Keep focus in the menu while the pointer picks an item.
                  onMouseDown={(event) => event.preventDefault()}
                  className="flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-2 text-sm select-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-active:bg-accent data-active:text-accent-foreground"
                >
                  {Icon ? (
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span id={`${itemId(index)}-label`} className="block font-medium">
                      {item.label}
                    </span>
                    {item.description ? (
                      <span
                        id={`${itemId(index)}-description`}
                        className="block text-xs text-muted-foreground"
                      >
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
