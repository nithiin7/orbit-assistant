import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import NotFound from "@/app/not-found";

import { errorDigest, ErrorPage } from "./error-fallback";

afterEach(() => {
  vi.restoreAllMocks();
});

function serverError(message: string, digest: string) {
  return Object.assign(new Error(message), { digest });
}

describe("ErrorPage", () => {
  it("shows the reference but never the error message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorPage error={serverError("secret connection string", "4096")} retry={() => {}} />);

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("Reference: 4096")).toBeInTheDocument();
    expect(screen.queryByText(/secret connection string/)).not.toBeInTheDocument();
  });

  it("retries and reports the error to the console", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = new Error("boom");
    render(<ErrorPage error={error} retry={retry} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
    expect(screen.getByRole("link", { name: "Back to Orbit" })).toHaveAttribute("href", "/");
  });
});

describe("errorDigest", () => {
  it.each([
    [serverError("x", "abc"), "abc"],
    [new Error("no digest"), undefined],
    ["a thrown string", undefined],
    [Object.assign(new Error("x"), { digest: 42 }), undefined],
  ])("%o", (error, expected) => {
    expect(errorDigest(error)).toBe(expected);
  });
});

describe("NotFound", () => {
  it("explains the missing page and links home", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "This page drifted out of orbit" }),
    ).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Orbit" })).toHaveAttribute("href", "/");
  });
});
