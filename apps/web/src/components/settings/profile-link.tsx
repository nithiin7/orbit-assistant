"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { settingsHref } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/providers/auth-provider";

/** The signed-in user's name and email, opening account settings. */
export function ProfileLink({ active = false }: { active?: boolean }) {
  const user = useCurrentUser();

  return (
    <Link
      href={settingsHref("account")}
      aria-label={`Account: ${user.display_name}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-4 rounded-xl border bg-card px-4 py-4 transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent",
      )}
    >
      <UserAvatar />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base font-semibold">{user.display_name}</span>
        <span className="truncate text-sm text-muted-foreground">
          {user.email} · Profile and sign-in
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
