import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { localDateString } from "@/utils/dates";

import { DatePicker } from "./date-picker";

function Due({ initial = "2026-10-30", clearable = false }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="due">Due date</label>
      <DatePicker id="due" value={value} onValueChange={setValue} clearable={clearable} />
      <output>{value || "none"}</output>
    </>
  );
}

const calendar = () => screen.getByRole("dialog");

describe("DatePicker", () => {
  it("shows the date, and picks another day from the calendar", async () => {
    const user = userEvent.setup();
    render(<Due />);
    const trigger = screen.getByRole("combobox", { name: "Due date" });
    expect(trigger).toHaveTextContent("Oct 30, 2026");

    await user.click(trigger);
    expect(calendar()).toHaveAccessibleName("October 2026");
    const chosen = within(calendar()).getByRole("button", { name: "Friday, October 30, 2026" });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(chosen).toHaveFocus();

    await user.click(within(calendar()).getByRole("button", { name: "Next month" }));
    expect(calendar()).toHaveAccessibleName("November 2026");
    await user.click(within(calendar()).getByRole("button", { name: "Monday, November 2, 2026" }));

    expect(screen.getByRole("status")).toHaveTextContent("2026-11-02");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves through days, weeks, and months with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Due />);

    await user.click(screen.getByRole("combobox", { name: "Due date" }));
    await user.keyboard("{ArrowRight}");
    expect(
      within(calendar()).getByRole("button", { name: "Saturday, October 31, 2026" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(calendar()).toHaveAccessibleName("November 2026");
    expect(
      within(calendar()).getByRole("button", { name: "Saturday, November 7, 2026" }),
    ).toHaveFocus();
    await user.keyboard("{PageUp}{Shift>}{PageDown}{/Shift}{Enter}");

    expect(screen.getByRole("status")).toHaveTextContent("2027-10-07");
  });

  it("closes on Escape without changing the date", async () => {
    const user = userEvent.setup();
    render(<Due />);
    const trigger = screen.getByRole("combobox", { name: "Due date" });

    await user.click(trigger);
    await user.keyboard("{ArrowLeft}{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("2026-10-30");
  });

  it("picks a year and month from the heading", async () => {
    const user = userEvent.setup();
    render(<Due />);

    await user.click(screen.getByRole("combobox", { name: "Due date" }));
    await user.click(within(calendar()).getByRole("button", { name: "October 2026" }));
    await user.click(within(calendar()).getByRole("button", { name: "2026" }));
    expect(calendar()).toHaveAccessibleName("2016 – 2027");
    await user.click(within(calendar()).getByRole("button", { name: "Previous 12 years" }));
    await user.click(within(calendar()).getByRole("button", { name: "2010" }));
    await user.click(within(calendar()).getByRole("button", { name: "Mar" }));
    expect(calendar()).toHaveAccessibleName("March 2010");
    await user.click(within(calendar()).getByRole("button", { name: "Wednesday, March 10, 2010" }));

    expect(screen.getByRole("status")).toHaveTextContent("2010-03-10");
  });

  it("offers Today, and Clear when clearable", async () => {
    const user = userEvent.setup();
    render(<Due clearable />);
    const trigger = screen.getByRole("combobox", { name: "Due date" });

    await user.click(trigger);
    await user.click(within(calendar()).getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("status")).toHaveTextContent("none");
    expect(trigger).toHaveTextContent("Pick a date");

    await user.click(trigger);
    expect(within(calendar()).queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    await user.click(within(calendar()).getByRole("button", { name: "Today" }));
    expect(screen.getByRole("status")).toHaveTextContent(localDateString());
  });
});
