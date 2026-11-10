import type { Metadata } from "next";
import { Suspense } from "react";

import { SetupGuide } from "@/components/setup/setup-guide";

export const metadata: Metadata = { title: "Welcome" };

export default function WelcomePage() {
  return (
    <Suspense>
      <SetupGuide />
    </Suspense>
  );
}
