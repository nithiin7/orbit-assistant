"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { AppShellSkeleton } from "@/components/app-shell/app-shell-skeleton";
import { SETUP_PATH } from "@/lib/setup";
import { useCurrentUser } from "@/providers/auth";

/** Sends a new user to the setup guide once; after that the app opens as usual. */
export function SetupRedirect({ children }: { children: ReactNode }) {
  const pending = useCurrentUser().setup_status === "pending";
  const router = useRouter();

  useEffect(() => {
    if (pending) router.replace(SETUP_PATH);
  }, [pending, router]);

  return pending ? <AppShellSkeleton /> : children;
}
