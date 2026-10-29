import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { RequireAuth } from "@/components/auth/require-auth";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { writeLocalSession } from "@/lib/auth/local-session";

export const SESSION_TOKEN = "local-session-token";

/** Store a local session as if the user had signed in earlier. */
export function storeSession(token = SESSION_TOKEN) {
  writeLocalSession({ token, expiresAt: "2999-01-01T00:00:00Z" });
}

/**
 * Render `ui` inside the real auth and workspace providers, with a stored local session.
 * Mock the API (config, `/me`, and workspaces) with `mockApi` first.
 */
export async function renderSignedIn(ui: ReactNode) {
  storeSession();
  const result = render(
    <AuthProvider>
      <RequireAuth>
        <WorkspaceProvider>
          <div data-testid="signed-in">{ui}</div>
        </WorkspaceProvider>
      </RequireAuth>
    </AuthProvider>,
  );
  // RequireAuth renders its children only once `/me` confirmed the session.
  await screen.findByTestId("signed-in");
  return result;
}
