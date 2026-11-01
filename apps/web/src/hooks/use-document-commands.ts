"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  /** Found by the API's search; shown whatever the query. */
  matched?: boolean;
  /** Recently opened documents, shown in their own group. */
  recent?: boolean;
  run: () => void;
};

const SEARCH_DELAY_MS = 200;

/**
 * Documents commands for the command palette: upload, search, what's expiring, categories,
 * recent documents, and live search by name. Data loads only while the palette is open.
 */
export function useDocumentCommands(open: boolean, query: string): DocumentCommand[] {
  const router = useRouter();
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searching = open && search.length >= 2;
  const matches = useQuery({
    ...documentListOptions(withToken, workspaceId, { q: search, limit: 6, sort: "title" }),
    enabled: searching,
  });
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
  if (searching) {
    for (const document of matches.data?.documents ?? []) {
      commands.push({
        id: `documents-match-${document.id}`,
        label: document.title,
        description: "Document",
        keywords: [],
        icon: "document",
        matched: true,
        run: go(documentsHref({ documentId: document.id })),
      });
    }
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
