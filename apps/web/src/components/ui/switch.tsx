import type { ComponentProps } from "react";

import { cn } from "@/utils/common";

type SwitchProps = Omit<ComponentProps<"button">, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** An on/off switch (the ARIA switch pattern) for settings that take effect at once. */
function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        checked ? "border-transparent bg-brand" : "bg-muted",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-4.5 rounded-full bg-card shadow-elevation-1 transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-5.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export { Switch };
