import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node 25+ defines an experimental global `localStorage` that shadows jsdom's and is unusable
// without `--localstorage-file`. Replace it with a minimal in-memory Storage for tests.
if (typeof globalThis.localStorage?.getItem !== "function") {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

// jsdom does not implement modal dialogs or scrolling; emulate the behavior components rely on.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  if (!this.open) return;
  this.open = false;
  this.dispatchEvent(new Event("close"));
};
Element.prototype.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
});
