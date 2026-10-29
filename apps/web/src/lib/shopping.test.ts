import type { ShoppingItem } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  countItems,
  linkLabel,
  optionalText,
  sortItems,
  validateItemName,
  validateListName,
  validateNotes,
  validateQuantity,
  validateUrl,
} from "./shopping";

function item(overrides: Partial<ShoppingItem> & Pick<ShoppingItem, "id">): ShoppingItem {
  return {
    workspace_id: "w",
    list_id: "l",
    name: overrides.id,
    quantity: null,
    url: null,
    notes: "",
    status: "needed",
    purchased_at: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

describe("validation", () => {
  it("requires list and item names within the API's limits", () => {
    expect(validateListName("  ")).toBe("Enter a name.");
    expect(validateListName("x".repeat(101))).toBe("Use 100 characters or fewer.");
    expect(validateListName(" Electronics ")).toBeUndefined();
    expect(validateItemName("")).toBe("Enter an item.");
    expect(validateItemName("x".repeat(201))).toBe("Use 200 characters or fewer.");
    expect(validateItemName("Line\nbreak")).toMatch(/line breaks/);
    expect(validateItemName("Oat milk 🥛")).toBeUndefined();
  });

  it("treats quantity as optional single-line text", () => {
    expect(validateQuantity("")).toBeUndefined();
    expect(validateQuantity("2 kg")).toBeUndefined();
    expect(validateQuantity("x".repeat(51))).toBe("Use 50 characters or fewer.");
  });

  it("allows line breaks in notes but not other control characters", () => {
    expect(validateNotes("Brand A\n\tor B")).toBeUndefined();
    expect(validateNotes("Bell\u0007")).toBe("Remove unsupported characters.");
    expect(validateNotes("x".repeat(2001))).toBe("Use 2000 characters or fewer.");
  });

  it.each([
    ["", undefined],
    ["https://example.com/cable?x=1#a", undefined],
    ["http://shop.example", undefined],
    ["example.com/cable", "Enter a full web address, starting with https://"],
    ["javascript:alert(1)", "Enter a full web address, starting with https://"],
    ["ftp://example.com", "Enter a full web address, starting with https://"],
    ["https://example.com/a b", "Enter a full web address, starting with https://"],
  ])("validateUrl(%j) is %j", (url, expected) => {
    expect(validateUrl(url)).toBe(expected);
  });
});

describe("display helpers", () => {
  it("labels links by host", () => {
    expect(linkLabel("https://www.example.com/item/123")).toBe("example.com");
    expect(linkLabel("https://shop.example.co.uk/x")).toBe("shop.example.co.uk");
    expect(linkLabel("not a url")).toBe("not a url");
  });

  it("turns blank optional text into null", () => {
    expect(optionalText("  ")).toBeNull();
    expect(optionalText(" 2 kg ")).toBe("2 kg");
  });
});

describe("sortItems", () => {
  it("puts needed items first in the order added, then the latest purchases", () => {
    const items = [
      item({ id: "bought-early", status: "purchased", purchased_at: "2026-10-02T09:00:00Z" }),
      item({ id: "second", created_at: "2026-10-01T10:00:00Z" }),
      item({ id: "bought-late", status: "purchased", purchased_at: "2026-10-03T09:00:00Z" }),
      item({ id: "first", created_at: "2026-10-01T08:00:00Z" }),
    ];

    expect(sortItems(items).map((entry) => entry.id)).toEqual([
      "first",
      "second",
      "bought-late",
      "bought-early",
    ]);
    expect(countItems(items)).toEqual({ needed: 2, purchased: 2 });
  });
});
