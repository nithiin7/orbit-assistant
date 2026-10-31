import type { Metadata } from "next";
import { Suspense } from "react";

import { NotesPanel } from "@/components/notes/notes-view";

export const metadata: Metadata = { title: "Notes" };

/** The view, folder, tag, search, and open note live in the URL, read on the client. */
export default function NotesPage() {
  return (
    <Suspense>
      <NotesPanel />
    </Suspense>
  );
}
