"use client";

import { ArrowRight, Sparkles, X } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { SETUP_PATH } from "@/lib/setup";

/** A reminder on the dashboard while the setup guide was left for later. */
export function SetupCard() {
  const setup = useSetupStatus();
  if (setup.status !== "deferred") return null;

  return (
    <section
      aria-labelledby="setup-card-title"
      className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-4 shadow-elevation-1 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
      >
        <Sparkles className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 id="setup-card-title" className="text-base font-semibold">
          Finish setting up Orbit
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">
          {setup.error ??
            "Theme, money, health, connected accounts, and AI. A few minutes, all optional."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link href={SETUP_PATH} className={buttonVariants({ size: "sm" })}>
          Continue setup
          <ArrowRight aria-hidden="true" />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss setup reminder"
          disabled={setup.saving}
          onClick={() => void setup.save("done")}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
