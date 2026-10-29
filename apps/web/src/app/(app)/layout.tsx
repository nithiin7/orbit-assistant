import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { RequireAuth } from "@/components/auth/require-auth";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";

/** Every route in this group requires a signed-in user and has an active workspace. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <AppShell>{children}</AppShell>
      </WorkspaceProvider>
    </RequireAuth>
  );
}
