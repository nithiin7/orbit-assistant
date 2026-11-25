import { render, screen } from "@testing-library/react";
import { Wallet } from "lucide-react";
import { describe, expect, it } from "vitest";

import { StatGrid, StatTile } from "./stat-tile";

describe("StatGrid", () => {
  it("lists its figures as terms and values", () => {
    render(
      <StatGrid>
        <StatTile label="Income" value="₹90,000.00">
          Money earned this month
        </StatTile>
      </StatGrid>,
    );
    const label = screen.getByText("Income", { selector: "dt" });
    expect(label.nextElementSibling).toHaveTextContent("₹90,000.00");
  });

  it("as a hero, keeps the same figures on one card with a decorative icon", () => {
    const { container } = render(
      <StatGrid hero icon={Wallet}>
        <StatTile label="Still owed" value="₹1,00,000.00" />
        <StatTile label="Next EMI" value="₹5,000.00" emphasis />
      </StatGrid>,
    );
    const list = container.querySelector("dl");
    expect(list?.parentElement).toHaveClass("rounded-2xl");
    expect(screen.getByText("Still owed", { selector: "dt" }).nextElementSibling).toHaveTextContent(
      "₹1,00,000.00",
    );
    // The watermark is decoration only.
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
