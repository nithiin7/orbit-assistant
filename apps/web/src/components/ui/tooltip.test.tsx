import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tooltip } from "./tooltip";

function renderTooltip(disabled = false) {
  render(
    <Tooltip label="Tasks" disabled={disabled}>
      <button type="button" aria-label="Tasks">
        icon
      </button>
    </Tooltip>,
  );
}

describe("Tooltip", () => {
  it("shows on keyboard focus and hides on Escape", async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.tab();
    expect(screen.getByText("Tasks")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });

  it("hides when focus leaves the trigger", async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.tab();
    await user.tab();
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });

  it("stays hidden when disabled", async () => {
    const user = userEvent.setup();
    renderTooltip(true);

    await user.tab();
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });

  it("does not change the trigger's accessible name", async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.tab();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
  });
});
