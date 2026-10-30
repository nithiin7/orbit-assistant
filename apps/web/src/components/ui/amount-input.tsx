"use client";

import type { Currency } from "@orbit/contracts";
import { type ComponentProps, useLayoutEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import {
  amountCharactersBefore,
  caretAfterAmountCharacters,
  formatAmountInput,
} from "@/lib/finance";
import { mergeRefs } from "@/utils/common";

type AmountInputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  /** Gets the regrouped text, such as `1,00,000.5`, which `parseAmount` reads. */
  onValueChange: (value: string) => void;
  currency: Currency;
};

/**
 * A money input that groups digits as they are typed, the currency's way: `1,00,000` for INR,
 * `100,000` for USD. The caret stays beside the digit it was next to, and Backspace or Delete
 * next to a separator removes the digit beyond it.
 */
export function AmountInput({
  value,
  onValueChange,
  currency,
  ref,
  onKeyDown,
  ...props
}: AmountInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Kept characters before the caret at the last edit, to restore it after regrouping. */
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caret.current === null || !input) return;
    const position = caretAfterAmountCharacters(input.value, caret.current);
    input.setSelectionRange(position, position);
    caret.current = null;
  });

  return (
    <Input
      ref={mergeRefs(ref, inputRef)}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={formatAmountInput(value, currency)}
      onChange={(event) => {
        const { value: typed, selectionStart } = event.target;
        caret.current = amountCharactersBefore(typed, selectionStart ?? typed.length);
        onValueChange(formatAmountInput(typed, currency));
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        const input = event.currentTarget;
        const { selectionStart: start, selectionEnd: end } = input;
        if (start === null || start !== end) return;
        // Step over a separator so the key deletes the digit beyond it.
        if (event.key === "Backspace" && input.value[start - 1] === ",") {
          input.setSelectionRange(start - 1, start - 1);
        } else if (event.key === "Delete" && input.value[start] === ",") {
          input.setSelectionRange(start + 1, start + 1);
        }
      }}
      {...props}
    />
  );
}
