/*
 * List motion with the FLIP technique (First, Last, Invert, Play). The list remembers where each
 * row sat; after React adds, removes, or reorders rows, every row that moved starts at its old
 * place and slides to its new one, new rows fade in, and a removed row fades out where it was.
 *
 * Rows are tracked by their DOM node, which React keeps across renders for keyed children, so no
 * extra attributes are needed. Without the Web Animations API (as in jsdom), or when the viewer
 * prefers reduced motion, rows change in place as before.
 */

const EASE_OUT_SOFT = "cubic-bezier(0.22, 1, 0.36, 1)";
const MOVE_MS = 260;
const ENTER_MS = 220;
const EXIT_MS = 180;
/** Marks the stand-in left behind by a removed row while it fades out. */
const GHOST = "data-list-ghost";

type Box = { top: number; left: number; width: number; height: number };

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** How far a running animation of ours has shifted `element` from its place in the layout. */
function shiftOf(element: HTMLElement): { x: number; y: number } {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none" || typeof DOMMatrixReadOnly === "undefined") {
    return { x: 0, y: 0 };
  }
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.m41, y: matrix.m42 };
}

/**
 * A ref callback for a list element (`<ul ref={animateListChanges}>`) whose direct children are
 * its rows. Give the list `position: relative` (`relative`), so a removed row can fade out in
 * place, and `overflow-hidden` if rows sliding past its edges should be clipped.
 */
export function animateListChanges(list: HTMLElement | null): (() => void) | undefined {
  if (!list || typeof list.animate !== "function" || typeof MutationObserver === "undefined") {
    return undefined;
  }

  const boxes = new Map<HTMLElement, Box>();
  const running = new Map<HTMLElement, Animation>();
  const ghosts = new Set<HTMLElement>();

  const rows = () =>
    Array.from(list.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && !child.hasAttribute(GHOST),
    );

  /** Where `element` is on screen, relative to the list, so scrolling doesn't count as moving. */
  const visualBox = (element: HTMLElement): Box => {
    const origin = list.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top - origin.top,
      left: rect.left - origin.left,
      width: rect.width,
      height: rect.height,
    };
  };

  /** Where `element` belongs in the layout, leaving out any slide of ours still playing. */
  const layoutBox = (element: HTMLElement): Box => {
    const box = visualBox(element);
    if (!running.has(element)) return box;
    const shift = shiftOf(element);
    return { ...box, top: box.top - shift.y, left: box.left - shift.x };
  };

  const remember = () => {
    boxes.clear();
    for (const row of rows()) boxes.set(row, layoutBox(row));
  };

  const play = (element: HTMLElement, keyframes: Keyframe[], duration: number) => {
    const animation = element.animate(keyframes, { duration, easing: EASE_OUT_SOFT });
    running.set(element, animation);
    const done = () => {
      if (running.get(element) === animation) running.delete(element);
    };
    animation.onfinish = done;
    animation.oncancel = done;
  };

  const fadeOut = (row: HTMLElement, box: Box, before: Node | null) => {
    // A row that already folded itself away (a finished task) has nothing left to show.
    if (box.height < 1 || box.width < 1) return;
    const ghost = row.cloneNode(true);
    if (!(ghost instanceof HTMLElement)) return;
    ghost.setAttribute(GHOST, "");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: "absolute",
      top: `${box.top - list.clientTop}px`,
      left: `${box.left - list.clientLeft}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: "0",
      pointerEvents: "none",
      animation: "none",
      transform: "none",
      zIndex: "0",
    });
    // Back where the row was, so its neighbours keep their `:last-child` and `:nth-child` looks
    // until it is gone.
    list.insertBefore(ghost, before && before.parentNode === list ? before : null);
    ghosts.add(ghost);
    const animation = ghost.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.98)" },
      ],
      { duration: EXIT_MS, easing: "ease-out" },
    );
    const remove = () => {
      ghosts.delete(ghost);
      ghost.remove();
    };
    animation.onfinish = remove;
    animation.oncancel = remove;
  };

  const onChange = (records: MutationRecord[]) => {
    watchRows();
    const current = rows();
    const present = new Set(current);
    if (prefersReducedMotion()) {
      remember();
      return;
    }

    // Where each removed row was: the node that followed it.
    const followers = new Map<Node, Node | null>();
    for (const record of records) {
      for (const node of record.removedNodes) followers.set(node, record.nextSibling);
    }

    // A list swapped for different rows altogether (another filter) changes in place; motion
    // is for rows that come, go, or move among ones that stay.
    const kept = current.some((row) => boxes.has(row));
    if (!kept && current.length > 0) {
      remember();
      return;
    }

    for (const [row, box] of boxes) {
      if (!present.has(row)) fadeOut(row, box, followers.get(row) ?? null);
    }

    // First: where each staying row is on screen now, mid-slide included.
    const firsts = new Map<HTMLElement, Box>();
    for (const row of current) {
      const box = boxes.get(row);
      if (!box) continue;
      const shift = running.has(row) ? shiftOf(row) : { x: 0, y: 0 };
      firsts.set(row, { ...box, top: box.top + shift.y, left: box.left + shift.x });
    }
    for (const row of current) running.get(row)?.cancel();

    // Last: where each row belongs now.
    remember();

    // Invert and play.
    for (const row of current) {
      // A row placed by something else (a drag in progress) is left to it.
      if (row.style.transform) continue;
      const last = boxes.get(row);
      const first = firsts.get(row);
      if (!last) continue;
      if (!first) {
        play(
          row,
          [
            { opacity: 0, transform: "translateY(-4px)" },
            { opacity: 1, transform: "none" },
          ],
          ENTER_MS,
        );
        continue;
      }
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      play(row, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], MOVE_MS);
    }
  };

  // Rows also shift without being added or removed: a neighbour grows, a finished task folds
  // away, a drag lets go. Keep the remembered places current so those don't replay as moves.
  const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remember);
  sizes?.observe(list);
  const watched = new Set<HTMLElement>();
  const watchRows = () => {
    if (!sizes) return;
    for (const row of rows()) {
      if (!watched.has(row)) {
        sizes.observe(row);
        watched.add(row);
      }
    }
    for (const row of watched) {
      if (row.parentNode !== list) {
        sizes.unobserve(row);
        watched.delete(row);
      }
    }
  };

  remember();
  watchRows();
  const mutations = new MutationObserver(onChange);
  mutations.observe(list, { childList: true });

  // Before React's own handlers (on the root), so a fold that ends removes nothing that moved.
  const settle = ["animationend", "transitionend", "pointerup", "keydown"] as const;
  for (const type of settle) list.addEventListener(type, remember, true);

  return () => {
    mutations.disconnect();
    sizes?.disconnect();
    for (const type of settle) list.removeEventListener(type, remember, true);
    for (const animation of running.values()) animation.cancel();
    for (const ghost of ghosts) ghost.remove();
  };
}
