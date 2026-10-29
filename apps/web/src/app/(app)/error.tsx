"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { type ErrorBoundaryProps, errorDigest, useReportError } from "@/components/error-fallback";
import { Button, buttonVariants } from "@/components/ui/button";

/** Errors in a page keep the app shell, so navigation still works. */
export default function AppError({ error, retry }: ErrorBoundaryProps) {
  useReportError(error);
  const digest = errorDigest(error);

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center"
    >
      <div className="flex size-11 items-center justify-center rounded-full border bg-card text-warning shadow-elevation-1">
        <TriangleAlert className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-base font-semibold">This page couldn’t be shown</h1>
        <p className="mx-auto max-w-sm text-sm text-pretty text-muted-foreground">
          Something went wrong while loading it. Try again, or use the sidebar to go elsewhere.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={retry}>
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to dashboard
        </Link>
      </div>
      {digest ? <p className="text-xs text-muted-foreground">Reference: {digest}</p> : null}
    </div>
  );
}
