/**
 * Ready-made shopping lists, offered from an empty list. Using one adds its items to the list in
 * view; they're ordinary items afterwards.
 */

import type { CreateShoppingItemRequest } from "@orbit/contracts";
import { Carrot, type LucideIcon, PartyPopper, Sparkles, Tent } from "lucide-react";

export type ShoppingTemplate = {
  id: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  items: readonly string[];
};

export const SHOPPING_TEMPLATES: readonly ShoppingTemplate[] = [
  {
    id: "weekly-groceries",
    name: "Weekly groceries",
    blurb: "The staples most kitchens run through each week.",
    icon: Carrot,
    items: ["Milk", "Bread", "Eggs", "Fruit", "Vegetables", "Rice", "Coffee or tea", "Yoghurt"],
  },
  {
    id: "household",
    name: "Household basics",
    blurb: "Cleaning and bathroom things that run out quietly.",
    icon: Sparkles,
    items: [
      "Dish soap",
      "Laundry detergent",
      "Toilet paper",
      "Bin bags",
      "Hand soap",
      "Kitchen towels",
    ],
  },
  {
    id: "party",
    name: "Hosting a party",
    blurb: "Food, drinks, and the bits people forget.",
    icon: PartyPopper,
    items: ["Snacks", "Drinks", "Ice", "Cups", "Napkins", "Candles", "Dessert"],
  },
  {
    id: "camping",
    name: "Camping trip",
    blurb: "Supplies for a night or two outdoors.",
    icon: Tent,
    items: [
      "Water",
      "Easy meals",
      "Torch batteries",
      "Sunscreen",
      "Insect repellent",
      "First aid kit",
    ],
  },
];

/** The requests that add a template's items, in order. */
export function shoppingTemplateRequests(template: ShoppingTemplate): CreateShoppingItemRequest[] {
  return template.items.map((name) => ({ name, notes: "" }));
}
