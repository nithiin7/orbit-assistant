import "@/styles/globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { appearancePreferenceScript } from "@/lib/appearance-preference";
import { navPreferenceScript, navPreferenceStyles } from "@/lib/nav-preference";
import { sidebarPreferenceScript } from "@/lib/sidebar-preference";
import { AuthProvider } from "@/providers/auth";
import { QueryProvider } from "@/providers/query";
import { ThemeProvider } from "@/providers/theme";
import { fontVariables } from "@/styles/fonts";

const DESCRIPTION =
  "Orbit is an open-source, privacy-first personal assistant you host yourself: tasks, notes, calendar, habits, health, finance, and more, in one place.";

export const metadata: Metadata = {
  title: { default: "Orbit", template: "%s · Orbit" },
  description: DESCRIPTION,
  applicationName: "Orbit",
  keywords: [
    "personal assistant",
    "self-hosted",
    "privacy-first",
    "open source",
    "tasks",
    "notes",
    "habits",
    "personal finance",
  ],
  openGraph: {
    type: "website",
    siteName: "Orbit",
    title: { default: "Orbit", template: "%s · Orbit" },
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: { default: "Orbit", template: "%s · Orbit" },
    description: DESCRIPTION,
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfaf6" },
    { media: "(prefers-color-scheme: dark)", color: "#120f0c" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Static, first-party scripts: restore the sidebar and appearance preferences before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: sidebarPreferenceScript }} />
        <script dangerouslySetInnerHTML={{ __html: navPreferenceScript }} />
        <style dangerouslySetInnerHTML={{ __html: navPreferenceStyles }} />
        <script dangerouslySetInnerHTML={{ __html: appearancePreferenceScript }} />
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
