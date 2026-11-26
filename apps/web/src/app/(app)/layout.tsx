import type { ReactNode } from "react";

import { AchievementWatcher } from "@/components/achievements/achievement-watcher";
import { AppShell } from "@/components/app-shell/app-shell";
import { RequireAuth } from "@/components/auth/require-auth";
import { SetupRedirect } from "@/components/setup/setup-redirect";
import { Toaster } from "@/components/toaster";
import { AvatarProvider } from "@/providers/avatar";
import { ToastProvider } from "@/providers/toast";
import { WorkspaceProvider } from "@/providers/workspace";

/**
 * Every route in this group requires a signed-in user and has an active workspace. A new user
 * goes to the setup guide first. Achievements are checked as they use the app; toasts (such as Undo) show above every page.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <SetupRedirect>
        <AvatarProvider>
          <WorkspaceProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
              <Toaster />
            </ToastProvider>
            <AchievementWatcher />
          </WorkspaceProvider>
        </AvatarProvider>
      </SetupRedirect>
    </RequireAuth>
  );
}
