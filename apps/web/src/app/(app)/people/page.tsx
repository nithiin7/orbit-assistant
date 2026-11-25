import type { Metadata } from "next";
import { Suspense } from "react";

import { PeoplePanel } from "@/components/people/people-view";

export const metadata: Metadata = {
  title: "People",
  description:
    "The people who matter, their birthdays and anniversaries, and a nudge before each one.",
};

/** The view and the open person live in the URL, read on the client. The header lives in the
 * panel, whose action opens the page's dialog. */
export default function PeoplePage() {
  return (
    <Suspense>
      <PeoplePanel />
    </Suspense>
  );
}
