import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Opens a `Select` and clicks the option named `name`, as a person would. */
export async function chooseOption(
  user: Pick<UserEvent, "click">,
  combobox: HTMLElement,
  name: string | RegExp,
): Promise<void> {
  await user.click(combobox);
  await user.click(screen.getByRole("option", { name }));
}

const SHORT_MONTH = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Opens a `DatePicker` and picks `date` (`YYYY-MM-DD`) through its year, month, and day views,
 * as a person would.
 */
export async function pickDate(user: UserEvent, trigger: HTMLElement, date: string) {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  await user.click(trigger);
  const calendar = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!calendar) throw new Error("The date picker didn't open.");
  const caption = document.getElementById(calendar.getAttribute("aria-labelledby") ?? "");
  if (!caption) throw new Error("The calendar has no heading.");
  // The heading switches to the month view, then to the year view.
  await user.click(caption);
  await user.click(caption);
  const view = within(calendar);
  while (!view.queryByRole("button", { name: String(year) })) {
    const firstYear = Number(caption.textContent?.slice(0, 4));
    await user.click(view.getByRole("button", { name: year < firstYear ? /^Previous/ : /^Next/ }));
  }
  await user.click(view.getByRole("button", { name: String(year) }));
  await user.click(view.getByRole("button", { name: SHORT_MONTH.format(utc) }));
  await user.click(view.getByRole("button", { name: FULL_DATE.format(utc) }));
}
