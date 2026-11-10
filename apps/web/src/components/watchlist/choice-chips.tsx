"use client";

import { type KeyboardEvent, useId, useRef } from "react";

import { cn } from "@/utils/common";

/**
 * A small set of mutually exclusive choices shown as chips (the ARIA radio group pattern), for
 * picks such as a status or a kind. Arrow keys move the choice.
 */
export function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  size = "default",
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  size?: "default" | "sm";
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div className="space-y-1.5">
      <span id={`${id}-label`} className={cn("block text-sm font-medium", hideLabel && "sr-only")}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
        {options.map((option, index) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "rounded-full border font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
                checked
                  ? "border-transparent bg-brand text-brand-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
