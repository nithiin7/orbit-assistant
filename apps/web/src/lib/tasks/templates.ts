/**
 * Ready-made task checklists, offered from the Tasks empty view. Using one adds its tasks to the
 * list in view; they're ordinary tasks afterwards, so each can be edited, dated, or deleted.
 */

import type { CreateTaskRequest } from "@orbit/contracts";
import { BriefcaseBusiness, House, type LucideIcon, Plane, Sparkles, Truck } from "lucide-react";

export type TaskTemplate = {
  id: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  tasks: readonly string[];
};

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: "weekly-reset",
    name: "Weekly reset",
    blurb: "An hour on Sunday that makes the week calmer.",
    icon: Sparkles,
    tasks: [
      "Review last week’s tasks",
      "Plan the week’s top three",
      "Check the calendar for the week",
      "Clear the inbox",
      "Tidy the desk",
    ],
  },
  {
    id: "moving-house",
    name: "Moving house",
    blurb: "The things that are easy to forget before a move.",
    icon: Truck,
    tasks: [
      "Book movers or a van",
      "Update address with the bank",
      "Redirect post",
      "Set up internet at the new place",
      "Take meter readings",
      "Return the old keys",
    ],
  },
  {
    id: "trip-prep",
    name: "Trip prep",
    blurb: "From bookings to the day you leave.",
    icon: Plane,
    tasks: [
      "Check passport and visas",
      "Book travel and stay",
      "Arrange travel insurance",
      "Plan getting to the airport",
      "Pack",
      "Set an out-of-office reply",
    ],
  },
  {
    id: "home-upkeep",
    name: "Home upkeep",
    blurb: "Small jobs that keep a home running well.",
    icon: House,
    tasks: [
      "Test the smoke alarms",
      "Clean the fridge",
      "Change the bedsheets",
      "Check for expiring documents",
      "Water the plants",
    ],
  },
  {
    id: "new-job",
    name: "First week at a new job",
    blurb: "Settle in and meet the people who matter.",
    icon: BriefcaseBusiness,
    tasks: [
      "Set up accounts and tools",
      "Meet your manager about goals",
      "Introduce yourself to the team",
      "Read the onboarding docs",
      "Note questions to ask",
    ],
  },
];

/** The requests that add a template's tasks, in order, to `listId` (or no list). */
export function taskTemplateRequests(
  template: TaskTemplate,
  listId: string | null,
): CreateTaskRequest[] {
  return template.tasks.map((title) => ({
    title,
    description: "",
    priority: "none",
    list_id: listId,
  }));
}
