import type { ComponentProps } from "react";

import { cn } from "@/utils/common";

type CheckboxProps = Omit<ComponentProps<"input">, "type"> & {
  /** `round` suits checklists, such as tasks to complete; `square` suits ordinary forms. */
  shape?: "round" | "square";
};

/**
 * A native checkbox drawn to match the design: a ring that fills with the brand color and shows
 * a check mark when checked. The real input stays in place, so labels, keyboard, and assistive
 * technology work as usual.
 */
function Checkbox({ className, shape = "square", ...props }: CheckboxProps) {
  return (
    <span
      data-slot="checkbox"
      className={cn("relative inline-flex size-5 shrink-0 items-center justify-center", className)}
    >
      <input
        type="checkbox"
        className={cn(
          "peer size-full cursor-pointer appearance-none border-2 border-input bg-card transition-[background-color,border-color,box-shadow] duration-150 outline-none",
          shape === "round" ? "rounded-full" : "rounded-md",
          "checked:border-brand checked:bg-brand hover:border-brand/60",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-wait disabled:opacity-60",
        )}
        {...props}
      />
      {/* Lucide's check mark, drawn along its stroke when checked (`check-draw`). */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute size-3 text-brand-foreground check-draw"
      >
        <path d="M20 6 9 17l-5-5" pathLength={1} />
      </svg>
    </span>
  );
}

export { Checkbox };
