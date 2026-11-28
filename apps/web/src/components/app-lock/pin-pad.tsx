"use client";

import { Check, Delete } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useId, useState } from "react";

import { digitFromKey } from "@/lib/app-lock";
import { cn } from "@/utils/common";
import { isEditableTarget } from "@/utils/keyboard";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

type PinPadProps = {
  /** How many digits the PIN has; the pad submits on its own once they're all in. */
  length: number;
  /** Names the PIN entry for assistive tech, e.g. "Enter your PIN". */
  label: string;
  onComplete: (pin: string) => void;
  /** Checking the PIN: entry pauses and the dots breathe. */
  busy?: boolean;
  /**
   * Changes each time a PIN is refused: the dots shake and clear. Pair it with a message, shown
   * by the caller.
   */
  rejection?: number;
  /** The PIN was accepted: the dots turn into a check. */
  accepted?: boolean;
  /** The key left of 0, such as Touch ID. */
  extraKey?: ReactNode;
  size?: "md" | "lg";
};

/**
 * A PIN entry: a row of dots and a phone-style keypad. Digits can also be typed or pasted
 * anywhere on the page, Backspace removes one, and Escape clears them. Once every digit is in,
 * the PIN is handed to `onComplete`.
 */
export function PinPad({
  length,
  label,
  onComplete,
  busy = false,
  rejection = 0,
  accepted = false,
  extraKey,
  size = "lg",
}: PinPadProps) {
  const id = useId();
  const [value, setValue] = useState("");
  const [seenRejection, setSeenRejection] = useState(rejection);
  const locked = busy || accepted;

  // A refused PIN clears, ready for the next try.
  if (rejection !== seenRejection) {
    setSeenRejection(rejection);
    setValue("");
  }

  function enter(digits: string) {
    if (locked) return;
    const next = (value + digits).slice(0, length);
    setValue(next);
    if (next.length === length) onComplete(next);
  }

  function remove() {
    if (!locked) setValue((current) => current.slice(0, -1));
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
    const digit = digitFromKey(event.key);
    if (digit !== null) {
      event.preventDefault();
      enter(digit);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      remove();
    } else if (event.key === "Escape" && value) {
      event.preventDefault();
      if (!locked) setValue("");
    }
  });

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    if (isEditableTarget(event.target)) return;
    const digits = event.clipboardData?.getData("text").replace(/\D/g, "") ?? "";
    if (!digits) return;
    event.preventDefault();
    if (locked) return;
    const next = digits.slice(0, length);
    setValue(next);
    if (next.length === length) onComplete(next);
  });

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => onKeyDown(event);
    const paste = (event: ClipboardEvent) => onPaste(event);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("paste", paste);
    };
  }, []);

  const large = size === "lg";
  const keyClassName = cn(
    "group relative grid place-items-center rounded-full text-foreground outline-none select-none",
    "transition-[background-color,scale,box-shadow] duration-150 ease-out active:scale-92",
    "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
    large ? "size-[clamp(3.25rem,8dvh,4.5rem)]" : "size-14",
  );
  const digitKeyClassName = cn(
    keyClassName,
    "border border-border/60 bg-card/70 shadow-elevation-1 backdrop-blur-sm",
    "hover:bg-brand-subtle/70 active:bg-brand-subtle",
    large ? "text-[clamp(1.375rem,3.6dvh,1.75rem)] font-light" : "text-xl font-normal",
  );

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col items-center">
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      <div
        // Remounting replays the shake each time a PIN is refused.
        key={rejection}
        className={cn(
          "flex items-center justify-center",
          large ? "mb-[clamp(0.875rem,3.5dvh,2.25rem)] h-6 gap-4" : "mb-6 h-5 gap-3.5",
          rejection > 0 && "animate-pin-shake",
          busy && "animate-pulse",
        )}
      >
        {accepted ? (
          <span className="grid size-6 animate-check-pop place-items-center rounded-full bg-success text-white">
            <Check aria-hidden="true" className="size-4" strokeWidth={3} />
          </span>
        ) : (
          Array.from({ length }, (_, index) => {
            const filled = index < value.length;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={cn(
                  "rounded-full transition-[background-color,border-color,box-shadow] duration-150",
                  large ? "size-3.5" : "size-3",
                  filled
                    ? "animate-pin-pop bg-brand shadow-[0_0_0_4px_var(--brand-subtle)]"
                    : "border-2 border-muted-foreground/35",
                  !filled && index === value.length && !locked && "border-brand/60",
                )}
              />
            );
          })
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {accepted ? "Unlocked." : `${value.length} of ${length} digits entered.`}
      </p>

      <div
        className={cn(
          "grid grid-cols-3",
          large
            ? "gap-x-[clamp(1rem,3dvh,1.5rem)] gap-y-[clamp(0.5rem,1.5dvh,1rem)]"
            : "gap-x-5 gap-y-3",
        )}
      >
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={digitKeyClassName}
            disabled={locked}
            onClick={() => enter(digit)}
          >
            {digit}
          </button>
        ))}
        <div
          className={cn(
            "grid place-items-center",
            large ? "size-[clamp(3.25rem,8dvh,4.5rem)]" : "size-14",
          )}
        >
          {extraKey}
        </div>
        <button
          type="button"
          className={digitKeyClassName}
          disabled={locked}
          onClick={() => enter("0")}
        >
          0
        </button>
        <button
          type="button"
          aria-label="Delete last digit"
          className={cn(
            keyClassName,
            "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            value.length === 0 && "invisible",
          )}
          disabled={locked || value.length === 0}
          onClick={remove}
        >
          <Delete aria-hidden="true" className={large ? "size-6" : "size-5"} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
