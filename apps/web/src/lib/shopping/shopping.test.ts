import type { ShoppingItem } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { fieldErrors } from "@/test/validation";

import {
  countItems,
  itemSchema,
  linkLabel,
  listNameSchema,
  optionalText,
  sortItems,
} from "./shopping";

const validItem = { name: "Oat milk", quantity: "", url: "", notes: "" };
const itemErrors = (changes: Partial<typeof validItem>) =>
  fieldErrors(itemSchema, { ...validItem, ...changes });
const listNameError = (name: string) => fieldErrors(listNameSchema, { name }).name;

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
    expect(listNameError("  ")).toBe("Enter a name.");
    expect(listNameError("x".repeat(101))).toBe("Use 100 characters or fewer.");
    expect(listNameError(" Electronics ")).toBeUndefined();
    expect(itemErrors({ name: "" }).name).toBe("Enter an item.");
    expect(itemErrors({ name: "x".repeat(201) }).name).toBe("Use 200 characters or fewer.");
    expect(itemErrors({ name: "Line\nbreak" }).name).toMatch(/line breaks/);
    expect(itemErrors({ name: "Oat milk 🥛" }).name).toBeUndefined();
  });

  it("treats quantity as optional single-line text", () => {
    expect(itemErrors({ quantity: "" }).quantity).toBeUndefined();
    expect(itemErrors({ quantity: "2 kg" }).quantity).toBeUndefined();
    expect(itemErrors({ quantity: "x".repeat(51) }).quantity).toBe("Use 50 characters or fewer.");
  });

  it("allows line breaks in notes but not other control characters", () => {
    expect(itemErrors({ notes: "Brand A\n\tor B" }).notes).toBeUndefined();
    expect(itemErrors({ notes: "Bell\u0007" }).notes).toBe("Remove unsupported characters.");
    expect(itemErrors({ notes: "x".repeat(2001) }).notes).toBe("Use 2000 characters or fewer.");
  });

  it.each([
    ["", undefined],
    ["https://example.com/cable?x=1#a", undefined],
    ["http://shop.example", undefined],
    ["example.com/cable", "Enter a full web address, starting with https://"],
    ["javascript:alert(1)", "Enter a full web address, starting with https://"],
    ["ftp://example.com", "Enter a full web address, starting with https://"],
    ["https://example.com/a b", "Enter a full web address, starting with https://"],
  ])("url %j is %j", (url, expected) => {
    expect(itemErrors({ url }).url).toBe(expected);
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
