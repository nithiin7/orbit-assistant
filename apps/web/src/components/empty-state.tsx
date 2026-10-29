import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional working actions, such as a link back to the dashboard. */
  children?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border bg-card shadow-elevation-1">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
