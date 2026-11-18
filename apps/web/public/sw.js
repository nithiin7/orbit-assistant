/*
 * Orbit's service worker: it makes the app installable and shows push notifications. It
 * deliberately has no fetch handler: pages and API responses hold private data, so nothing is
 * cached on the device and every request goes to the network as usual.
 */
self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readMessage(event) {
  try {
    return event.data?.json() ?? {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const message = readMessage(event);
  event.waitUntil(
    self.registration.showNotification(message.title || "Orbit", {
      body: message.body || "You have a new notification.",
      tag: message.tag,
      icon: "/icons/icon-192.png",
      data: { link: message.link },
    }),
  );
});

/** The page to open: only ever one of Orbit's own. */
function targetUrl(link) {
  const url = new URL(typeof link === "string" ? link : "/", self.location.origin);
  return url.origin === self.location.origin ? url.href : self.location.origin + "/";
}

async function openPage(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows[0];
  if (!open) {
    await self.clients.openWindow(url);
    return;
  }
  await open.focus();
  await open.navigate(url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openPage(targetUrl(event.notification.data?.link)));
});
