import { afterEach, describe, expect, it, vi } from "vitest";

import { revealWhenVisible } from "./reveal";

type Callback = (entries: Pick<IntersectionObserverEntry, "isIntersecting">[]) => void;

function stubObserver() {
  const observer = { callback: null as Callback | null, observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: Callback) {
        observer.callback = callback;
      }
      observe = observer.observe;
      disconnect = observer.disconnect;
    },
  );
  return observer;
}

describe("revealWhenVisible", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks the element once it scrolls into view, then stops watching", () => {
    const observer = stubObserver();
    const element = document.createElement("div");

    revealWhenVisible(element);
    expect(observer.observe).toHaveBeenCalledWith(element);

    observer.callback?.([{ isIntersecting: false }]);
    expect(element).not.toHaveAttribute("data-in-view");

    observer.callback?.([{ isIntersecting: true }]);
    expect(element).toHaveAttribute("data-in-view");
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("stops watching when the element goes away", () => {
    const observer = stubObserver();
    const cleanup = revealWhenVisible(document.createElement("div"));

    cleanup?.();

    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("marks the element at once without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const element = document.createElement("div");

    revealWhenVisible(element);

    expect(element).toHaveAttribute("data-in-view");
  });
});
