import type {
  DocumentCategoryIcon,
  DocumentFile,
  DocumentLinkKind,
  DocumentSummary,
} from "@orbit/contracts";
import {
  BadgeCheck,
  Briefcase,
  CalendarDays,
  Car,
  CheckSquare,
  FileImage,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  GraduationCap,
  HeartPulse,
  Home,
  IdCard,
  Landmark,
  type LucideIcon,
  NotebookPen,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  Shield,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { describeExpiry, fileKindOf } from "@/lib/documents";
import { cn } from "@/utils/common";

export const CATEGORY_ICONS: Record<DocumentCategoryIcon, LucideIcon> = {
  "id-card": IdCard,
  briefcase: Briefcase,
  wallet: Wallet,
  receipt: Receipt,
  landmark: Landmark,
  shield: Shield,
  car: Car,
  home: Home,
  "heart-pulse": HeartPulse,
  "graduation-cap": GraduationCap,
  "file-text": FileText,
  plane: Plane,
  "badge-check": BadgeCheck,
  folder: Folder,
};

export const LINK_ICONS: Record<DocumentLinkKind, LucideIcon> = {
  note: NotebookPen,
  task: CheckSquare,
  event: CalendarDays,
  transaction: Receipt,
  loan: Landmark,
  recurring_payment: Repeat,
  deposit: PiggyBank,
  holding: TrendingUp,
  asset: Home,
};

/** An icon for the file's kind; a question mark for documents without a file yet. */
export function FileIcon({
  file,
  className,
}: {
  file: Pick<DocumentFile, "extension"> | null;
  className?: string;
}) {
  const kind = fileKindOf(file);
  const Icon =
    kind === "pdf"
      ? FileType2
      : kind === "image"
        ? FileImage
        : kind === "office"
          ? file?.extension === "xlsx"
            ? FileSpreadsheet
            : FileText
          : kind === "text"
            ? FileText
            : FileQuestion;
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg",
        kind === "pdf" && "bg-destructive/10 text-destructive",
        kind === "image" && "bg-brand-subtle text-brand",
        (kind === "office" || kind === "text") && "bg-muted text-foreground",
        kind === "none" && "border border-dashed text-muted-foreground",
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

/** A file's type in words: "PDF", "PNG", or "No file". */
export function fileTypeLabel(file: Pick<DocumentFile, "extension"> | null): string {
  return file ? file.extension.toUpperCase() : "No file";
}

/** The expiry date as a chip, colored by how soon it is. */
export function ExpiryChip({
  document,
  today,
}: {
  document: Pick<DocumentSummary, "expiry_date" | "expiry_status">;
  today: string;
}) {
  const expiry = describeExpiry(document.expiry_date, document.expiry_status, today);
  if (!expiry) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        expiry.status === "expired" && "bg-destructive/10 text-destructive",
        expiry.status === "expiring" && "bg-warning/15 text-warning",
        expiry.status === "valid" && "bg-muted text-muted-foreground",
      )}
    >
      {expiry.label}
    </span>
  );
}
