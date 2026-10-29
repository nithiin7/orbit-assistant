import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorageIndicator, StorageStatusCard } from "./storage-indicator";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(response: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("StorageIndicator", () => {
  it("shows a loading state while asking the API", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<StorageIndicator />);

    expect(screen.getByRole("status")).toHaveTextContent("Storage: Checking storage…");
  });

  it("shows local SQLite storage", async () => {
    respondWith(Response.json({ status: "ok", storage_mode: "local" }));
    render(<StorageIndicator />);

    expect(await screen.findByText("Local · SQLite")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Storage: Local · SQLite");
  });

  it("shows cloud Supabase storage", async () => {
    respondWith(Response.json({ status: "ok", storage_mode: "cloud" }));
    render(<StorageIndicator />);

    expect(await screen.findByText("Cloud · Supabase")).toBeInTheDocument();
  });

  it("reports an unavailable database when the API responds 503", async () => {
    respondWith(new Response(null, { status: 503 }));
    render(<StorageIndicator />);

    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
  });

  it("reports an unreachable API on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<StorageIndicator />);

    expect(await screen.findByText("API not reachable")).toBeInTheDocument();
  });
});

describe("StorageStatusCard", () => {
  it("explains where data is stored", async () => {
    respondWith(Response.json({ status: "ok", storage_mode: "local" }));
    render(<StorageStatusCard />);

    expect(await screen.findByText("Local · SQLite")).toBeInTheDocument();
    expect(screen.getByText(/stored in a database file on this computer/)).toBeInTheDocument();
  });
});
