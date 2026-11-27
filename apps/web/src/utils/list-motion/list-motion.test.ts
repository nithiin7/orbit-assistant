import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { animateListChanges } from "./list-motion";

type Played = {
  element: Element;
  keyframes: Keyframe[];
  animation: { cancel: () => void; onfinish: (() => void) | null; oncancel: (() => void) | null };
};

const ROW_HEIGHT = 40;
let played: Played[] = [];

/** Lays rows out top to bottom, ROW_HEIGHT each, the way a browser would after a change. */
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const parent = this.parentElement;
    const index =
      parent && this.tagName === "LI"
        ? Array.from(parent.children)
            .filter((child) => !child.hasAttribute("data-list-ghost"))
            .indexOf(this)
        : 0;
    return DOMRect.fromRect({ x: 0, y: index * ROW_HEIGHT, width: 300, height: ROW_HEIGHT });
  });
}

function stubAnimate() {
  played = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      const animation: Played["animation"] = {
        onfinish: null,
        oncancel: null,
        cancel() {
          this.oncancel?.();
        },
      };
      played.push({ element: this, keyframes, animation });
      return animation;
    },
  });
}

function listOf(...names: string[]) {
  const list = document.createElement("ul");
  for (const name of names) list.append(row(name));
  document.body.append(list);
  return list;
}

function row(name: string) {
  const item = document.createElement("li");
  item.textContent = name;
  return item;
}

const byText = (list: HTMLElement, text: string) =>
  Array.from(list.children).find(
    (child) => child.textContent === text && !child.hasAttribute("data-list-ghost"),
  ) as HTMLElement;

/** Mutation observers report in a microtask. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("animateListChanges", () => {
  beforeEach(() => {
    stubLayout();
    stubAnimate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, "animate");
    document.body.replaceChildren();
  });

  it("slides moved rows from their old place to their new one", async () => {
    const list = listOf("a", "b", "c");
    const cleanup = animateListChanges(list);

    list.prepend(byText(list, "c"));
    await flush();

    const slides = Object.fromEntries(
      played.map(({ element, keyframes }) => [element.textContent, keyframes[0]?.transform]),
    );
    expect(slides).toEqual({
      a: "translate(0px, -40px)",
      b: "translate(0px, -40px)",
      c: "translate(0px, 80px)",
    });
    cleanup?.();
  });

  it("fades a new row in and slides the rows below it down", async () => {
    const list = listOf("a", "b");
    const cleanup = animateListChanges(list);

    list.prepend(row("new"));
    await flush();

    const fresh = played.find(({ element }) => element.textContent === "new");
    expect(fresh?.keyframes[0]).toMatchObject({ opacity: 0 });
    expect(played.find(({ element }) => element.textContent === "b")?.keyframes[0]).toEqual({
      transform: "translate(0px, -40px)",
    });
    cleanup?.();
  });

  it("leaves a hidden copy of a removed row that fades out, then goes", async () => {
    const list = listOf("a", "b", "c");
    const cleanup = animateListChanges(list);

    byText(list, "b").remove();
    await flush();

    const ghost = list.querySelector("[data-list-ghost]");
    expect(ghost?.textContent).toBe("b");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    // Back where the row was, before "c".
    expect(ghost?.nextElementSibling?.textContent).toBe("c");
    expect(played.find(({ element }) => element.textContent === "c")?.keyframes[0]).toEqual({
      transform: "translate(0px, 40px)",
    });

    played.find(({ element }) => element === ghost)?.animation.onfinish?.();
    expect(list.querySelector("[data-list-ghost]")).toBeNull();
    cleanup?.();
  });

  it("changes in place when every row is swapped for new ones", async () => {
    const list = listOf("a", "b");
    const cleanup = animateListChanges(list);

    list.replaceChildren(row("x"), row("y"));
    await flush();

    expect(played).toEqual([]);
    expect(list.querySelector("[data-list-ghost]")).toBeNull();
    cleanup?.();
  });

  it("does nothing when the viewer prefers reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const list = listOf("a", "b");
    const cleanup = animateListChanges(list);

    list.prepend(byText(list, "b"));
    byText(list, "a").remove();
    await flush();

    expect(played).toEqual([]);
    cleanup?.();
    vi.unstubAllGlobals();
  });

  it("does nothing without the Web Animations API", () => {
    Reflect.deleteProperty(Element.prototype, "animate");

    expect(animateListChanges(listOf("a"))).toBeUndefined();
  });
});
