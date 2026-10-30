import type { Currency } from "@orbit/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { AmountInput } from "./amount-input";

function Amount({ currency, initial = "" }: { currency: Currency; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AmountInput aria-label="Amount" currency={currency} value={value} onValueChange={setValue} />
  );
}

describe("AmountInput", () => {
  it("groups rupees in lakhs and crores while typing", async () => {
    const user = userEvent.setup();
    render(<Amount currency="INR" />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    await user.type(input, "100000");
    expect(input).toHaveValue("1,00,000");
    await user.type(input, "00.5");
    expect(input).toHaveValue("1,00,00,000.5");
  });

  it("groups other currencies in thousands", async () => {
    const user = userEvent.setup();
    render(<Amount currency="USD" />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    await user.type(input, "1234567.89");
    expect(input).toHaveValue("1,234,567.89");
  });

  it("groups a starting value, such as one being edited", () => {
    render(<Amount currency="INR" initial="250000.00" />);
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("2,50,000.00");
  });

  it("deletes the digit beside a separator, not just the separator", async () => {
    const user = userEvent.setup();
    render(<Amount currency="INR" initial="1234567" />);
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Amount" });
    expect(input).toHaveValue("12,34,567");

    // Backspace with the caret just after a separator: "12,|34,567".
    await user.click(input);
    input.setSelectionRange(3, 3);
    await user.keyboard("{Backspace}");
    expect(input).toHaveValue("1,34,567");
    expect(input).toHaveProperty("selectionStart", 1);
  });
});
