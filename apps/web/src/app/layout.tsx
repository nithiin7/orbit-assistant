import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { sidebarPreferenceScript } from "@/lib/sidebar-preference";
import { AuthProvider } from "@/providers/auth";
import { QueryProvider } from "@/providers/query";
import { ThemeProvider } from "@/providers/theme";

export const metadata: Metadata = {
  title: { default: "Orbit", template: "%s · Orbit" },
  description: "Orbit is an open-source, privacy-first personal assistant.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1013" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Static, first-party script: restores the sidebar preference before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: sidebarPreferenceScript }} />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <QueryProvider>{children}</QueryProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
