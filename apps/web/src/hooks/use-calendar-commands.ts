"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { calendarAgendaOptions, calendarEventListOptions } from "@/api/calendar";
import {
  useActiveWorkspaceId,
  useCalendarMutations,
  useViewerTimeZone,
} from "@/hooks/use-calendar";
import { calendarHref, occurrenceKey, todayIn } from "@/lib/calendar";
import { notesHref } from "@/lib/notes";
import { useAuth } from "@/providers/auth";
import { formatCalendarDate } from "@/utils/dates";

export type CalendarCommand = {
  id: string;
  label: string;
  description?: string;
  keywords: readonly string[];
  icon: "new" | "today" | "month" | "week" | "day" | "agenda" | "schedule" | "notes" | "event";
  /** Found by the API's search; shown whatever the query. */
  matched?: boolean;
  run: () => void;
};

const SEARCH_DELAY_MS = 200;

/**
 * Calendar commands for the command palette: create, navigate, schedule tasks, meeting notes for
 * the next event, and live event search. Data loads only while the palette is open.
 */
export function useCalendarCommands(open: boolean, query: string): CalendarCommand[] {
  const router = useRouter();
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const mutations = useCalendarMutations(workspaceId ?? "");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searching = open && search.length >= 2;
  const matches = useQuery({
    ...calendarEventListOptions(withToken, workspaceId, { q: search, limit: 6 }),
    enabled: searching,
  });
  const next = useQuery({
    ...calendarAgendaOptions(withToken, workspaceId, { limit: 1, include_tasks: false }),
    enabled: open,
  });

  if (!workspaceId) return [];
  const today = todayIn(timeZone);
  const go = (href: string) => () => router.push(href);
  const commands: CalendarCommand[] = [
    {
      id: "calendar-new",
      label: "Create event",
      keywords: ["new", "add", "event", "meeting", "appointment", "calendar"],
      icon: "new",
      run: go(`${calendarHref({ view: "week", date: today })}&new=1`),
    },
    {
      id: "calendar-today",
      label: "Go to today",
      description: "Calendar",
      keywords: ["today", "calendar", "now"],
      icon: "today",
      run: go(calendarHref({ view: "day", date: today })),
    },
    {
      id: "calendar-month",
      label: "Open month view",
      keywords: ["calendar", "month"],
      icon: "month",
      run: go(calendarHref({ view: "month", date: today })),
    },
    {
      id: "calendar-week",
      label: "Open week view",
      keywords: ["calendar", "week"],
      icon: "week",
      run: go(calendarHref({ view: "week", date: today })),
    },
    {
      id: "calendar-day",
      label: "Open day view",
      keywords: ["calendar", "day"],
      icon: "day",
      run: go(calendarHref({ view: "day", date: today })),
    },
    {
      id: "calendar-agenda",
      label: "Open upcoming agenda",
      keywords: ["calendar", "agenda", "upcoming", "schedule", "events"],
      icon: "agenda",
      run: go(calendarHref({ view: "agenda", date: today })),
    },
    {
      id: "calendar-schedule-task",
      label: "Schedule a task",
      description: "Plan unscheduled tasks onto the week",
      keywords: ["task", "schedule", "plan", "time block", "calendar"],
      icon: "schedule",
      run: go(calendarHref({ view: "week", date: today })),
    },
  ];
  const upcoming = next.data?.items[0]?.occurrence;
  if (upcoming) {
    commands.push({
      id: "calendar-meeting-notes",
      label: `Create meeting notes for “${upcoming.title}”`,
      description: `Next event, ${formatCalendarDate(upcoming.start.slice(0, 10))}`,
      keywords: ["meeting", "notes", "minutes", "event", "create"],
      icon: "notes",
      run: () => {
        mutations.createNote
          .mutateAsync({ eventId: upcoming.event_id, occurrenceStart: occurrenceKey(upcoming) })
          .then(
            (note) => router.push(notesHref({ noteId: note.id })),
            () => router.push(calendarHref({ view: "agenda", date: today })),
          );
      },
    });
  }
  if (searching && matches.data) {
    for (const event of matches.data.events) {
      commands.push({
        id: `calendar-event-${event.id}`,
        label: event.title,
        description: `${formatCalendarDate(event.start.slice(0, 10))}${event.location ? ` · ${event.location}` : ""}`,
        keywords: [],
        icon: "event",
        matched: true,
        run: go(calendarHref({ view: "day", date: event.start.slice(0, 10) })),
      });
    }
  }
  return commands;
}
