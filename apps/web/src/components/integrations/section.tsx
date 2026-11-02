import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A settings card: an icon, a title, one line on what it's for, then its content. */
export function Section({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-2xl border bg-card shadow-elevation-1"
    >
      <header className="flex flex-wrap items-start gap-3 border-b px-4 py-4 sm:px-5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-pretty text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="space-y-4 px-4 py-5 sm:px-5">{children}</div>
    </section>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
