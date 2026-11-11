import type { Metadata } from "next";
import { Suspense } from "react";

import { ProfilePanel } from "@/components/achievements/profile-view";

export const metadata: Metadata = { title: "Profile" };

/** Achievements, level, and the XP store. The view lives in the URL, read on the client. */
export default function ProfilePage() {
  return (
    <Suspense>
      <ProfilePanel />
    </Suspense>
  );
}
