import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

function Labelled() {
  const [checked, setChecked] = useState(false);
  return (
    <label>
      <Checkbox checked={checked} onChange={() => setChecked(!checked)} shape="round" />
      Water plants
    </label>
  );
}

describe("Checkbox", () => {
  it("is a labelled checkbox that toggles by click and keyboard", async () => {
    const user = userEvent.setup();
    render(<Labelled />);

    const checkbox = screen.getByRole("checkbox", { name: "Water plants" });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await user.keyboard(" ");
    expect(checkbox).not.toBeChecked();
  });

  it("can't be toggled while disabled", async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Pending" disabled />);

    await user.click(screen.getByRole("checkbox", { name: "Pending" }));

    expect(screen.getByRole("checkbox", { name: "Pending" })).not.toBeChecked();
  });
});
