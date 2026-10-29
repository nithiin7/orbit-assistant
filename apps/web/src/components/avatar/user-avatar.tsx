"use client";

import { cn } from "@/lib/utils";
import { workspaceInitial } from "@/lib/workspaces";
import { useCurrentUser } from "@/providers/auth";
import { useAvatar } from "@/providers/avatar";

const sizes = {
  md: "size-12 text-lg",
  lg: "size-20 text-2xl",
} as const;

/** The signed-in user's photo, or their initial. Decorative: the name is always shown beside it. */
export function UserAvatar({ size = "md" }: { size?: keyof typeof sizes }) {
  const user = useCurrentUser();
  const { url } = useAvatar();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-subtle font-semibold text-brand",
        sizes[size],
      )}
    >
      {url ? (
        // An object URL for an already-resized photo; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        workspaceInitial(user.display_name)
      )}
    </span>
  );
}
