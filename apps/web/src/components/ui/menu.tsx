"use client";

import { Check, ChevronDown, type LucideIcon } from "lucide-react";
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
  /** Shown in red, for actions that delete or end something. */
  destructive?: boolean;
  /** Marks the current choice when the menu picks one of several (`menuitemradio`). */
  checked?: boolean;
  /** Consecutive items with the same group sit under its label. */
  group?: string;
  onSelect: () => void;
};

type MenuProps = {
  /** The trigger's content, such as an icon and "Add". */
  children: ReactNode;
  items: readonly MenuItem[];
  /** The trigger's accessible name, when its content alone doesn't say enough. */
  "aria-label"?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** The chevron after the trigger's content; leave it out for an icon-only trigger. */
  chevron?: boolean;
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
  size,
  chevron = true,
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

  function renderItem({ item, index }: { item: MenuItem; index: number }) {
    const Icon = item.icon;
    return (
      <div
        key={item.id}
        id={itemId(index)}
        role={item.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={item.checked}
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
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-2 text-sm select-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-active:bg-accent data-active:text-accent-foreground",
          item.destructive && "text-destructive data-active:text-destructive",
          item.checked && "font-medium text-brand data-active:text-brand",
        )}
      >
        {Icon ? (
          <span
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
              item.destructive
                ? "bg-destructive/10 text-destructive"
                : "bg-brand-subtle text-brand",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span id={`${itemId(index)}-label`} className="block font-medium">
            {item.label}
          </span>
          {item.description ? (
            <span
              id={`${itemId(index)}-description`}
              className="block text-xs font-normal text-muted-foreground"
            >
              {item.description}
            </span>
          ) : null}
        </span>
        {item.checked ? <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
      </div>
    );
  }

  return (
    <>
      <Button
        ref={triggerRef}
        id={triggerId}
        variant={variant}
        size={size}
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
        {chevron ? (
          <ChevronDown
            aria-hidden="true"
            className="-mr-1 opacity-70 transition-transform duration-150 group-aria-expanded:rotate-180"
          />
        ) : null}
      </Button>
      {open ? (
        <div
          ref={popupRef}
          popover={POPOVER_MODE}
          className={cn(
            popupClassName,
            "max-h-[min(32rem,var(--available-height,32rem))] w-64 overflow-y-auto overscroll-contain",
          )}
        >
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
            {groupItems(items).map(({ group, entries }) =>
              group === undefined ? (
                entries.map(renderItem)
              ) : (
                <div key={group} role="group" aria-labelledby={`${baseId}-group-${group}`}>
                  <p
                    id={`${baseId}-group-${group}`}
                    className="px-2.5 pt-2.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                  >
                    {group}
                  </p>
                  {entries.map(renderItem)}
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Runs of consecutive items that share a group (or have none), keeping each item's index. */
function groupItems(items: readonly MenuItem[]) {
  const runs: { group: string | undefined; entries: { item: MenuItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = runs.at(-1);
    if (last && last.group === item.group) last.entries.push({ item, index });
    else runs.push({ group: item.group, entries: [{ item, index }] });
  });
  return runs;
}
