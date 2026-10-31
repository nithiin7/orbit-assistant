import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Select, type SelectItems } from "./select";

const FRUITS: SelectItems<string> = [
  { value: "", label: "No fruit" },
  {
    label: "Berries",
    options: [
      { value: "blueberry", label: "Blueberry" },
      { value: "strawberry", label: "Strawberry" },
    ],
  },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

function Fruit({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("banana");
  return (
    <>
      <label htmlFor="fruit">Fruit</label>
      <Select
        id="fruit"
        value={value}
        options={FRUITS}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </>
  );
}

describe("Select", () => {
  it("shows the chosen option and picks another by pointer", async () => {
    const user = userEvent.setup();
    render(<Fruit />);
    const combobox = screen.getByRole("combobox", { name: "Fruit" });
    expect(combobox).toHaveTextContent("Banana");
    expect(combobox).toHaveAttribute("aria-expanded", "false");

    await user.click(combobox);
    expect(screen.getByRole("listbox", { name: "Fruit" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Banana" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "Berries" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Cherry" }));
    expect(combobox).toHaveTextContent("Cherry");
    expect(combobox).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens, moves, and chooses with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Fruit onChange={onChange} />);
    const combobox = screen.getByRole("combobox", { name: "Fruit" });

    await user.tab();
    await user.keyboard("{ArrowDown}");
    // Opens on the chosen option.
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Banana" }).id,
    );
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Blueberry" }).id,
    );
    await user.keyboard("{End}{Enter}");
    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(combobox).toHaveTextContent("Cherry");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Fruit onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    await user.keyboard("{Home}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("jumps to a typed option, open or closed", async () => {
    const user = userEvent.setup();
    render(<Fruit />);
    const combobox = screen.getByRole("combobox", { name: "Fruit" });

    await user.tab();
    // Closed, typing chooses directly, like a native select.
    await user.keyboard("s");
    expect(combobox).toHaveTextContent("Strawberry");

    await user.keyboard("{ArrowDown}");
    await user.keyboard("ch");
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Cherry" }).id,
    );
  });

  it("shows the placeholder when no option matches", () => {
    render(
      <Select
        aria-label="Account"
        value=""
        placeholder="Choose an account"
        onValueChange={() => {}}
        options={[{ value: "a", label: "HDFC" }]}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Account" })).toHaveTextContent(
      "Choose an account",
    );
  });
});
