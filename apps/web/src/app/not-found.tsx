import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatusPage } from "@/components/status-page";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page doesn't exist in Orbit.",
};

/** Rendered outside the app shell, so it works whether or not anyone is signed in. */
export default function NotFound() {
  return (
    <StatusPage
      icon={Compass}
      eyebrow="404"
      title="This page drifted out of orbit"
      description="The page you requested doesn’t exist or has moved. Check the URL, or head back to Orbit."
    >
      <Link href="/" className={buttonVariants({ size: "sm" })}>
        Back to Orbit
      </Link>
    </StatusPage>
  );
}
