import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/utils/common";

/**
 * A styled native `<select>`: keyboard, screen reader, and mobile pickers work as the platform
 * intends. `className` sizes the wrapper.
 */
function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <div data-slot="native-select" className={cn("relative", className)}>
      <select
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-card py-1 pr-8 pl-3 text-sm shadow-elevation-1 transition-[border-color,box-shadow] duration-150 outline-none dark:bg-transparent",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-50 dark:[&>option]:bg-popover",
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
