/** Folder trees from flat lists with `parent_id`, shared by notes and documents. */

/** What the tree needs of a folder; notes and documents both have these. */
export type FolderLike = { id: string; parent_id: string | null; name: string };

export type FolderNode<T extends FolderLike = FolderLike> = {
  folder: T;
  depth: number;
  children: FolderNode<T>[];
};

/** Folders as a tree, siblings by name. Folders whose parent is missing sit at the top. */
export function buildFolderTree<T extends FolderLike>(folders: readonly T[]): FolderNode<T>[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const byParent = new Map<string | null, T[]>();
  for (const folder of folders) {
    const parent = folder.parent_id && ids.has(folder.parent_id) ? folder.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): FolderNode<T>[] =>
    (byParent.get(parent) ?? [])
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .filter((folder) => !seen.has(folder.id) && seen.add(folder.id))
      .map((folder) => ({ folder, depth, children: build(folder.id, depth + 1) }));
  return build(null, 0);
}

/** The tree in reading order, keeping only nodes whose ancestors are all expanded. */
export function visibleFolders<T extends FolderLike>(
  tree: readonly FolderNode<T>[],
  expanded: ReadonlySet<string>,
): FolderNode<T>[] {
  return tree.flatMap((node) => [
    node,
    ...(expanded.has(node.folder.id) ? visibleFolders(node.children, expanded) : []),
  ]);
}

/** Every folder in reading order, for pickers. */
export function flattenFolders<T extends FolderLike>(
  tree: readonly FolderNode<T>[],
): FolderNode<T>[] {
  return tree.flatMap((node) => [node, ...flattenFolders(node.children)]);
}

/** The folder and all folders inside it: where it can't be moved. */
export function folderSubtree(folders: readonly FolderLike[], folderId: string): Set<string> {
  const found = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent_id && found.has(folder.parent_id) && !found.has(folder.id)) {
        found.add(folder.id);
        grew = true;
      }
    }
  }
  return found;
}

/** The folder's ancestors' names and its own, top first: "Work / Projects". */
export function folderPath(folders: readonly FolderLike[], folderId: string | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && path.length < 20) {
    path.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

/** The folder's ancestors, nearest last, so they can be expanded to reveal it. */
export function folderAncestors(folders: readonly FolderLike[], folderId: string): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const ancestors: string[] = [];
  let parent = byId.get(folderId)?.parent_id;
  while (parent && parent !== folderId && !ancestors.includes(parent)) {
    ancestors.unshift(parent);
    parent = byId.get(parent)?.parent_id;
  }
  return ancestors;
}
