"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { settingsHref } from "@/lib/settings";
import { useCurrentUser } from "@/providers/auth";
import { cn } from "@/utils/common";

/** The signed-in user's name and email on a tinted card, opening account settings. */
export function ProfileLink({ active = false }: { active?: boolean }) {
  const user = useCurrentUser();

  return (
    <Link
      href={settingsHref("account")}
      aria-label={`Account: ${user.display_name}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3.5 rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-4 shadow-elevation-1 transition-[box-shadow,border-color] duration-150 outline-none hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-brand/40 ring-1 ring-brand/20",
      )}
    >
      <UserAvatar />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base font-semibold">{user.display_name}</span>
        <span className="truncate text-sm text-muted-foreground">{user.email}</span>
      </span>
      <ChevronRight
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-safe:group-hover:translate-x-0.5",
          active && "text-brand",
        )}
        aria-hidden="true"
      />
    </Link>
  );
}
