import type { PersonDateKind } from "@orbit/contracts";
import { Cake, CalendarHeart, Heart, type LucideIcon } from "lucide-react";

export const DATE_ICONS: Record<PersonDateKind, LucideIcon> = {
  birthday: Cake,
  anniversary: Heart,
  other: CalendarHeart,
};
