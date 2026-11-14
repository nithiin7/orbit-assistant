import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your day at a glance: tasks, events, habits, reminders, and money in one place.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
