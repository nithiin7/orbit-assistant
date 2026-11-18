/**
 * This browser's side of push notifications: whether it can receive them, and subscribing it.
 * Nothing here talks to Orbit's API.
 */

export type PushSupport = "supported" | "needs-install" | "unsupported";

export type DeviceSubscription = { endpoint: string; p256dh: string; auth: string };

/** The person declined, or earlier blocked, notifications for Orbit in this browser. */
export class PushPermissionError extends Error {
  constructor() {
    super("Notifications are blocked for Orbit in this browser.");
    this.name = "PushPermissionError";
  }
}

function isAppleMobile(): boolean {
  const { userAgent, maxTouchPoints } = navigator;
  // iPadOS reports itself as a Mac, but Macs have no touch screen.
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
    return "supported";
  }
  // Safari on iPhone and iPad offers push only to apps added to the Home Screen.
  return isAppleMobile() ? "needs-install" : "unsupported";
}

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function usesKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (current === null) return false;
  const expected = decodeKey(publicKey);
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Whether this browser is subscribed with the server's current key. */
export async function isDeviceSubscribed(publicKey: string): Promise<boolean> {
  const subscription = await currentSubscription();
  return subscription !== null && usesKey(subscription, publicKey);
}

/** Ask for permission if needed, then subscribe this browser. */
export async function subscribeDevice(publicKey: string): Promise<DeviceSubscription> {
  if ((await Notification.requestPermission()) !== "granted") throw new PushPermissionError();

  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing && !usesKey(existing, publicKey)) await existing.unsubscribe();

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(publicKey),
  });
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    await subscription.unsubscribe();
    throw new Error("The browser returned an incomplete push subscription.");
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** The address this browser is subscribed at, for telling the server to forget it. */
export async function deviceEndpoint(): Promise<string | null> {
  return (await currentSubscription())?.endpoint ?? null;
}

/** Stop this browser receiving push notifications. */
export async function unsubscribeDevice(): Promise<void> {
  await (await currentSubscription())?.unsubscribe();
}
