import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deviceEndpoint,
  isDeviceSubscribed,
  PushPermissionError,
  pushSupport,
  subscribeDevice,
  unsubscribeDevice,
} from "./device";

// Three bytes, URL-safe base64.
const KEY = "AQID";
const KEY_BYTES = new Uint8Array([1, 2, 3]).buffer;
const OTHER_KEY_BYTES = new Uint8Array([9, 9, 9]).buffer;

function fakeSubscription(applicationServerKey: ArrayBuffer | null = KEY_BYTES) {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/device",
    options: { applicationServerKey },
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/device",
      keys: { p256dh: "device-key", auth: "device-secret" },
    }),
  };
}

function stubBrowser(existing: ReturnType<typeof fakeSubscription> | null, permission = "granted") {
  const created = fakeSubscription();
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(created),
  };
  const registration = { pushManager };
  const register = vi.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register,
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue(permission) });
  return { pushManager, register, created };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("pushSupport", () => {
  it("is supported where the browser has push", () => {
    stubBrowser(null);

    expect(pushSupport()).toBe("supported");
  });

  it("asks iPhones to add Orbit to the Home Screen first", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS)");

    expect(pushSupport()).toBe("needs-install");
  });

  it("is unsupported elsewhere", () => {
    expect(pushSupport()).toBe("unsupported");
  });
});

describe("subscribing", () => {
  it("subscribes with the server's key and returns what the server needs", async () => {
    const { pushManager, register } = stubBrowser(null);

    await expect(subscribeDevice(KEY)).resolves.toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/device",
      p256dh: "device-key",
      auth: "device-secret",
    });

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    });
  });

  it("stops when permission is refused", async () => {
    const { pushManager } = stubBrowser(null, "denied");

    await expect(subscribeDevice(KEY)).rejects.toBeInstanceOf(PushPermissionError);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("replaces a subscription made with an older server key", async () => {
    const old = fakeSubscription(OTHER_KEY_BYTES);
    stubBrowser(old);

    await subscribeDevice(KEY);

    expect(old.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("the current subscription", () => {
  it("counts only a subscription with the server's current key", async () => {
    stubBrowser(fakeSubscription());
    await expect(isDeviceSubscribed(KEY)).resolves.toBe(true);

    stubBrowser(fakeSubscription(OTHER_KEY_BYTES));
    await expect(isDeviceSubscribed(KEY)).resolves.toBe(false);

    stubBrowser(null);
    await expect(isDeviceSubscribed(KEY)).resolves.toBe(false);
  });

  it("reports the endpoint and unsubscribes", async () => {
    const existing = fakeSubscription();
    stubBrowser(existing);

    await expect(deviceEndpoint()).resolves.toBe(existing.endpoint);
    await unsubscribeDevice();

    expect(existing.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does nothing where push isn't supported", async () => {
    await expect(deviceEndpoint()).resolves.toBeNull();
    await expect(unsubscribeDevice()).resolves.toBeUndefined();
  });
});
