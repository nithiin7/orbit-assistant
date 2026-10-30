"use client";

import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, type Ref, useEffect, useId, useMemo, useRef, useState } from "react";

import { POPOVER_MODE, useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { cn, mergeRefs, type Option } from "@/utils/common";

/** Options under a heading, like `<optgroup>`. */
export type SelectGroup<T extends string> = { label: string; options: readonly Option<T>[] };

export type SelectItems<T extends string> = readonly (Option<T> | SelectGroup<T>)[];

export type SelectProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectItems<T>;
  id?: string;
  ref?: Ref<HTMLButtonElement>;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** Sizes the control, like a native select's wrapper. */
  className?: string;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

/** Options a page key moves past. */
const PAGE_SIZE = 10;
/** Pause after which typed letters start a new search. */
const TYPEAHEAD_RESET_MS = 600;

function isGroup<T extends string>(item: Option<T> | SelectGroup<T>): item is SelectGroup<T> {
  return "options" in item;
}

/** The common trigger look: a form control with a chevron, shared with the date picker. */
export const triggerClassName = cn(
  "group flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card py-1 pr-2.5 pl-3 text-left text-sm shadow-elevation-1 transition-[border-color,box-shadow] duration-150 outline-none dark:bg-transparent",
  "hover:border-ring/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
  "aria-expanded:border-ring aria-expanded:ring-2 aria-expanded:ring-ring/40",
  "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/** The floating panel both popups use; it sits in the top layer via the Popover API. */
export const popupClassName =
  "fixed inset-auto m-0 animate-popover-in rounded-lg border bg-popover p-1 text-popover-foreground shadow-elevation-3";

/**
 * A select-only combobox (the ARIA pattern a native `<select>` follows) with a styled list. Focus
 * stays on the trigger and `aria-activedescendant` marks the highlighted option. Arrow keys,
 * Home/End, and Page Up/Down move; Enter or Space chooses; Escape closes; typing jumps to a
 * matching option, open or closed.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  id,
  ref,
  placeholder = "Select…",
  disabled,
  className,
  onBlur,
  ...aria
}: SelectProps<T>) {
  const baseId = useId();
  const triggerId = id ?? `${baseId}-trigger`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ text: string; timer?: number }>({ text: "" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const flat = useMemo(
    () => options.flatMap((item) => (isGroup(item) ? item.options : [item])),
    [options],
  );
  const indexOf = useMemo(
    () => new Map(flat.map((option, index) => [option.value, index])),
    [flat],
  );
  const selectedIndex = indexOf.get(value) ?? -1;
  const selected = flat[selectedIndex];

  useAnchoredPopover(open, triggerRef, popupRef, { matchWidth: true });

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, baseId]);

  useEffect(() => {
    const state = typeahead.current;
    return () => window.clearTimeout(state.timer);
  }, []);

  function openList(index = selectedIndex) {
    // Opening starts a fresh search.
    typeahead.current.text = "";
    setActive(Math.max(index, 0));
    setOpen(true);
  }

  function choose(index: number) {
    const option = flat[index];
    if (option && option.value !== value) onValueChange(option.value);
    setOpen(false);
  }

  /** The next option whose label starts with what has been typed, or -1. */
  function findTyped(key: string): number {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      state.text = "";
    }, TYPEAHEAD_RESET_MS);
    state.text += key.toLowerCase();
    // Pressing one letter repeatedly cycles through the options that start with it.
    const cycling = [...state.text].every((character) => character === state.text.charAt(0));
    const query = cycling ? state.text.charAt(0) : state.text;
    const from = open ? active : selectedIndex;
    const start = cycling ? from + 1 : Math.max(from, 0);
    for (let offset = 0; offset < flat.length; offset += 1) {
      const index = (start + offset) % flat.length;
      if (flat[index]?.label.toLowerCase().startsWith(query)) return index;
    }
    return -1;
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const { key } = event;
    const last = flat.length - 1;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(key)) {
      event.preventDefault();
      openList(key === "Home" ? 0 : key === "End" ? last : selectedIndex);
      return;
    }
    if (open) {
      const moves: Partial<Record<string, number>> = {
        ArrowDown: Math.min(active + 1, last),
        ArrowUp: Math.max(active - 1, 0),
        Home: 0,
        End: last,
        PageDown: Math.min(active + PAGE_SIZE, last),
        PageUp: Math.max(active - PAGE_SIZE, 0),
      };
      const next = moves[key];
      if (next !== undefined) {
        event.preventDefault();
        setActive(next);
        return;
      }
      // A space continues a search in progress, as in "Sort: Due date".
      if (key === "Enter" || (key === " " && !typeahead.current.text)) {
        event.preventDefault();
        choose(active);
        return;
      }
      if (key === "Escape") {
        // Close only the list, not a dialog around it.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (key === "Tab") {
        setOpen(false);
        return;
      }
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const index = findTyped(key);
      if (index < 0) return;
      if (open) setActive(index);
      else choose(index);
    }
  }

  function renderOption(option: Option<T>) {
    const index = indexOf.get(option.value) ?? -1;
    const isSelected = option.value === value;
    return (
      <div
        key={option.value}
        id={optionId(index)}
        role="option"
        aria-selected={isSelected}
        data-active={index === active ? "" : undefined}
        onClick={() => choose(index)}
        onMouseMove={() => {
          if (index !== active) setActive(index);
        }}
        className="relative flex min-h-8 cursor-pointer items-center rounded-md py-1.5 pr-8 pl-2.5 text-sm select-none aria-selected:font-medium data-active:bg-accent data-active:text-accent-foreground"
      >
        <span className="truncate">{option.label}</span>
        {isSelected ? (
          <Check aria-hidden="true" className="absolute right-2 size-4 text-brand" />
        ) : null}
      </div>
    );
  }

  return (
    <div data-slot="select" className={cn("relative min-w-0", className)}>
      <button
        ref={mergeRefs(ref, triggerRef)}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && flat.length > 0 ? optionId(active) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        className={triggerClassName}
        {...aria}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-aria-expanded:rotate-180"
        />
      </button>
      {open ? (
        <div
          ref={popupRef}
          popover={POPOVER_MODE}
          className={cn(
            popupClassName,
            "max-h-[min(18rem,var(--available-height,18rem))] overflow-y-auto overscroll-contain",
          )}
          // Keep focus on the trigger while the pointer picks an option.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div role="listbox" id={listboxId} aria-labelledby={triggerId}>
            {flat.length === 0 ? (
              <p className="px-2.5 py-1.5 text-sm text-muted-foreground">No options</p>
            ) : null}
            {options.map((item, itemIndex) =>
              isGroup(item) ? (
                <div
                  key={`group-${item.label}`}
                  role="group"
                  aria-labelledby={`${baseId}-group-${itemIndex}`}
                >
                  <div
                    id={`${baseId}-group-${itemIndex}`}
                    className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                  >
                    {item.label}
                  </div>
                  {item.options.map(renderOption)}
                </div>
              ) : (
                renderOption(item)
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
