import { afterEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "./download";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveBlob", () => {
  it("clicks a temporary link and releases the object URL", () => {
    const create = vi.fn(() => "blob:orbit/1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    saveBlob(new Blob(["x"]), "backup.zip");

    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:orbit/1");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
