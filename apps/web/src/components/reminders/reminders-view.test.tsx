import type { Reminder, Task } from "@orbit/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption, pickDate } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { RemindersPanel } from "./reminders-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/reminders",
}));

const REMINDERS = `/api/v1/workspaces/${personal.id}/reminders`;
const TASKS = `/api/v1/workspaces/${personal.id}/tasks`;

const taxes: Task = {
  id: "t-taxes",
  workspace_id: personal.id,
  title: "File taxes",
  description: "",
  status: "open",
  priority: "none",
  due_date: null,
  completed_at: null,
  scheduled_start: null,
  scheduled_end: null,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
};

function reminder(overrides: Partial<Reminder> & Pick<Reminder, "id" | "title">): Reminder {
  return {
    workspace_id: personal.id,
    task: null,
    description: "",
    enabled: true,
    start_date: "2030-01-15",
    time_of_day: "09:00:00",
    timezone: "Europe/Paris",
    recurrence: null,
    status: "scheduled",
    next_occurrence_at: "2030-01-15T08:00:00Z",
    last_occurrence_at: null,
    last_outcome: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

const dentist = reminder({
  id: "r-dentist",
  title: "Call the dentist",
  recurrence: { frequency: "weekly", weekdays: ["mon", "thu"] },
  task: { id: taxes.id, title: taxes.title, status: "open" },
});

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  [`GET ${TASKS}`]: json({ tasks: [taxes], total: 1 }),
};

/** Request bodies sent with `method` to `path`, in order. */
function bodies(api: ReturnType<typeof mockApi>, method: string, path: string): unknown[] {
  return api.mock.calls
    .filter(
      ([input, init]) =>
        (init?.method ?? "GET") === method && new URL(String(input)).pathname === path,
    )
    .map(
      ([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : undefined) as unknown,
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("RemindersPanel", () => {
  it("lists upcoming reminders with their schedule and task", async () => {
    const api = mockApi({
      ...session,
      [`GET ${REMINDERS}`]: json({ reminders: [dentist], total: 1 }),
    });

    await renderSignedIn(<RemindersPanel />);

    expect(
      await screen.findByRole("heading", { name: "Upcoming reminders", level: 2 }),
    ).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Later, 1 reminder" });
    const [row] = within(list).getAllByRole("listitem");
    expect(row).toHaveTextContent("Call the dentist");
    expect(row).toHaveTextContent("Weekly on Mon, Thu");
    expect(row).toHaveTextContent("File taxes");
    expect(within(row!).getByRole("switch", { name: "Disable “Call the dentist”" })).toBeChecked();
    const [, query] = String(
      api.mock.calls.find(([input]) => String(input).includes("/reminders"))?.[0],
    ).split("?");
    expect(new URLSearchParams(query).get("status")).toBe("scheduled");
  });

  it("filters by status", async () => {
    const api = mockApi({ ...session, [`GET ${REMINDERS}`]: json({ reminders: [], total: 0 }) });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);
    await screen.findByRole("heading", { name: "Nothing coming up" });

    await user.click(screen.getByRole("button", { name: "Disabled" }));

    await screen.findByRole("heading", { name: "No disabled reminders" });
    const statuses = api.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === REMINDERS)
      .map((url) => url.searchParams.get("status"));
    expect(statuses).toEqual(["scheduled", "disabled"]);
  });

  it("creates a weekly reminder about a task", async () => {
    const created = reminder({ id: "r-new", title: "Pay rent" });
    const api = mockApi({
      ...session,
      [`GET ${REMINDERS}`]: json({ reminders: [], total: 0 }),
      [`POST ${REMINDERS}`]: json(created, 201),
    });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);
    await screen.findByRole("heading", { name: "Nothing coming up" });

    await user.click(screen.getAllByRole("button", { name: "New reminder" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "New reminder" });
    await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "Pay rent");
    // 2030-01-14 is a Monday.
    await pickDate(user, within(dialog).getByRole("combobox", { name: "Date" }), "2030-01-14");
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "09:30" } });
    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "Time zone" }),
      /Asia\/Tokyo|Tokyo/,
    );
    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "Repeat" }),
      "Weekly on chosen days",
    );
    expect(within(dialog).getByRole("button", { name: "Mon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(dialog).getByRole("button", { name: "Wed" }));
    await chooseOption(user, within(dialog).getByRole("combobox", { name: /Task/ }), "File taxes");
    await user.click(within(dialog).getByRole("button", { name: "Create reminder" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bodies(api, "POST", REMINDERS)).toEqual([
      {
        title: "Pay rent",
        description: "",
        task_id: taxes.id,
        start_date: "2030-01-14",
        time_of_day: "09:30",
        timezone: "Asia/Tokyo",
        recurrence: { frequency: "weekly", weekdays: ["mon", "wed"] },
        enabled: true,
      },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("Saved “Pay rent”.");
  });

  it("validates the form before sending it", async () => {
    const api = mockApi({ ...session, [`GET ${REMINDERS}`]: json({ reminders: [], total: 0 }) });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);
    await user.click((await screen.findAllByRole("button", { name: "New reminder" }))[0]!);
    const dialog = screen.getByRole("dialog", { name: "New reminder" });

    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "Repeat" }),
      "Weekly on chosen days",
    );
    for (const day of within(dialog).getAllByRole("button", { pressed: true })) {
      await user.click(day);
    }
    await user.click(within(dialog).getByRole("button", { name: "Create reminder" }));

    expect(await within(dialog).findByText("Enter a title.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose at least one day.")).toBeInTheDocument();
    expect(bodies(api, "POST", REMINDERS)).toEqual([]);
  });

  it("keeps the dialog open with the API's message when saving fails", async () => {
    mockApi({
      ...session,
      [`GET ${REMINDERS}`]: json({ reminders: [], total: 0 }),
      [`POST ${REMINDERS}`]: status(
        422,
        "That time has already passed. Choose a time in the future, or make it repeat.",
      ),
    });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);
    await user.click((await screen.findAllByRole("button", { name: "New reminder" }))[0]!);
    const dialog = screen.getByRole("dialog", { name: "New reminder" });

    await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "Too late");
    await user.click(within(dialog).getByRole("button", { name: "Create reminder" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/already passed/);
    expect(screen.getByRole("dialog", { name: "New reminder" })).toBeInTheDocument();
  });

  it("edits a reminder without changing whether it is enabled", async () => {
    const disabled = reminder({
      id: "r-off",
      title: "Water plants",
      enabled: false,
      status: "disabled",
      next_occurrence_at: null,
    });
    const api = mockApi({
      ...session,
      [`GET ${REMINDERS}`]: json({ reminders: [disabled], total: 1 }),
      [`PATCH ${REMINDERS}/r-off`]: (request: MockRequest) =>
        Response.json({ ...disabled, ...(request.body as object) }),
    });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);

    await user.click(await screen.findByRole("button", { name: "Edit “Water plants”" }));
    const dialog = screen.getByRole("dialog", { name: "Edit reminder" });
    const title = within(dialog).getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Water the ferns");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const [body] = bodies(api, "PATCH", `${REMINDERS}/r-off`) as Record<string, unknown>[];
    expect(body).toMatchObject({
      title: "Water the ferns",
      time_of_day: "09:00",
      timezone: "Europe/Paris",
    });
    expect(body).not.toHaveProperty("enabled");
  });

  it("disables and deletes reminders", async () => {
    const api = mockApi({
      ...session,
      [`GET ${REMINDERS}`]: json({ reminders: [dentist], total: 1 }),
      [`PATCH ${REMINDERS}/${dentist.id}`]: json({
        ...dentist,
        enabled: false,
        status: "disabled",
      }),
      [`DELETE ${REMINDERS}/${dentist.id}`]: status(204),
    });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);

    await user.click(await screen.findByRole("switch", { name: "Disable “Call the dentist”" }));
    await waitFor(() =>
      expect(bodies(api, "PATCH", `${REMINDERS}/${dentist.id}`)).toEqual([{ enabled: false }]),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Disabled “Call the dentist”.");

    await user.click(screen.getByRole("button", { name: "Delete “Call the dentist”" }));
    const confirm = screen.getByRole("group", { name: "Delete “Call the dentist”?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(api.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Deleted “Call the dentist”.");
  });

  it("shows an error with a retry when reminders can't load", async () => {
    let fail = true;
    mockApi({
      ...session,
      [`GET ${REMINDERS}`]: () =>
        fail
          ? new Response(null, { status: 503 })
          : Response.json({ reminders: [dentist], total: 1 }),
    });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);

    expect(await screen.findByText(/database is unavailable/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("list", { name: "Later, 1 reminder" })).toBeInTheDocument();
  });

  it("groups reminders by when they fire and says when the next one is", async () => {
    const soon = new Date(Date.now() + 5 * 60_000);
    const now = reminder({
      id: "r-late",
      title: "Stretch",
      status: "overdue",
      next_occurrence_at: new Date(Date.now() - 60_000).toISOString(),
    });
    // Due in a few minutes, so Today, or Tomorrow if the test runs just before midnight.
    const coffee = reminder({
      id: "r-coffee",
      title: "Coffee",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      next_occurrence_at: soon.toISOString(),
    });
    mockApi({
      ...session,
      [`GET ${REMINDERS}`]: json({ reminders: [now, coffee, dentist], total: 3 }),
    });

    await renderSignedIn(<RemindersPanel />);

    const overdue = await screen.findByRole("list", { name: "Overdue, 1 reminder" });
    expect(overdue).toHaveTextContent("Stretch");
    expect(overdue).toHaveTextContent(/Overdue ·/);
    expect(screen.getByRole("list", { name: /^(Today|Tomorrow), 1 reminder$/ })).toHaveTextContent(
      "Coffee",
    );
    expect(screen.getByRole("list", { name: "Later, 1 reminder" })).toHaveTextContent(
      "Call the dentist",
    );
    const sections = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(sections).toEqual(["Overdue1", expect.stringMatching(/^(Today|Tomorrow)1$/), "Later1"]);
    const summary = screen.getByText("3 reminders", { selector: "span" }).parentElement;
    expect(summary).toHaveTextContent(/Next (Today|Tomorrow), /);
  });

  it("shows other views as one list", async () => {
    const off = reminder({
      id: "r-off",
      title: "Water plants",
      enabled: false,
      status: "disabled",
      next_occurrence_at: null,
    });
    mockApi({ ...session, [`GET ${REMINDERS}`]: json({ reminders: [off], total: 1 }) });
    const user = userEvent.setup();
    await renderSignedIn(<RemindersPanel />);
    await screen.findByRole("list", { name: /Not scheduled|Later/ });

    await user.click(screen.getByRole("button", { name: "Disabled" }));

    expect(
      await screen.findByRole("heading", { name: "Disabled reminders", level: 2 }),
    ).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "1 reminder" });
    expect(within(list).getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});
