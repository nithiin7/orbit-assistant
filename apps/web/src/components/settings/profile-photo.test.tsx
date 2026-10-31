import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as AvatarModule from "@/lib/avatar";
import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { ProfilePhoto } from "./profile-photo";

// Canvas isn't implemented in jsdom; the resize step is replaced with a fixed result.
const prepared = vi.hoisted(() => ({ blob: new Blob(["webp"], { type: "image/webp" }) }));
vi.mock("@/lib/avatar", async (importOriginal) => ({
  ...(await importOriginal<typeof AvatarModule>()),
  prepareAvatar: vi.fn(async () => prepared.blob),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/account",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: true }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ProfilePhoto", () => {
  it("uploads the resized photo and shows it", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      "GET /api/v1/me/avatar": status(204),
      "PUT /api/v1/me/avatar": status(204),
    });
    await renderSignedIn(<ProfilePhoto />);

    const input = screen.getByLabelText("Upload photo");
    // The picker is enabled once the current photo has loaded.
    await waitFor(() => expect(input).toBeEnabled());
    await user.upload(input, new File(["raw"], "me.png", { type: "image/png" }));

    expect(await screen.findByText("Photo updated.")).toBeInTheDocument();
    const put = api.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[1]?.body).toBe(prepared.blob);
    expect(put?.[1]?.headers).toMatchObject({ "Content-Type": "image/webp" });
    await waitFor(() =>
      expect(document.querySelector("img")).toHaveAttribute(
        "src",
        `data:image/webp;base64,${btoa("webp")}`,
      ),
    );
    expect(screen.getByLabelText("Change photo")).toBeInTheDocument();
  });

  it("removes an existing photo", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      "GET /api/v1/me/avatar": () => new Response(new Blob(["png"], { type: "image/png" })),
      "DELETE /api/v1/me/avatar": status(204),
    });
    await renderSignedIn(<ProfilePhoto />);

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Photo removed.")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Upload photo")).toBeInTheDocument();
  });

  it("shows the API's reason when an upload is rejected", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      "GET /api/v1/me/avatar": status(204),
      "PUT /api/v1/me/avatar": status(415, "Use a PNG, JPEG, or WebP image."),
    });
    await renderSignedIn(<ProfilePhoto />);

    const input = screen.getByLabelText("Upload photo");
    await waitFor(() => expect(input).toBeEnabled());
    await user.upload(input, new File(["raw"], "me.png", { type: "image/png" }));

    const message = await screen.findByText("Use a PNG, JPEG, or WebP image.");
    expect(message.closest("[role=alert]")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
});
