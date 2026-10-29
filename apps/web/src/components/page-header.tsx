import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Page-level controls, aligned to the trailing edge on wider screens. */
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? (
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
