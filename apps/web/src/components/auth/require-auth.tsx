"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { signInPath } from "@/lib/auth/redirect";
import { useAuth } from "@/providers/auth-provider";

import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";

/**
 * Renders its children only for a signed-in user, and sends everyone else to sign in. This
 * guards the UI; the API independently rejects requests without a valid token.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, retry } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === "signed-out") router.replace(signInPath(pathname));
  }, [state.status, router, pathname]);

  switch (state.status) {
    case "signed-in":
      return children;
    case "error":
      return <AuthErrorScreen message={state.message} onRetry={retry} />;
    case "signed-out":
      return <AuthLoadingScreen label="Redirecting to sign in…" />;
    case "loading":
      return <AuthLoadingScreen />;
  }
}
