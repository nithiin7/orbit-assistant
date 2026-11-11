"use client";

import { frameLook } from "@/components/achievements/cosmetics";
import { useEquippedRewards } from "@/hooks/use-achievements";
import { workspaceInitial } from "@/lib/workspaces";
import { useCurrentUser } from "@/providers/auth";
import { useAvatar } from "@/providers/avatar";
import { cn } from "@/utils/common";

const sizes = {
  sm: "size-7 text-xs shadow-elevation-1",
  md: "size-12 text-lg",
  lg: "size-20 text-2xl",
  xl: "size-28 text-4xl",
} as const;

/** How thick the frame ring is at each size. */
const frameWidths = {
  sm: "p-[2px]",
  md: "p-[3px]",
  lg: "p-1",
  xl: "p-[5px]",
} as const;

/**
 * The signed-in user's photo, or their initial, in the avatar frame they wear. Decorative: the
 * name is always shown beside it. `frame` previews another frame (`null` for none).
 */
export function UserAvatar({
  size = "md",
  frame,
}: {
  size?: keyof typeof sizes;
  frame?: string | null;
}) {
  const user = useCurrentUser();
  const { url } = useAvatar();
  const equipped = useEquippedRewards();
  const look = frameLook(frame === undefined ? equipped?.frame : frame);

  const avatar = (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-subtle font-semibold text-brand",
        sizes[size],
        look && "relative ring-2 ring-background",
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
  if (!look) return avatar;

  return (
    <span
      aria-hidden="true"
      data-frame=""
      className={cn("relative inline-flex shrink-0 rounded-full", frameWidths[size])}
      style={{ boxShadow: look.glow }}
    >
      <span
        className={cn("absolute inset-0 rounded-full", look.spin && "animate-spin-slow")}
        style={{ background: look.background }}
      />
      {look.halo ? (
        <span
          className="absolute -inset-[3px] rounded-full border"
          style={{ borderColor: look.halo }}
        />
      ) : null}
      {avatar}
    </span>
  );
}
