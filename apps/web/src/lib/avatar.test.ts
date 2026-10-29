import { describe, expect, it } from "vitest";

import { AvatarImageError, centerSquare, prepareAvatar } from "./avatar";

describe("centerSquare", () => {
  it.each([
    [400, 300, { x: 50, y: 0, side: 300 }],
    [300, 400, { x: 0, y: 50, side: 300 }],
    [256, 256, { x: 0, y: 0, side: 256 }],
    [101, 100, { x: 0, y: 0, side: 100 }],
  ])("crops %ix%i to the centered square", (width, height, expected) => {
    expect(centerSquare(width, height)).toEqual(expected);
  });
});

describe("prepareAvatar", () => {
  it("rejects files that aren't images", async () => {
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });

    await expect(prepareAvatar(file)).rejects.toThrow(AvatarImageError);
  });
});
