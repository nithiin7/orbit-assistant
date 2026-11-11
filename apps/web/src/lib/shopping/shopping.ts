/** Shopping list ordering, link display, and form schemas that mirror the API's. */

import type { ShoppingItem, ShoppingListIcon } from "@orbit/contracts";
import { mixed, object, string } from "yup";

import { type Option } from "@/utils/common";
import { multiLineText, singleLineText, tooLongMessage } from "@/utils/validation";

export const LIST_NAME_MAX_LENGTH = 100;
export const ITEM_NAME_MAX_LENGTH = 200;
export const QUANTITY_MAX_LENGTH = 50;
export const URL_MAX_LENGTH = 2048;
export const NOTES_MAX_LENGTH = 2000;

/** Optional; when present, an http(s) URL with a host, like the API accepts. */
const urlField = string()
  .trim()
  .defined()
  .max(URL_MAX_LENGTH, tooLongMessage(URL_MAX_LENGTH))
  .test(
    "web-url",
    "Enter a full web address, starting with https://",
    (value) => !value || (!/\s/.test(value) && parseWebUrl(value) !== null),
  );

/** The icons a list can show, in picker order. New lists use the basket. */
export const SHOPPING_LIST_ICONS: readonly Option<ShoppingListIcon>[] = [
  { value: "basket", label: "Basket" },
  { value: "cart", label: "Cart" },
  { value: "apple", label: "Fruit" },
  { value: "carrot", label: "Vegetables" },
  { value: "coffee", label: "Coffee" },
  { value: "pill", label: "Pharmacy" },
  { value: "home", label: "Home" },
  { value: "gift", label: "Gift" },
  { value: "shirt", label: "Clothes" },
  { value: "paw", label: "Pets" },
  { value: "baby", label: "Baby" },
  { value: "wrench", label: "Hardware" },
];

export const DEFAULT_LIST_ICON: ShoppingListIcon = "basket";

export const listSchema = object({
  name: singleLineText(LIST_NAME_MAX_LENGTH).required("Enter a name."),
  icon: mixed<ShoppingListIcon>()
    .oneOf(SHOPPING_LIST_ICONS.map((option) => option.value))
    .defined(),
});

const itemFields = {
  name: singleLineText(ITEM_NAME_MAX_LENGTH).required("Enter an item."),
  quantity: singleLineText(QUANTITY_MAX_LENGTH),
  url: urlField,
};

export const newItemSchema = object(itemFields);

export const itemSchema = object({ ...itemFields, notes: multiLineText(NOTES_MAX_LENGTH) });

function parseWebUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** A short label for a link: its host without `www.`, or the URL itself if it doesn't parse. */
export function linkLabel(url: string): string {
  return parseWebUrl(url)?.hostname.replace(/^www\./, "") ?? url;
}

/** Blank optional text is sent as `null`, which the API stores as "not set". */
export function optionalText(value: string): string | null {
  return value.trim() || null;
}

/**
 * The API's order: needed items in the order they were added, then purchased items, most
 * recently purchased first. Lets the page re-sort after a change without reloading.
 */
export function sortItems(items: readonly ShoppingItem[]): ShoppingItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "needed" ? -1 : 1;
    if (a.status === "purchased" && a.purchased_at !== b.purchased_at) {
      return (b.purchased_at ?? "").localeCompare(a.purchased_at ?? "");
    }
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}

export function countItems(items: readonly ShoppingItem[]): { needed: number; purchased: number } {
  const needed = items.filter((item) => item.status === "needed").length;
  return { needed, purchased: items.length - needed };
}
