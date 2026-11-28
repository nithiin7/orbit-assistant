import type { UpdateStatus } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { describeUpdate, formatAgo } from "./system";

const now = new Date("2026-11-28T12:00:00Z");

const base: UpdateStatus = {
  enabled: true,
  repository: "me/orbit",
  current_version: "1.0.0",
  latest_version: "1.0.0",
  latest_published_at: null,
  update_available: false,
  release_url: null,
  checked_at: "2026-11-28T09:00:00Z",
  check_failed: false,
};

describe("formatAgo", () => {
  it.each([
    ["2026-11-28T11:59:40Z", "just now"],
    ["2026-11-28T11:48:00Z", "12 min ago"],
    ["2026-11-28T09:00:00Z", "3 h ago"],
    ["2026-11-27T12:00:00Z", "1 day ago"],
    ["2026-11-25T12:00:00Z", "3 days ago"],
  ])("%s is %s", (at, expected) => {
    expect(formatAgo(at, now)).toBe(expected);
  });
});

describe("describeUpdate", () => {
  it("says checks are off", () => {
    expect(describeUpdate({ ...base, enabled: false }, now)).toMatchObject({
      tone: "muted",
      title: "Update checks are off",
      detail: "You’re running Orbit 1.0.0.",
    });
  });

  it("says when Orbit is up to date", () => {
    expect(describeUpdate(base, now)).toMatchObject({
      tone: "success",
      title: "You’re up to date",
      detail: "You’re running Orbit 1.0.0. Checked 3 h ago.",
    });
  });

  it("announces a newer release", () => {
    const status = { ...base, latest_version: "1.1.0", update_available: true };
    expect(describeUpdate(status, now)).toMatchObject({
      tone: "brand",
      title: "Orbit 1.1.0 is available",
    });
  });

  it("still announces a release found earlier when the last check failed", () => {
    const status = { ...base, latest_version: "1.1.0", update_available: true, check_failed: true };
    expect(describeUpdate(status, now).title).toBe("Orbit 1.1.0 is available");
  });

  it("reports a failed check", () => {
    expect(describeUpdate({ ...base, check_failed: true }, now)).toMatchObject({
      tone: "warning",
      title: "Couldn’t reach GitHub",
    });
  });

  it("says when it hasn't checked yet", () => {
    expect(describeUpdate({ ...base, checked_at: null, latest_version: null }, now).title).toBe(
      "Not checked yet",
    );
  });
});
