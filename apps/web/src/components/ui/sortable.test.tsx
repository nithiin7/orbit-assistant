import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockRowLayout, moveWithKeyboard } from "@/test/sortable";

import { DragHandle, SortableList, type SortableMove, useSortableItem } from "./sortable";

type Fruit = { id: string; name: string };

const fruits: Fruit[] = [
  { id: "apple", name: "Apple" },
  { id: "banana", name: "Banana" },
  { id: "cherry", name: "Cherry" },
];

function Row({ fruit }: { fruit: Fruit }) {
  const { row, handle } = useSortableItem(fruit.id);
  return (
    <li {...row}>
      <DragHandle {...handle} aria-label={`Move “${fruit.name}”`} />
      {fruit.name}
    </li>
  );
}

function renderList(onMove: (move: SortableMove<Fruit>) => void) {
  return render(
    <SortableList items={fruits} itemLabel={(fruit) => fruit.name} onMove={onMove}>
      <ul>
        {fruits.map((fruit) => (
          <Row key={fruit.id} fruit={fruit} />
        ))}
      </ul>
    </SortableList>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SortableList", () => {
  it("names each handle and explains how to move with the keyboard", () => {
    renderList(vi.fn());

    const handle = screen.getByRole("button", { name: "Move “Banana”" });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle).toHaveAccessibleDescription(/press Space or Enter on its handle/);
  });

  it("moves an item with the keyboard and reports the new order", async () => {
    mockRowLayout();
    const onMove = vi.fn<(move: SortableMove<Fruit>) => void>();
    renderList(onMove);

    await moveWithKeyboard(screen.getByRole("button", { name: "Move “Apple”" }), 1);

    expect(onMove).toHaveBeenCalledOnce();
    const [move] = onMove.mock.calls[0] ?? [];
    expect(move?.from).toBe(0);
    expect(move?.to).toBe(1);
    expect(move?.order.map((fruit) => fruit.id)).toEqual(["banana", "apple", "cherry"]);
  });
});
