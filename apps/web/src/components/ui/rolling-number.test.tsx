import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RollingNumber } from "./rolling-number";

describe("RollingNumber", () => {
  it("shows the first value without rolling", () => {
    render(<RollingNumber value={4} />);

    expect(screen.getByText("4")).not.toHaveAttribute("data-roll");
  });

  it("rolls up when the value grows and down when it shrinks", () => {
    const { rerender } = render(<RollingNumber value={4} />);

    rerender(<RollingNumber value={5} />);
    expect(screen.getByText("5")).toHaveAttribute("data-roll", "up");

    rerender(<RollingNumber value={3} />);
    expect(screen.getByText("3")).toHaveAttribute("data-roll", "down");
  });
});
