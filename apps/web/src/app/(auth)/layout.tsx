import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { StorageIndicator } from "@/components/storage/storage-indicator";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      {/* Decorative brand glow behind the card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(56rem_32rem_at_50%_-8rem,var(--brand-subtle),transparent_70%)]"
      />
      <header className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
        <Logo tagline />
        <div className="flex items-center gap-2">
          <StorageIndicator />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-14">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        Orbit is private by default. Your data stays in the storage shown above.
      </footer>
    </div>
  );
}
