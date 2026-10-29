import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { mergeRefs } from "./utils";

describe("mergeRefs", () => {
  it("sets object and callback refs, and skips missing ones", () => {
    const object = createRef<string>();
    const callback = vi.fn();
    const merged = mergeRefs(object, callback, undefined, null);

    merged("input");
    expect(object.current).toBe("input");
    expect(callback).toHaveBeenCalledWith("input");

    merged(null);
    expect(object.current).toBeNull();
    expect(callback).toHaveBeenLastCalledWith(null);
  });
});
