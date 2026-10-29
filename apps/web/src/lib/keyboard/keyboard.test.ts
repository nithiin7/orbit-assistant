import { describe, expect, it } from "vitest";

import {
  isEditableTarget,
  isMacPlatform,
  matchesModShortcut,
  modKeyLabel,
  modKeyShortcut,
} from "./keyboard";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("matchesModShortcut", () => {
  it("uses Cmd on macOS", () => {
    expect(matchesModShortcut(key({ key: "k", metaKey: true }), "k", true)).toBe(true);
    expect(matchesModShortcut(key({ key: "k", ctrlKey: true }), "k", true)).toBe(false);
  });

  it("uses Ctrl elsewhere", () => {
    expect(matchesModShortcut(key({ key: "B", ctrlKey: true }), "b", false)).toBe(true);
    expect(matchesModShortcut(key({ key: "b", metaKey: true }), "b", false)).toBe(false);
  });

  it("ignores other keys and modifier combinations", () => {
    expect(matchesModShortcut(key({ key: "j", ctrlKey: true }), "k", false)).toBe(false);
    expect(matchesModShortcut(key({ key: "k", ctrlKey: true, shiftKey: true }), "k", false)).toBe(
      false,
    );
    expect(matchesModShortcut(key({ key: "k", ctrlKey: true, altKey: true }), "k", false)).toBe(
      false,
    );
    expect(matchesModShortcut(key({ key: "k" }), "k", false)).toBe(false);
  });
});

describe("modKeyShortcut", () => {
  it("formats aria-keyshortcuts values per platform", () => {
    expect(modKeyShortcut("k", true)).toBe("Meta+K");
    expect(modKeyShortcut("b", false)).toBe("Control+B");
    expect(modKeyShortcut("b", null)).toBe("Control+B");
  });

  it("formats visible labels per platform", () => {
    expect(modKeyLabel("b", true)).toBe("⌘B");
    expect(modKeyLabel("b", false)).toBe("Ctrl+B");
  });
});

describe("isMacPlatform", () => {
  it("detects Apple platforms from the user agent", () => {
    expect(isMacPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe(true);
    expect(isMacPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isMacPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("detects text entry targets", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
