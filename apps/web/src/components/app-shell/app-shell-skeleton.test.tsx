import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthFormSkeleton } from "@/components/auth/auth-status-screen";

import { AppShellSkeleton } from "./app-shell-skeleton";

describe("loading placeholders", () => {
  it("announce the app shell loading and hold nothing focusable", () => {
    const { container } = render(<AppShellSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking your session…");
    expect(container.querySelector("a, button, input, [tabindex]")).toBeNull();
  });

  it("announce the auth form loading with the given label", () => {
    const { container } = render(<AuthFormSkeleton label="Loading sign-in…" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading sign-in…");
    expect(container.querySelector("a, button, input, [tabindex]")).toBeNull();
  });
});
