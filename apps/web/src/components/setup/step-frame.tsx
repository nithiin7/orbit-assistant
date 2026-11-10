"use client";

import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

/** How a step moves through the guide. `back` is absent on the first step. */
export type StepNav = {
  back?: () => void;
  next: () => void;
};

/**
 * One step of the setup guide: a heading that takes focus when the step opens, so keyboard and
 * screen reader users land at the top of the new step, then the step's content and actions.
 */
export function StepFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <section aria-labelledby="setup-step-title" className="space-y-6">
      <div className="space-y-1.5">
        <h1
          id="setup-step-title"
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-balance outline-none"
        >
          {title}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Back, an optional Skip, and Continue. With `form`, Continue submits that form, which moves on
 * once it saves; otherwise it moves on at once.
 */
export function StepActions({
  nav,
  form,
  pending = false,
  skip = false,
  continueLabel = "Continue",
}: {
  nav: StepNav;
  form?: string;
  pending?: boolean;
  skip?: boolean;
  continueLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-5">
      {nav.back ? (
        <Button variant="ghost" onClick={nav.back} disabled={pending}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {skip ? (
          <Button variant="ghost" onClick={nav.next} disabled={pending}>
            Skip
          </Button>
        ) : null}
        {form ? (
          <Button type="submit" form={form} disabled={pending}>
            {pending ? "Saving…" : continueLabel}
          </Button>
        ) : (
          <Button onClick={nav.next}>{continueLabel}</Button>
        )}
      </div>
    </div>
  );
}
