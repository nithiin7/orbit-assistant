import type { ComponentProps } from "react";

import { cn } from "@/utils/common";

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm shadow-elevation-1 transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground dark:bg-transparent",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
