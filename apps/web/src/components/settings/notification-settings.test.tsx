import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as PushModule from "@/lib/push";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { NotificationSettings } from "./notification-settings";

const device = vi.hoisted(() => ({
  pushSupport: vi.fn(),
  isDeviceSubscribed: vi.fn(),
  subscribeDevice: vi.fn(),
  deviceEndpoint: vi.fn(),
  unsubscribeDevice: vi.fn(),
}));

vi.mock("@/lib/push", async (original) => ({
  ...(await original<typeof PushModule>()),
  ...device,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

const PUSH = "/api/v1/me/push";
const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device",
  p256dh: "device-key",
  auth: "device-secret",
};
const pushStatus = {
  available: true,
  public_key: "server-key",
  reminders: true,
  briefing: true,
  show_details: false,
  devices: 0,
};
const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

beforeEach(() => {
  vi.resetAllMocks();
  device.pushSupport.mockReturnValue("supported");
  device.isDeviceSubscribed.mockResolvedValue(false);
  device.subscribeDevice.mockResolvedValue(SUBSCRIPTION);
  device.deviceEndpoint.mockResolvedValue(SUBSCRIPTION.endpoint);
  device.unsubscribeDevice.mockResolvedValue(undefined);
});

describe("NotificationSettings", () => {
  it("is off until turned on, then registers this device", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${PUSH}`]: json(pushStatus),
      [`PUT ${PUSH}/subscriptions`]: (request: MockRequest) => {
        sent.push(request.body);
        return Response.json({ ...pushStatus, devices: 1 });
      },
    });

    await renderSignedIn(<NotificationSettings />);

    const toggle = await screen.findByRole("switch", { name: "Push notifications" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    await waitFor(() => expect(sent).toEqual([SUBSCRIPTION]));
    expect(device.subscribeDevice).toHaveBeenCalledWith("server-key");
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("turns this device off on the server and in the browser", async () => {
    const user = userEvent.setup();
    const removed: unknown[] = [];
    device.isDeviceSubscribed.mockResolvedValue(true);
    mockApi({
      ...session,
      [`GET ${PUSH}`]: json({ ...pushStatus, devices: 1 }),
      [`POST ${PUSH}/subscriptions/remove`]: (request: MockRequest) => {
        removed.push(request.body);
        return Response.json(pushStatus);
      },
    });

    await renderSignedIn(<NotificationSettings />);

    const toggle = await screen.findByRole("switch", { name: "Push notifications" });
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);

    await waitFor(() => expect(removed).toEqual([{ endpoint: SUBSCRIPTION.endpoint }]));
    expect(device.unsubscribeDevice).toHaveBeenCalledOnce();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("explains how to allow notifications when the browser blocks them", async () => {
    const user = userEvent.setup();
    const { PushPermissionError } = await import("@/lib/push");
    device.subscribeDevice.mockRejectedValue(new PushPermissionError());
    mockApi({ ...session, [`GET ${PUSH}`]: json(pushStatus) });

    await renderSignedIn(<NotificationSettings />);

    const toggle = await screen.findByRole("switch", { name: "Push notifications" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);

    expect(await screen.findByText(/site settings/)).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it("unsubscribes the browser when the server can't save the device", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${PUSH}`]: json(pushStatus),
      [`PUT ${PUSH}/subscriptions`]: status(500),
    });

    await renderSignedIn(<NotificationSettings />);

    const toggle = await screen.findByRole("switch", { name: "Push notifications" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);

    await waitFor(() => expect(device.unsubscribeDevice).toHaveBeenCalledOnce());
    expect(toggle).not.toBeChecked();
  });

  it("sends a test notification from a device that's on", async () => {
    const user = userEvent.setup();
    device.isDeviceSubscribed.mockResolvedValue(true);
    mockApi({
      ...session,
      [`GET ${PUSH}`]: json({ ...pushStatus, devices: 1 }),
      [`POST ${PUSH}/test`]: json({ sent: 1 }),
    });

    await renderSignedIn(<NotificationSettings />);

    await user.click(await screen.findByRole("button", { name: "Send a test notification" }));

    expect(await screen.findByText(/Test sent/)).toBeInTheDocument();
  });

  it("keeps reminder details hidden until asked, and saves the choice", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${PUSH}`]: json(pushStatus),
      [`PUT ${PUSH}/preferences`]: (request: MockRequest) => {
        sent.push(request.body);
        return Response.json({ ...pushStatus, show_details: true });
      },
    });

    await renderSignedIn(<NotificationSettings />);

    const details = await screen.findByRole("switch", { name: "Show reminder details" });
    expect(details).not.toBeChecked();
    await user.click(details);

    await waitFor(() =>
      expect(sent).toEqual([{ reminders: true, briefing: true, show_details: true }]),
    );
    await waitFor(() => expect(details).toBeChecked());
  });

  it("tells iPhone users to add Orbit to the Home Screen", async () => {
    device.pushSupport.mockReturnValue("needs-install");
    mockApi({ ...session, [`GET ${PUSH}`]: json(pushStatus) });

    await renderSignedIn(<NotificationSettings />);

    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Push notifications" })).not.toBeInTheDocument();
  });

  it("says so when the server can't send push", async () => {
    mockApi({
      ...session,
      [`GET ${PUSH}`]: json({ ...pushStatus, available: false, public_key: null }),
    });

    await renderSignedIn(<NotificationSettings />);

    expect(await screen.findByText(/aren’t available on this server/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("says so when the settings can't load", async () => {
    mockApi({ ...session, [`GET ${PUSH}`]: status(500) });

    await renderSignedIn(<NotificationSettings />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
