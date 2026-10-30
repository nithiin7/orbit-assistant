"use client";

import "@/styles/globals.css";

import { type ErrorBoundaryProps, ErrorPage } from "@/components/error-fallback";
import { ThemeProvider } from "@/providers/theme";
import { fontVariables } from "@/styles/fonts";

/**
 * Replaces the root layout when the layout itself fails, so it renders its own document. The
 * theme provider restores the chosen theme, which the root layout would normally apply.
 */
export default function GlobalError(props: ErrorBoundaryProps) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
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
