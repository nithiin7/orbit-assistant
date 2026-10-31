import type { Metadata } from "next";
import { Suspense } from "react";

import { CalendarPanel } from "@/components/calendar/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

/** The view and date live in the URL, read on the client. */
export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarPanel />
    </Suspense>
  );
}
