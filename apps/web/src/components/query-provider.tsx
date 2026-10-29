"use client";

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import { createQueryClient } from "@/api/query-client";
import { useAuth } from "@/components/auth/auth-provider";

/**
 * The query cache for the app. Must sit inside `AuthProvider`: cached data belongs to the
 * signed-in user, so it is dropped whenever they sign out or another user signs in.
 */
export function QueryProvider({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  const { state } = useAuth();
  const userId = state.status === "signed-in" ? state.user.id : null;

  // The cleanup runs when the user changes, clearing what the previous user loaded.
  useEffect(() => () => queryClient.clear(), [queryClient, userId]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
