import type { ShoppingItem, ShoppingItems, ShoppingLists } from "@orbit/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { replaceCachedItem, shoppingKeys, updateCachedItems, updateCachedLists } from "./queries";

function item(id: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id,
    list_id: "l1",
    workspace_id: "w1",
    name: id,
    quantity: null,
    url: null,
    notes: "",
    status: "needed",
    purchased_at: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  } satisfies ShoppingItem;
}

const listsKey = shoppingKeys.lists("w1");
const itemsKey = shoppingKeys.items("w1", "l1");

function seed(): QueryClient {
  const client = new QueryClient();
  const list = {
    id: "l1",
    workspace_id: "w1",
    name: "Groceries",
    is_default: true,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
  };
  client.setQueryData<ShoppingLists>(listsKey, {
    lists: [{ ...list, needed_count: 2, purchased_count: 0 }],
  });
  client.setQueryData<ShoppingLists>(shoppingKeys.lists("w2"), {
    lists: [{ ...list, workspace_id: "w2", needed_count: 2, purchased_count: 0 }],
  });
  client.setQueryData<ShoppingItems>(itemsKey, { items: [item("milk"), item("eggs")] });
  return client;
}

function counts(client: QueryClient, workspaceId: string) {
  const list = client.getQueryData<ShoppingLists>(shoppingKeys.lists(workspaceId))?.lists[0];
  return { needed: list?.needed_count, purchased: list?.purchased_count };
}

describe("updateCachedItems", () => {
  it("keeps the list's counts in step with its items, in that workspace only", () => {
    const client = seed();

    updateCachedItems(client, "w1", "l1", (items) => [...items, item("bread")]);

    expect(client.getQueryData<ShoppingItems>(itemsKey)?.items).toHaveLength(3);
    expect(counts(client, "w1")).toEqual({ needed: 3, purchased: 0 });
    expect(counts(client, "w2")).toEqual({ needed: 2, purchased: 0 });
  });

  it("does nothing for a list whose items aren't loaded", () => {
    const client = seed();

    updateCachedItems(client, "w1", "other", () => [item("x")]);

    expect(client.getQueryData(shoppingKeys.items("w1", "other"))).toBeUndefined();
    expect(counts(client, "w1")).toEqual({ needed: 2, purchased: 0 });
  });
});

describe("replaceCachedItem", () => {
  it("moves a bought item into the purchased count", () => {
    const client = seed();

    replaceCachedItem(client, "w1", item("milk", { status: "purchased" }));

    expect(counts(client, "w1")).toEqual({ needed: 1, purchased: 1 });
  });
});

describe("updateCachedLists", () => {
  it("changes the cached lists", () => {
    const client = seed();

    updateCachedLists(client, "w1", () => []);

    expect(client.getQueryData<ShoppingLists>(listsKey)?.lists).toEqual([]);
  });
});
