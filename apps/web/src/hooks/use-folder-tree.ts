"use client";

import { useState } from "react";

import { buildFolderTree, type FolderLike, type FolderNode, visibleFolders } from "@/utils/folders";

type FolderTree<T extends FolderLike> = {
  /** The folders to show, in reading order, skipping those inside collapsed folders. */
  rows: FolderNode<T>[];
  expanded: ReadonlySet<string>;
  /** Folders with subfolders, which get an expand toggle. */
  parents: ReadonlySet<string>;
  toggle: (folderId: string) => void;
  expand: (folderId: string) => void;
};

/** A collapsible folder tree's state, for the Notes and Documents rails. */
export function useFolderTree<T extends FolderLike>(
  folders: readonly T[],
  /** Folders that start expanded, read once on mount. */
  initiallyExpanded: () => Iterable<string> = () => [],
): FolderTree<T> {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initiallyExpanded()));
  return {
    rows: visibleFolders(buildFolderTree(folders), expanded),
    expanded,
    parents: new Set(folders.flatMap((folder) => (folder.parent_id ? [folder.parent_id] : []))),
    toggle: (folderId) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        return next;
      }),
    expand: (folderId) => setExpanded((current) => new Set([...current, folderId])),
  };
}
