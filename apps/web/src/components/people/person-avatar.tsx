import type { Person } from "@orbit/contracts";

import { avatarTone, initials } from "@/lib/people";
import { cn } from "@/utils/common";

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-11 text-sm",
  lg: "size-16 text-xl",
} as const;

/** A person's initials on a tone of their own. Decorative: their name is always beside it. */
export function PersonAvatar({
  person,
  size = "md",
  className,
}: {
  person: Pick<Person, "id" | "name">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none",
        SIZES[size],
        avatarTone(person.id),
        className,
      )}
    >
      {initials(person.name)}
    </span>
  );
}
