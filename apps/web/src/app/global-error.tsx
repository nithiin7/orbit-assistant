"use client";

import "./globals.css";

import { type ErrorBoundaryProps, ErrorPage } from "@/components/error-fallback";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Replaces the root layout when the layout itself fails, so it renders its own document. The
 * theme provider restores the chosen theme, which the root layout would normally apply.
 */
export default function GlobalError(props: ErrorBoundaryProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <title>Something went wrong · Orbit</title>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ErrorPage {...props} />
        </ThemeProvider>
      </body>
    </html>
  );
}
