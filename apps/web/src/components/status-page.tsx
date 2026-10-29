import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type StatusPageProps = {
  icon: LucideIcon;
  /** A short label above the title, such as an HTTP status code. */
  eyebrow?: string;
  title: string;
  description: string;
  /** Tone of the icon: neutral for missing pages, warning for failures. */
  tone?: "neutral" | "warning";
  /** Working actions, such as a link home or a retry. */
  children?: ReactNode;
  /** Small print under the actions, such as an error reference. */
  footnote?: ReactNode;
};

/**
 * A full-page message outside the app shell (404, unexpected errors). It matches the sign-in
 * screens and works whether or not anyone is signed in.
 */
export function StatusPage({
  icon: Icon,
  eyebrow,
  title,
  description,
  tone = "neutral",
  children,
  footnote,
}: StatusPageProps) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      {/* Decorative brand glow, as on the sign-in screens. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(56rem_32rem_at_50%_-8rem,var(--brand-subtle),transparent_70%)]"
      />
      <header className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
        <Logo tagline />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-14">
        <div className="w-full max-w-md animate-page-in rounded-2xl border bg-card/95 p-6 text-center shadow-elevation-3 backdrop-blur-sm sm:p-8">
          <div className="flex flex-col items-center gap-4">
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-xl border bg-background shadow-elevation-1",
                tone === "warning" ? "text-warning" : "text-muted-foreground",
              )}
            >
              <Icon className="size-6" aria-hidden="true" />
            </span>
            <div className="space-y-1.5">
              {eyebrow ? (
                <p className="text-xs font-semibold tracking-widest text-brand uppercase">
                  {eyebrow}
                </p>
              ) : null}
              <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
              <p className="mx-auto max-w-sm text-sm text-pretty text-muted-foreground">
                {description}
              </p>
            </div>
            {children ? (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {children}
              </div>
            ) : null}
            {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
