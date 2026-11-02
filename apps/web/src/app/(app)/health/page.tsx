import type { Metadata } from "next";
import { Suspense } from "react";

import { HealthPanel } from "@/components/fitness/health-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Health" };

/** The view, workout, exercise, or goal lives in the URL, read on the client. */
export default function HealthPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Health"
        description="Log workouts, track measurements, food, water, and activity, and work toward your goals. A personal tracker, not medical advice."
      />
      <Suspense>
        <HealthPanel />
      </Suspense>
    </div>
  );
}
