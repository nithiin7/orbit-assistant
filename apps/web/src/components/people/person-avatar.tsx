import type { Person } from "@orbit/contracts";

import { initials, personTone } from "@/lib/people";
import { cn } from "@/utils/common";

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-12 text-base",
  lg: "size-16 text-xl",
  xl: "size-20 text-2xl",
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
        "inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br font-semibold tracking-wide ring-1 select-none",
        SIZES[size],
        personTone(person.id).avatar,
        className,
      )}
    >
      {initials(person.name)}
    </span>
  );
}
