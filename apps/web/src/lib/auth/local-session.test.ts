import { afterEach, describe, expect, it } from "vitest";

import {
  clearLocalSession,
  LOCAL_SESSION_KEY,
  readLocalSession,
  writeLocalSession,
} from "./local-session";

afterEach(() => {
  localStorage.clear();
});

describe("local session storage", () => {
  it("round-trips an unexpired session", () => {
    writeLocalSession({ token: "abc", expiresAt: "2999-01-01T00:00:00Z" });
    expect(readLocalSession()).toEqual({ token: "abc", expiresAt: "2999-01-01T00:00:00Z" });

    clearLocalSession();
    expect(readLocalSession()).toBeNull();
  });

  it("discards expired sessions", () => {
    writeLocalSession({ token: "abc", expiresAt: "2000-01-01T00:00:00Z" });

    expect(readLocalSession()).toBeNull();
    expect(localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
  });

  it.each(["not json", "{}", '{"token":"","expiresAt":"2999-01-01T00:00:00Z"}', "null"])(
    "discards malformed data: %s",
    (raw) => {
      localStorage.setItem(LOCAL_SESSION_KEY, raw);

      expect(readLocalSession()).toBeNull();
      expect(localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
    },
  );
});
