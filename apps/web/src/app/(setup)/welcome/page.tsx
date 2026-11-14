import type { Metadata } from "next";
import { Suspense } from "react";

import { SetupGuide } from "@/components/setup/setup-guide";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Get Orbit set up for you in a few short steps.",
};

export default function WelcomePage() {
  return (
    <Suspense>
      <SetupGuide />
    </Suspense>
  );
}
