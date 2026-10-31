import type { Reminder } from "@orbit/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReminderItem } from "./reminder-item";

const reminder: Reminder = {
  id: "r1",
  workspace_id: "w1",
  task: null,
  commitment: null,
  title: "Rent due 16 Feb 2030",
  description: "INR 25000.00",
  enabled: true,
  start_date: "2030-02-15",
  time_of_day: "09:00:00",
  timezone: "UTC",
  recurrence: null,
  status: "scheduled",
  next_occurrence_at: "2030-02-15T09:00:00Z",
  last_occurrence_at: null,
  last_outcome: null,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
};

function renderItem(value: Reminder) {
  render(
    <ul>
      <ReminderItem
        reminder={value}
        viewerTimeZone="UTC"
        pending={false}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </ul>,
  );
}

describe("ReminderItem", () => {
  it("can be edited, switched off, and deleted when the user owns it", () => {
    renderItem(reminder);
    expect(screen.getByRole("button", { name: "Edit “Rent due 16 Feb 2030”" })).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Delete “Rent due 16 Feb 2030”" }),
    ).toBeInTheDocument();
  });

  it("shows recurrence, the linked task, and another time zone as chips", () => {
    renderItem({
      ...reminder,
      timezone: "Asia/Tokyo",
      recurrence: { frequency: "weekly", weekdays: ["mon", "thu"] },
      task: { id: "t1", title: "File taxes", status: "completed" },
    });
    expect(screen.getByText("Weekly on Mon, Thu")).toBeInTheDocument();
    expect(screen.getByText("File taxes")).toHaveClass("line-through");
    expect(screen.getByText("Asia / Tokyo")).toBeInTheDocument();
  });

  it("is read-only when a bill, subscription, or loan manages it", () => {
    renderItem({ ...reminder, commitment: { kind: "recurring_payment", id: "bill-1" } });
    expect(screen.getByText("Managed in Finance")).toBeInTheDocument();
    expect(screen.getByText("Rent due 16 Feb 2030")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
