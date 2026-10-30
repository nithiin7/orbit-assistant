import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScrollStrip } from "./scroll-strip";

const TABS = ["One", "Two", "Three", "Four", "Five", "Six"];

/** jsdom has no layout: a 200px-wide row holding six 100px items. */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return TABS.indexOf(this.textContent) * 100;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Strip({ selected }: { selected: string }) {
  return (
    <ScrollStrip role="group" aria-label="Views" selected={selected}>
      {TABS.map((tab) => (
        <button key={tab} type="button" aria-pressed={tab === selected}>
          {tab}
        </button>
      ))}
    </ScrollStrip>
  );
}

describe("ScrollStrip", () => {
  it("fades only the edges with hidden items", () => {
    render(<Strip selected="One" />);
    const row = screen.getByRole("group", { name: "Views" });

    expect(row).not.toHaveAttribute("data-overflow-start");
    expect(row).toHaveAttribute("data-overflow-end");

    row.scrollLeft = 400;
    fireEvent.scroll(row);
    expect(row).toHaveAttribute("data-overflow-start");
    expect(row).not.toHaveAttribute("data-overflow-end");
  });

  it("turns a vertical wheel into sideways scrolling until the end", () => {
    render(<Strip selected="One" />);
    const row = screen.getByRole("group", { name: "Views" });

    expect(fireEvent.wheel(row, { deltaY: 120 })).toBe(false);
    expect(row.scrollLeft).toBe(120);

    row.scrollLeft = 400;
    // At the end the page scrolls instead.
    expect(fireEvent.wheel(row, { deltaY: 120 })).toBe(true);
    expect(row.scrollLeft).toBe(400);
  });

  it("scrolls the selected item into view", () => {
    const { rerender } = render(<Strip selected="One" />);
    const row = screen.getByRole("group", { name: "Views" });
    expect(row.scrollLeft).toBe(0);

    rerender(<Strip selected="Five" />);
    // Five spans 400–500px; it ends 24px inside the right edge.
    expect(row.scrollLeft).toBe(324);
  });
});
