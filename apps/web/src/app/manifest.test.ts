import { existsSync } from "node:fs";
import { join } from "node:path";

import manifest from "./manifest";

describe("manifest", () => {
  it("describes an installable app that opens on the dashboard", () => {
    expect(manifest()).toMatchObject({
      name: "Orbit",
      short_name: "Orbit",
      start_url: "/",
      display: "standalone",
    });
  });

  it("offers the icon sizes browsers require, including a maskable one", () => {
    const icons = manifest().icons ?? [];

    expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("points only at icons that exist", () => {
    for (const icon of manifest().icons ?? []) {
      expect(existsSync(join(process.cwd(), "public", icon.src))).toBe(true);
    }
  });
});
