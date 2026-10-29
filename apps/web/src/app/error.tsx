"use client";

import { type ErrorBoundaryProps, ErrorPage } from "@/components/error-fallback";

/** Catches errors below the root layout, including the app shell and the sign-in screens. */
export default function RootError(props: ErrorBoundaryProps) {
  return <ErrorPage {...props} />;
}
