import { OrbitMark } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/utils/common";

/**
 * Placeholder with the app shell's layout, shown while the session is checked. It mirrors the
 * sidebar, the mobile top bar, and the main content padding so the real shell replaces it
 * without a layout jump.
 */
export function AppShellSkeleton({ label = "Checking your session…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div
        aria-hidden="true"
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar md:flex sidebar-collapsed:w-14"
      >
        <div className="flex h-14 shrink-0 items-center px-4">
          <Wordmark textClassName="sidebar-collapsed:opacity-0" />
        </div>
        <div className="px-2 pb-2">
          <Skeleton className="h-9" />
        </div>
        <div className="flex-1 space-y-1 px-2 py-2">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex h-9 items-center gap-3 px-2">
              <Skeleton className="size-5 shrink-0" />
              <Skeleton className="h-4 flex-1 sidebar-collapsed:hidden" />
            </div>
          ))}
        </div>
        <div className="shrink-0 space-y-2 border-t border-sidebar-border p-2">
          <Skeleton className="h-11" />
          <div className="flex gap-1 sidebar-collapsed:flex-col">
            <Skeleton className="size-9" />
            <Skeleton className="size-9" />
            <Skeleton className="size-9" />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-2 border-b px-2 md:hidden">
          <Skeleton className="size-9" />
          <Wordmark className="ml-1" />
          <Skeleton className="ml-auto size-9" />
          <Skeleton className="size-9" />
        </div>
        <div className="mx-auto w-full max-w-[160rem] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10 2xl:px-14 2xl:py-12 3xl:px-20">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-40 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The logo without its link, so the placeholder holds nothing focusable. */
function Wordmark({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <span
      className={cn("flex items-center gap-2 text-base font-semibold tracking-tight", className)}
    >
      <OrbitMark className="shrink-0" />
      <span className={textClassName}>Orbit</span>
    </span>
  );
}
