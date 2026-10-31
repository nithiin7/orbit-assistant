import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Menu, type MenuItem } from "./menu";

function renderMenu(
  overrides: Partial<Record<"holding" | "deposit" | "account", Partial<MenuItem>>> = {},
) {
  const selected = vi.fn();
  const items: MenuItem[] = [
    {
      id: "holding",
      label: "Holding",
      description: "A fund or stock",
      onSelect: () => selected("holding"),
      ...overrides.holding,
    },
    { id: "deposit", label: "Deposit", onSelect: () => selected("deposit"), ...overrides.deposit },
    { id: "account", label: "Account", onSelect: () => selected("account"), ...overrides.account },
  ];
  render(<Menu items={items}>Add</Menu>);
  return { selected, trigger: screen.getByRole("button", { name: "Add" }) };
}

describe("Menu", () => {
  it("opens on click and runs the chosen item", async () => {
    const user = userEvent.setup();
    const { selected, trigger } = renderMenu();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "Add" });
    expect(menu).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "Holding" })).toHaveAccessibleDescription(
      "A fund or stock",
    );

    await user.click(screen.getByRole("menuitem", { name: "Deposit" }));
    expect(selected).toHaveBeenCalledWith("deposit");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves past disabled items with the keyboard and wraps around", async () => {
    const user = userEvent.setup();
    const { selected, trigger } = renderMenu({ deposit: { disabled: true } });
    trigger.focus();

    await user.keyboard("{ArrowDown}");
    const menu = screen.getByRole("menu");
    const active = () => menu.getAttribute("aria-activedescendant");
    const idOf = (name: string) => screen.getByRole("menuitem", { name }).id;
    expect(active()).toBe(idOf("Holding"));
    expect(screen.getByRole("menuitem", { name: "Deposit" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.keyboard("{ArrowDown}");
    expect(active()).toBe(idOf("Account"));
    await user.keyboard("{ArrowDown}");
    expect(active()).toBe(idOf("Holding"));
    await user.keyboard("{End}");
    expect(active()).toBe(idOf("Account"));

    await user.keyboard("{Enter}");
    expect(selected).toHaveBeenCalledWith("account");
    expect(trigger).toHaveFocus();
  });

  it("ignores disabled items when clicked", async () => {
    const user = userEvent.setup();
    const { selected, trigger } = renderMenu({ deposit: { disabled: true } });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Deposit" }));
    expect(selected).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on Escape, on Tab, and when the trigger is pressed again", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menu")).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("menuitem", { name: "Account" }).id,
    );
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("groups items under labels and marks the checked one", async () => {
    const user = userEvent.setup();
    const picked = vi.fn();
    render(
      <Menu
        chevron={false}
        items={[
          { id: "a", label: "Overview", checked: false, onSelect: () => picked("a") },
          {
            id: "b",
            label: "Budgets",
            group: "Planning",
            checked: true,
            onSelect: () => picked("b"),
          },
          {
            id: "c",
            label: "Goals",
            group: "Planning",
            checked: false,
            onSelect: () => picked("c"),
          },
          { id: "d", label: "Delete", destructive: true, onSelect: () => picked("d") },
        ]}
      >
        Views
      </Menu>,
    );
    await user.click(screen.getByRole("button", { name: "Views" }));

    const planning = screen.getByRole("group", { name: "Planning" });
    expect(planning).toContainElement(screen.getByRole("menuitemradio", { name: "Budgets" }));
    expect(screen.getByRole("menuitemradio", { name: "Budgets" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Overview" })).not.toBeChecked();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(picked).toHaveBeenCalledWith("c");
  });
});
