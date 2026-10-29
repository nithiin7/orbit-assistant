import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AuthState } from "@/providers/auth-provider";
import { ada } from "@/test/api-mock";

import { QueryProvider } from "./query-provider";

const auth = vi.hoisted(() => ({ state: { status: "loading" } as AuthState }));

vi.mock("@/providers/auth-provider", () => ({ useAuth: () => auth }));

const config = { provider: "local", registration_open: false } as const;

describe("QueryProvider", () => {
  it("drops cached data when the signed-in user changes", () => {
    const client = new QueryClient();
    auth.state = { status: "signed-in", config, user: ada };
    const { rerender } = render(<QueryProvider client={client}>content</QueryProvider>);
    client.setQueryData(["workspaces", "w1", "tasks"], "ada's tasks");

    auth.state = { status: "signed-in", config, user: ada };
    rerender(<QueryProvider client={client}>content</QueryProvider>);
    expect(client.getQueryData(["workspaces", "w1", "tasks"])).toBe("ada's tasks");

    auth.state = { status: "signed-out", config };
    rerender(<QueryProvider client={client}>content</QueryProvider>);
    expect(client.getQueryData(["workspaces", "w1", "tasks"])).toBeUndefined();
  });
});
