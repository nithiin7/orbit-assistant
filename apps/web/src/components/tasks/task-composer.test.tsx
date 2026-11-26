import type { CreateTaskRequest, TaskListDetail } from "@orbit/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chooseOption } from "@/test/controls";

import { TaskComposer } from "./task-composer";

const work: TaskListDetail = {
  id: "l-work",
  name: "Work",
  color: "blue",
  position: 0,
  open_tasks: 0,
};

function renderComposer() {
  const created: CreateTaskRequest[] = [];
  const onCreate = vi.fn((draft: CreateTaskRequest) => {
    created.push(draft);
    return Promise.resolve();
  });
  render(<TaskComposer onCreate={onCreate} lists={[work]} />);
  return { created, title: screen.getByRole("textbox", { name: "Task title" }) };
}

describe("TaskComposer quick add", () => {
  // A Thursday morning. Only the clock is faked, so typing still works.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 26, 9, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("sets the due date, repeat, priority, and list from the title", async () => {
    const user = userEvent.setup();
    const { created, title } = renderComposer();

    await user.type(title, "Pay rent on the 1st every month !high #work");

    const chips = within(screen.getByRole("list", { name: "Set from the title" }));
    expect(chips.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringMatching(/Dec 1/),
      "Every month",
      "High priority",
      "Work",
    ]);
    expect(title).toHaveAccessibleDescription(/From the title: .*Every month, High priority, Work/);

    await user.keyboard("{Enter}");

    expect(created).toEqual([
      {
        title: "Pay rent",
        description: "",
        priority: "high",
        due_date: "2026-12-01",
        list_id: "l-work",
        recurrence: { frequency: "monthly", interval: 1 },
      },
    ]);
    expect(title).toHaveValue("");
    expect(screen.queryByRole("list", { name: "Set from the title" })).not.toBeInTheDocument();
  });

  it("keeps a dismissed phrase in the title", async () => {
    const user = userEvent.setup();
    const { created, title } = renderComposer();

    await user.type(title, "Call mom tomorrow");
    await user.click(screen.getByRole("button", { name: "Keep “tomorrow” in the title" }));
    expect(screen.queryByRole("list", { name: "Set from the title" })).not.toBeInTheDocument();
    await user.type(title, "{Enter}");

    expect(created).toEqual([
      {
        title: "Call mom tomorrow",
        description: "",
        priority: "none",
        due_date: null,
        list_id: null,
      },
    ]);

    // The next task reads dates again.
    await user.type(title, "Email Sam tomorrow");
    expect(screen.getByRole("list", { name: "Set from the title" })).toHaveTextContent("Tomorrow");
  });

  it("lets a picker the user set win over typed words", async () => {
    const user = userEvent.setup();
    const { created, title } = renderComposer();

    await chooseOption(user, screen.getByRole("combobox", { name: "Priority" }), "Low");
    await user.type(title, "Fix leak !high tomorrow{Enter}");

    expect(created).toEqual([
      {
        title: "Fix leak !high",
        description: "",
        priority: "low",
        due_date: "2026-11-27",
        list_id: null,
      },
    ]);
  });

  it("explains what can be typed from the help button", async () => {
    const user = userEvent.setup();
    renderComposer();
    const help = screen.getByRole("button", { name: "Quick add tips" });
    expect(help).toHaveAttribute("aria-expanded", "false");

    await user.click(help);

    expect(help).toHaveAttribute("aria-expanded", "true");
    const tips = within(screen.getByRole("region", { name: "Quick add tips" }));
    expect(tips.getByText("Due date")).toBeInTheDocument();
    expect(tips.getByText("every other week")).toBeInTheDocument();
    expect(tips.getByText("!high")).toBeInTheDocument();
    // The list example uses one of the workspace's own lists.
    expect(tips.getByText("#work")).toBeInTheDocument();

    await user.click(help);
    expect(screen.queryByRole("region", { name: "Quick add tips" })).not.toBeInTheDocument();
  });

  it("adds a plain title as typed", async () => {
    const user = userEvent.setup();
    const { created, title } = renderComposer();

    await user.type(title, "Water the plants{Enter}");

    expect(screen.queryByRole("list", { name: "Set from the title" })).not.toBeInTheDocument();
    expect(created[0]).toMatchObject({ title: "Water the plants", due_date: null });
  });
});
