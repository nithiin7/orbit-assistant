"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { documentCategoriesOptions, documentListOptions } from "@/api/documents";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { documentsHref } from "@/lib/documents";
import { useAuth } from "@/providers/auth";

export type DocumentCommand = {
  id: string;
  label: string;
  description?: string;
  keywords: readonly string[];
  icon: "upload" | "search" | "expiring" | "category" | "document";
  /** Shown whatever the query, like the offer to search for it. */
  matched?: boolean;
  /** Recently opened documents, shown in their own group. */
  recent?: boolean;
  run: () => void;
};

/**
 * Documents commands for the command palette: upload, search, what's expiring, categories, and
 * recent documents. Data loads only while the palette is open; matching documents come from the
 * workspace search.
 */
export function useDocumentCommands(open: boolean, query: string): DocumentCommand[] {
  const router = useRouter();
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const recent = useQuery({
    ...documentListOptions(withToken, workspaceId, { sort: "recent", limit: 5 }),
    enabled: open,
  });
  const categories = useQuery({
    ...documentCategoriesOptions(withToken, workspaceId),
    enabled: open,
  });

  if (!workspaceId) return [];
  const go = (href: string) => () => router.push(href);
  const commands: DocumentCommand[] = [
    {
      id: "documents-upload",
      label: "Upload document",
      keywords: ["upload", "add", "new", "file", "scan", "document", "vault"],
      icon: "upload",
      run: go(`${documentsHref({ view: "all" })}&upload=1`),
    },
    {
      id: "documents-expiring",
      label: "Open expiring documents",
      description: "Documents",
      keywords: ["expiring", "expiry", "expire", "renew", "documents"],
      icon: "expiring",
      run: go(documentsHref({ view: "expiring" })),
    },
    {
      id: "documents-expired",
      label: "Open expired documents",
      description: "Documents",
      keywords: ["expired", "documents"],
      icon: "expiring",
      run: go(documentsHref({ view: "expired" })),
    },
  ];
  const text = query.trim();
  if (text) {
    commands.push({
      id: "documents-search",
      label: `Search documents for “${text}”`,
      keywords: [text],
      icon: "search",
      matched: true,
      run: go(documentsHref({ view: "all", search: text })),
    });
  }
  for (const document of recent.data?.documents ?? []) {
    commands.push({
      id: `documents-recent-${document.id}`,
      label: document.title,
      description: "Recent document",
      keywords: ["recent", "document", "open"],
      icon: "document",
      recent: true,
      run: go(documentsHref({ documentId: document.id })),
    });
  }
  for (const category of categories.data?.categories ?? []) {
    commands.push({
      id: `documents-category-${category.id}`,
      label: category.name,
      description: "Document category",
      keywords: ["category", "documents"],
      icon: "category",
      run: go(documentsHref({ categoryId: category.id })),
    });
  }
  return commands;
}
