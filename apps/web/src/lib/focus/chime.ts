/**
 * A soft two-note chime made with the Web Audio API, so no sound file is shipped. Browsers only
 * play audio after the user has interacted with the page; when they refuse, nothing happens.
 */
export function playChime(): void {
  try {
    const context = new AudioContext();
    const start = context.currentTime;
    const notes = [
      { frequency: 660, at: 0 },
      { frequency: 880, at: 0.22 },
    ];
    for (const { frequency, at } of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      // A quick fade in and a long fade out, so it rings instead of beeping.
      gain.gain.setValueAtTime(0, start + at);
      gain.gain.linearRampToValueAtTime(0.18, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.9);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + 0.95);
    }
    window.setTimeout(() => void context.close(), 1500);
  } catch {
    // No Web Audio (or it's blocked): the toast still says the phase ended.
  }
}

/** Whether this browser can show notifications at all. */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * A browser notification, only while the page is in the background (the toast covers the
 * foreground) and only once the user has allowed them.
 */
export function notifyInBackground(title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    new Notification(title, { body, tag: "orbit-focus" });
  } catch {
    // Some browsers allow notifications only from a service worker; the toast still shows.
  }
}
