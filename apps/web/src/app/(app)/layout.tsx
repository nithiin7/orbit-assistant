import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { RequireAuth } from "@/components/auth/require-auth";
import { SetupRedirect } from "@/components/setup/setup-redirect";
import { AvatarProvider } from "@/providers/avatar";
import { WorkspaceProvider } from "@/providers/workspace";

/**
 * Every route in this group requires a signed-in user and has an active workspace. A new user
 * goes to the setup guide first.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <SetupRedirect>
        <AvatarProvider>
          <WorkspaceProvider>
            <AppShell>{children}</AppShell>
          </WorkspaceProvider>
        </AvatarProvider>
      </SetupRedirect>
    </RequireAuth>
  );
}
