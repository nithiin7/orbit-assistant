import { render, screen } from "@testing-library/react";
import { Tags } from "lucide-react";
import { describe, expect, it } from "vitest";

import { IconChip } from "./icon-chip";

describe("IconChip", () => {
  it("is decorative, so the heading beside it names the section", () => {
    render(
      <h2>
        <IconChip icon={Tags} tone="violet" />
        Categories
      </h2>,
    );
    expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("heading").firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
