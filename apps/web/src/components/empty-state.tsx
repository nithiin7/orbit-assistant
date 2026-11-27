import { LayoutTemplate, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button, buttonVariants } from "@/components/ui/button";

/** Where "Start from a template" goes: a link to a templates view, or a handler that opens a picker. */
export type EmptyStateTemplate = { href: string } | { onClick: () => void };

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  /** One line on what belongs here. */
  description: string;
  /** Adds a "Start from a template" button after any other actions. */
  template?: EmptyStateTemplate;
  /** Optional working actions, such as a link back to the dashboard. */
  children?: ReactNode;
};

/**
 * A module's empty view: an illustration, a title, one line of explanation, and its actions.
 * Modules with ready-made starters pass `template` so every one offers them the same way.
 */
export function EmptyState({ icon, title, description, template, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center lg:py-24">
      <EmptyIllustration icon={icon} />
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      {children || template ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {children}
          {template ? <StartFromTemplate template={template} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The "Start from a template" button, for empty views that lay out their own actions. */
export function StartFromTemplate({ template }: { template: EmptyStateTemplate }) {
  const content = (
    <>
      <LayoutTemplate aria-hidden="true" />
      Start from a template
    </>
  );
  return "href" in template ? (
    <Link href={template.href} className={buttonVariants({ variant: "soft" })}>
      {content}
    </Link>
  ) : (
    <Button variant="soft" onClick={template.onClick}>
      {content}
    </Button>
  );
}

/** Two tilted cards behind the module's icon: the same small scene in every module. */
function EmptyIllustration({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div aria-hidden="true" className="relative h-24 w-32">
      <div className="absolute top-2 left-3 h-14 w-20 -rotate-8 rounded-xl border bg-card shadow-elevation-1">
        <div className="space-y-1.5 p-2.5">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
          <div className="h-1.5 w-7 rounded-full bg-muted-foreground/15" />
        </div>
      </div>
      <div className="absolute top-4 right-3 h-14 w-20 rotate-6 rounded-xl border bg-card shadow-elevation-1">
        <div className="space-y-1.5 p-2.5">
          <div className="h-1.5 w-12 rounded-full bg-muted-foreground/25" />
          <div className="h-1.5 w-8 rounded-full bg-muted-foreground/15" />
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/15" />
        </div>
      </div>
      <div className="absolute top-1 right-4 size-2 rounded-full bg-brand-2/70" />
      <div className="absolute bottom-3 left-5 size-1.5 rounded-full bg-brand/50" />
      <div className="absolute bottom-0 left-1/2 flex size-12 -translate-x-1/2 items-center justify-center rounded-2xl bg-linear-to-br from-brand to-brand-2 shadow-elevation-2 ring-4 ring-background">
        <Icon className="size-5 text-white" />
      </div>
    </div>
  );
}
