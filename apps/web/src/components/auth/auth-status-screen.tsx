import { LoaderCircle, TriangleAlert } from "lucide-react";

import { OrbitMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/common";

type ScreenProps = {
  /** Fit inside the sign-in layout instead of filling the viewport. */
  compact?: boolean;
};

/** Placeholder while the session is checked or a redirect is in progress. */
export function AuthLoadingScreen({
  label = "Checking your session…",
  compact = false,
}: ScreenProps & { label?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-4",
        compact ? "min-h-80" : "min-h-dvh",
      )}
    >
      <OrbitMark className="size-9" />
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        {label}
      </p>
    </div>
  );
}

/** Error when the session can't be checked, with a working retry. */
export function AuthErrorScreen({
  message,
  onRetry,
  compact = false,
}: ScreenProps & { message: string; onRetry: () => void }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-4 text-center",
        compact ? "min-h-80" : "min-h-dvh",
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full border bg-card text-warning shadow-elevation-1">
        <TriangleAlert className="size-5" aria-hidden="true" />
      </span>
      <div role="alert" className="max-w-sm space-y-1">
        <h1 className="text-base font-semibold">Orbit can’t check your session</h1>
        <p className="text-sm text-pretty text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
