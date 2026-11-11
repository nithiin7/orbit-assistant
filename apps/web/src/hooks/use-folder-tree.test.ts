import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFolderTree } from "./use-folder-tree";

const folders = [
  { id: "a", parent_id: null, name: "Alpha" },
  { id: "b", parent_id: "a", name: "Beta" },
  { id: "c", parent_id: "b", name: "Gamma" },
  { id: "d", parent_id: null, name: "Delta" },
];

const names = (rows: { folder: { name: string } }[]) => rows.map(({ folder }) => folder.name);

describe("useFolderTree", () => {
  it("shows top-level folders until a parent is expanded, and marks parents", () => {
    const { result } = renderHook(() => useFolderTree(folders));

    expect(names(result.current.rows)).toEqual(["Alpha", "Delta"]);
    expect([...result.current.parents].sort()).toEqual(["a", "b"]);

    act(() => result.current.toggle("a"));
    expect(names(result.current.rows)).toEqual(["Alpha", "Beta", "Delta"]);

    act(() => result.current.toggle("a"));
    expect(names(result.current.rows)).toEqual(["Alpha", "Delta"]);
  });

  it("starts with the given folders expanded and can expand more", () => {
    const { result } = renderHook(() => useFolderTree(folders, () => ["a"]));
    expect(names(result.current.rows)).toEqual(["Alpha", "Beta", "Delta"]);

    act(() => result.current.expand("b"));
    expect(names(result.current.rows)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(result.current.expanded.has("b")).toBe(true);
  });
});
