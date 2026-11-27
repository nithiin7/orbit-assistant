import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageTransition } from "./page-transition";

describe("PageTransition", () => {
  it("renders the page content", () => {
    render(
      <PageTransition>
        <h1>Appearance</h1>
      </PageTransition>,
    );

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
  });
});
