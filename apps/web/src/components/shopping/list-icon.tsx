import type { ShoppingListIcon } from "@orbit/contracts";
import {
  Apple,
  Baby,
  Carrot,
  Coffee,
  Gift,
  House,
  type LucideIcon,
  PawPrint,
  Pill,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  Wrench,
} from "lucide-react";

export const SHOPPING_LIST_ICON_COMPONENTS: Record<ShoppingListIcon, LucideIcon> = {
  basket: ShoppingBasket,
  cart: ShoppingCart,
  apple: Apple,
  carrot: Carrot,
  coffee: Coffee,
  pill: Pill,
  home: House,
  gift: Gift,
  shirt: Shirt,
  paw: PawPrint,
  baby: Baby,
  wrench: Wrench,
};
