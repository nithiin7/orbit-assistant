/** Shopping list ordering, link display, and client-side validation that mirrors the API's. */

import type { ShoppingItem } from "@orbit/contracts";

export const LIST_NAME_MAX_LENGTH = 100;
export const ITEM_NAME_MAX_LENGTH = 200;
export const QUANTITY_MAX_LENGTH = 50;
export const URL_MAX_LENGTH = 2048;
export const NOTES_MAX_LENGTH = 2000;

// Control characters, which the API rejects (notes may contain line breaks and tabs).
const CONTROL_CHARACTERS = /\p{Cc}/u;
const CONTROL_CHARACTERS_EXCEPT_WHITESPACE = /(?![\n\r\t])\p{Cc}/u;

function validateLine(
  value: string,
  maxLength: number,
  { required, empty }: { required: boolean; empty: string },
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return required ? empty : undefined;
  if (trimmed.length > maxLength) return `Use ${maxLength} characters or fewer.`;
  if (CONTROL_CHARACTERS.test(trimmed)) return "Remove line breaks and unsupported characters.";
  return undefined;
}

export function validateListName(name: string): string | undefined {
  return validateLine(name, LIST_NAME_MAX_LENGTH, { required: true, empty: "Enter a name." });
}

export function validateItemName(name: string): string | undefined {
  return validateLine(name, ITEM_NAME_MAX_LENGTH, { required: true, empty: "Enter an item." });
}

export function validateQuantity(quantity: string): string | undefined {
  return validateLine(quantity, QUANTITY_MAX_LENGTH, { required: false, empty: "" });
}

export function validateNotes(notes: string): string | undefined {
  const value = notes.trim();
  if (value.length > NOTES_MAX_LENGTH) return `Use ${NOTES_MAX_LENGTH} characters or fewer.`;
  if (CONTROL_CHARACTERS_EXCEPT_WHITESPACE.test(value)) return "Remove unsupported characters.";
  return undefined;
}

/** Optional; when present, an http(s) URL with a host, like the API accepts. */
export function validateUrl(url: string): string | undefined {
  const value = url.trim();
  if (!value) return undefined;
  if (value.length > URL_MAX_LENGTH) return `Use ${URL_MAX_LENGTH} characters or fewer.`;
  if (/\s/.test(value) || !parseWebUrl(value)) {
    return "Enter a full web address, starting with https://";
  }
  return undefined;
}

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
