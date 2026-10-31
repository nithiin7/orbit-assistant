import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RowActions } from "./row-actions";

function renderActions() {
  const edit = vi.fn();
  const remove = vi.fn(() => Promise.resolve());
  render(
    <RowActions
      name="Netflix"
      primary={<button type="button">Record payment</button>}
      actions={[
        { id: "edit", label: "Edit", onSelect: edit },
        { id: "hidden", label: "Pause", hidden: true, onSelect: vi.fn() },
        {
          id: "delete",
          label: "Delete…",
          destructive: true,
          confirm: {
            prompt: "Delete “Netflix”?",
            choices: [{ label: "Delete", destructive: true, onConfirm: remove }],
          },
        },
      ]}
    />,
  );
  return { edit, remove, more: screen.getByRole("button", { name: "More actions for “Netflix”" }) };
}

describe("RowActions", () => {
  it("shows one action and keeps the rest in a menu", async () => {
    const user = userEvent.setup();
    const { edit, more } = renderActions();
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();

    await user.click(more);
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Pause" })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Edit" }));
    expect(edit).toHaveBeenCalledOnce();
  });

  it("asks before a destructive action, and Escape backs out to the menu button", async () => {
    const user = userEvent.setup();
    const { remove, more } = renderActions();

    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const confirm = screen.getByRole("group", { name: "Delete “Netflix”?" });
    expect(within(confirm).getByRole("button", { name: "Delete" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(confirm).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "More actions for “Netflix”" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "More actions for “Netflix”" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledOnce();
  });
});
