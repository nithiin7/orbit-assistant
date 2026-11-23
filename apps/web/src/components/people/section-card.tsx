import type { LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

/** A titled card for one part of a person's detail: dates, money, gift ideas, the note. */
export function SectionCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** A small control at the end of the title row. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h3 id={id} className="flex items-center gap-2 text-sm font-semibold">
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-lg bg-brand-subtle text-brand"
          >
            <Icon className="size-3.5" />
          </span>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
