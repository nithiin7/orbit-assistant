import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { Logo } from "@/components/logo";
import { AvatarProvider } from "@/providers/avatar";
import { WorkspaceProvider } from "@/providers/workspace";

/** The setup guide: signed in, with a workspace, but without the app's navigation. */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AvatarProvider>
        <WorkspaceProvider>
          <div className="relative isolate flex min-h-dvh flex-col">
            {/* Decorative brand glow behind the guide. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(56rem_32rem_at_50%_-8rem,var(--brand-subtle),transparent_70%)]"
            />
            <header className="flex h-14 items-center px-4 sm:px-6">
              <Logo tagline />
            </header>
            <main id="main" className="flex flex-1 justify-center px-4 pt-6 pb-16 sm:pt-10">
              <div className="w-full max-w-2xl">{children}</div>
            </main>
          </div>
        </WorkspaceProvider>
      </AvatarProvider>
    </RequireAuth>
  );
}
