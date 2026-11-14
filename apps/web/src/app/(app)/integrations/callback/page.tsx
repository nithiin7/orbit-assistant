import type { Metadata } from "next";
import { Suspense } from "react";

import { OAuthCallback } from "@/components/integrations/oauth-callback";

// The address carries a one-time code; never send it to other sites as a referrer.
export const metadata: Metadata = {
  title: "Connecting…",
  description: "Finishing the connection to your Google or Microsoft account.",
  referrer: "no-referrer",
};

export default function IntegrationCallbackPage() {
  return (
    <Suspense>
      <OAuthCallback />
    </Suspense>
  );
}
