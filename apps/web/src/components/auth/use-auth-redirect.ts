"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { AuthState } from "@/providers/auth-provider";

/** On the sign-in and sign-up pages: leave as soon as the user is signed in. */
export function useAuthRedirect(state: AuthState, next: string): void {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "signed-in") router.replace(next);
  }, [state.status, router, next]);
}
