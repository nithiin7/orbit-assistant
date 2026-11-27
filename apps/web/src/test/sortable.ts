import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

const ROW_HEIGHT = 40;

/**
 * Lays list rows out 40px tall, one under another, since jsdom has no layout and `SortableList`
 * finds where a row goes from where the rows are. Undo with `vi.restoreAllMocks()`.
 */
export function mockRowLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const row = this.closest("li");
    const index = row?.parentElement ? [...row.parentElement.children].indexOf(row) : 0;
    const top = index * ROW_HEIGHT;
    return {
      top,
      bottom: top + ROW_HEIGHT,
      left: 0,
      right: 300,
      width: 300,
      height: ROW_HEIGHT,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
}

async function press(target: Element | Document, code: string) {
  await act(async () => {
    fireEvent.keyDown(target, { code, key: code === "Space" ? " " : code });
    // The sensor listens on the document from the next tick after a drag starts.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** Picks a row up by its drag handle, moves it `steps` rows (negative is up), and drops it. */
export async function moveWithKeyboard(handle: HTMLElement, steps: number) {
  handle.focus();
  await press(handle, "Space");
  for (let step = 0; step < Math.abs(steps); step += 1) {
    await press(document, steps > 0 ? "ArrowDown" : "ArrowUp");
  }
  await press(document, "Space");
}
