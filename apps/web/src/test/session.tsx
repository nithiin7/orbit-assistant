import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { createQueryClient } from "@/api/query-client";
import { RequireAuth } from "@/components/auth/require-auth";
import { writeLocalSession } from "@/lib/auth/local-session";
import { AuthProvider } from "@/providers/auth-provider";
import { AvatarProvider } from "@/providers/avatar-provider";
import { QueryProvider } from "@/providers/query-provider";
import { WorkspaceProvider } from "@/providers/workspace-provider";

export const SESSION_TOKEN = "local-session-token";

/** Store a local session as if the user had signed in earlier. */
export function storeSession(token = SESSION_TOKEN) {
  writeLocalSession({ token, expiresAt: "2999-01-01T00:00:00Z" });
}

/**
 * Render `ui` inside the real auth and workspace providers, with a stored local session.
 * Mock the API (config, `/me`, workspaces, and the profile photo) with `mockApi` first.
 * Each render gets an empty query cache that doesn't retry, so failures show at once.
 */
export async function renderSignedIn(ui: ReactNode) {
  storeSession();
  const result = render(
    <AuthProvider>
      <QueryProvider client={createQueryClient({ retry: false })}>
        <RequireAuth>
          <AvatarProvider>
            <WorkspaceProvider>
              <div data-testid="signed-in">{ui}</div>
            </WorkspaceProvider>
          </AvatarProvider>
        </RequireAuth>
      </QueryProvider>
    </AuthProvider>,
  );
  // RequireAuth renders its children only once `/me` confirmed the session.
  await screen.findByTestId("signed-in");
  return result;
}
