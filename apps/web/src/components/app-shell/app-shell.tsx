import type { ReactNode } from "react";

import { CommandPaletteProvider } from "@/components/command-palette/command-palette";
import { QuickCaptureProvider } from "@/components/notes/quick-capture";

import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <QuickCaptureProvider>
      <CommandPaletteProvider>
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow-elevation-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <div className="flex min-h-dvh">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <main id="main" tabIndex={-1} className="flex-1 outline-none">
              {/* Fluid width: content fills the screen; pages constrain prose themselves. */}
              <div className="mx-auto w-full max-w-[160rem] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10 2xl:px-14 2xl:py-12 3xl:px-20">
                {children}
              </div>
            </main>
          </div>
        </div>
      </CommandPaletteProvider>
    </QuickCaptureProvider>
  );
}
