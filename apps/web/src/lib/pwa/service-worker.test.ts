import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

type Handler = (event: Record<string, unknown>) => void;

/** Runs `public/sw.js` against a fake worker scope and returns its event handlers. */
function loadWorker(windows: Record<string, unknown>[] = []) {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const self = {
    location: { origin: "https://orbit.example.com" },
    registration: { showNotification },
    clients: { matchAll: vi.fn().mockResolvedValue(windows), openWindow },
    addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
  };
  runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), { self, URL });
  return { handlers, showNotification, openWindow };
}

async function click(handler: Handler | undefined, link: unknown) {
  let finished: Promise<unknown> = Promise.resolve();
  handler?.({
    notification: { close: vi.fn(), data: { link } },
    waitUntil: (work: Promise<unknown>) => (finished = work),
  });
  await finished;
}

describe("the service worker", () => {
  it("never intercepts requests, so nothing private is cached", () => {
    expect(loadWorker().handlers.has("fetch")).toBe(false);
  });

  it("shows the notification it receives", () => {
    const { handlers, showNotification } = loadWorker();

    handlers.get("push")?.({
      data: {
        json: () => ({
          title: "Orbit",
          body: "You have a reminder.",
          link: "/reminders",
          tag: "a",
        }),
      },
      waitUntil: vi.fn(),
    });

    expect(showNotification).toHaveBeenCalledOnce();
    const [title, options] = showNotification.mock.calls[0] as [string, Record<string, unknown>];
    expect(title).toBe("Orbit");
    expect(options.body).toBe("You have a reminder.");
    expect(options.tag).toBe("a");
  });

  it("still shows something when a message can't be read", () => {
    const { handlers, showNotification } = loadWorker();

    handlers.get("push")?.({
      data: {
        json: () => {
          throw new Error("Not JSON");
        },
      },
      waitUntil: vi.fn(),
    });

    expect(showNotification.mock.calls[0]?.[0]).toBe("Orbit");
  });

  it("opens the notification's page in a new window when Orbit is closed", async () => {
    const { handlers, openWindow } = loadWorker();

    await click(handlers.get("notificationclick"), "/reminders");

    expect(openWindow).toHaveBeenCalledWith("https://orbit.example.com/reminders");
  });

  it("reuses a window that's already open", async () => {
    const open = {
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
    };
    const { handlers, openWindow } = loadWorker([open]);

    await click(handlers.get("notificationclick"), "/reminders");

    expect(open.focus).toHaveBeenCalledOnce();
    expect(open.navigate).toHaveBeenCalledWith("https://orbit.example.com/reminders");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example/phish", "//evil.example/phish"])(
    "never leaves Orbit for %s",
    async (link) => {
      const { handlers, openWindow } = loadWorker();

      await click(handlers.get("notificationclick"), link);

      expect(openWindow).toHaveBeenCalledWith("https://orbit.example.com/");
    },
  );
});
