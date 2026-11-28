import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PinPad } from "./pin-pad";

describe("PinPad", () => {
  it("submits once every digit is tapped in", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<PinPad length={4} label="Enter your PIN" onComplete={onComplete} />);

    expect(screen.getByRole("group", { name: "Enter your PIN" })).toBeInTheDocument();
    for (const digit of ["2", "4", "6"])
      await user.click(screen.getByRole("button", { name: digit }));
    expect(screen.getByText("3 of 4 digits entered.")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "8" }));

    expect(onComplete).toHaveBeenCalledExactlyOnceWith("2468");
  });

  it("takes typed digits, Backspace, and Escape", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<PinPad length={4} label="PIN" onComplete={onComplete} />);

    await user.keyboard("135");
    await user.keyboard("{Backspace}");
    expect(screen.getByText("2 of 4 digits entered.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByText("0 of 4 digits entered.")).toBeInTheDocument();
    await user.keyboard("9753");

    expect(onComplete).toHaveBeenCalledExactlyOnceWith("9753");
  });

  it("takes a pasted PIN", () => {
    const onComplete = vi.fn();
    render(<PinPad length={6} label="PIN" onComplete={onComplete} />);

    fireEvent.paste(window, { clipboardData: { getData: () => "12 34 56" } });

    expect(onComplete).toHaveBeenCalledExactlyOnceWith("123456");
  });

  it("clears after a refused PIN and ignores input while busy", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const { rerender } = render(<PinPad length={4} label="PIN" onComplete={onComplete} busy />);

    await user.keyboard("12");
    expect(screen.getByText("0 of 4 digits entered.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled();

    rerender(<PinPad length={4} label="PIN" onComplete={onComplete} />);
    await user.keyboard("12");
    rerender(<PinPad length={4} label="PIN" onComplete={onComplete} rejection={1} />);

    expect(screen.getByText("0 of 4 digits entered.")).toBeInTheDocument();
  });

  it("ignores digits typed into a text field", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Search" />
        <PinPad length={4} label="PIN" onComplete={vi.fn()} />
      </>,
    );

    await user.type(screen.getByRole("textbox", { name: "Search" }), "12");

    expect(screen.getByText("0 of 4 digits entered.")).toBeInTheDocument();
  });
});
