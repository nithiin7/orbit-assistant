/**
 * Registers the service worker that makes Orbit installable. Production only, so it can't
 * interfere with hot reloading, and skipped where the browser has no support (including pages
 * not served over HTTPS or from localhost).
 */
export async function registerServiceWorker(): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch (error) {
    // Orbit works the same in the browser; only installing it as an app is unavailable.
    console.warn("Couldn’t register the service worker.", error);
  }
}
