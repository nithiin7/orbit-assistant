"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { StatusPage } from "@/components/status-page";
import { Button, buttonVariants } from "@/components/ui/button";

export type ErrorBoundaryProps = {
  error: unknown;
  retry: () => void;
};

/**
 * Next.js replaces server error messages with a generic one in production and adds a `digest`
 * that matches the server logs. Show only the digest; never the message, which can leak details.
 */
export function errorDigest(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("digest" in error)) return undefined;
  return typeof error.digest === "string" ? error.digest : undefined;
}

/** Report an error caught by a boundary to the browser console, where developers look for it. */
export function useReportError(error: unknown): void {
  useEffect(() => {
    console.error(error);
  }, [error]);
}

/** The full-page fallback for unexpected errors, outside the app shell. */
export function ErrorPage({ error, retry }: ErrorBoundaryProps) {
  useReportError(error);
  const digest = errorDigest(error);

  return (
    <StatusPage
      icon={TriangleAlert}
      tone="warning"
      eyebrow="Unexpected error"
      title="Something went wrong"
      description="Orbit hit a problem it couldn’t recover from. Try again, or head back to the dashboard."
      footnote={digest ? <>Reference: {digest}</> : null}
    >
      <Button size="sm" onClick={retry}>
        Try again
      </Button>
      <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Back to Orbit
      </Link>
    </StatusPage>
  );
}
