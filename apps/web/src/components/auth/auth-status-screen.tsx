import { LoaderCircle, TriangleAlert } from "lucide-react";

import { OrbitMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

/** Placeholder shaped like the auth card while the sign-in configuration loads. */
export function AuthFormSkeleton({ label, fields = 2 }: { label: string; fields?: number }) {
  return (
    <div className="w-full space-y-6">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div
        aria-hidden="true"
        className="rounded-2xl border bg-card/95 p-6 shadow-elevation-3 sm:p-8"
      >
        <div className="mb-7 flex flex-col items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl border bg-background shadow-elevation-1">
            <OrbitMark className="size-7" />
          </span>
          <div className="flex w-full flex-col items-center gap-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
        </div>
        <div className="space-y-4">
          {Array.from({ length: fields }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9" />
            </div>
          ))}
          <Skeleton className="h-9" />
        </div>
      </div>
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
